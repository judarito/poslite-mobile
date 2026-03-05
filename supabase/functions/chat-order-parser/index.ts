import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

function normalizeContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'text' in item) return String((item as { text?: unknown }).text || '');
        return '';
      })
      .filter(Boolean);
    return parts.join('\n').trim();
  }
  return '';
}

function parseAiJson(text: string): Record<string, unknown> | null {
  const raw = String(text || '').trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (_e) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch (_err) {
      return null;
    }
  }
}

function normalizeForCache(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'Missing Authorization header' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse({ error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY' }, 500);
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user?.id) {
    return jsonResponse({ error: 'Invalid or expired token' }, 401);
  }

  const apiKey = Deno.env.get('DEEPSEEK_API_KEY');
  if (!apiKey) {
    return jsonResponse({ error: 'Missing DEEPSEEK_API_KEY secret in Edge Function' }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch (_error) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const chatText = String(body.chat_text || '').trim();
  if (!chatText) {
    return jsonResponse({ error: 'chat_text is required' }, 400);
  }
  const tenantId = String(body.tenant_id || '').trim();
  if (!tenantId) {
    return jsonResponse({ error: 'tenant_id is required' }, 400);
  }

  const model = String(body.model || 'deepseek-chat');
  const temperature = Number(body.temperature ?? 0.1);
  const maxTokens = Number(body.max_tokens ?? 1800);
  const clippedChat = chatText.slice(0, 10000);
  const normalizedChat = normalizeForCache(clippedChat);
  const chatHash = await sha256Hex(normalizedChat);
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const maxCacheItemsRaw = Number(Deno.env.get('CHAT_ORDER_CACHE_MAX_ITEMS') || 500);
  const maxCacheItems = Number.isFinite(maxCacheItemsRaw) ? Math.max(50, Math.floor(maxCacheItemsRaw)) : 500;

  try {
    const { data: cacheHit } = await supabase
      .from('chat_order_ai_cache')
      .select('cache_id, response_payload, use_count')
      .eq('tenant_id', tenantId)
      .eq('chat_hash', chatHash)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .maybeSingle();

    const cachedPayload = (cacheHit?.response_payload || null) as Record<string, unknown> | null;
    const cachedLines = Array.isArray(cachedPayload?.line_items)
      ? (cachedPayload?.line_items as Array<Record<string, unknown>>)
      : [];
    if (cachedPayload && cachedLines.length) {
      await supabase
        .from('chat_order_ai_cache')
        .update({
          use_count: Number(cacheHit?.use_count || 0) + 1,
          last_used_at: nowIso,
        })
        .eq('cache_id', cacheHit?.cache_id || '');

      return jsonResponse({
        ...(cachedPayload || {}),
        cache_hit: true,
      });
    }
  } catch (_cacheReadError) {
    // Cache best-effort; continue with IA call.
  }

  const upstreamPayload = {
    model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      {
        role: 'system',
        content:
          'Eres un parser de pedidos por chat para POS. Debes responder SOLO JSON valido, sin markdown, sin explicaciones.',
      },
      {
        role: 'user',
        content: `Convierte este chat en borrador de venta y responde JSON EXACTO con esta forma:
{
  "order": {
    "customer_name": "string|null",
    "notes": "string|null",
    "confidence": number
  },
  "line_items": [
    {
      "raw_name": "string",
      "sku": "string|null",
      "quantity": number,
      "unit_hint": "string|null",
      "unit_price": number|null
    }
  ]
}

Reglas:
- No inventes productos que no esten en el chat.
- quantity siempre > 0, si falta usa 1.
- confidence entre 0 y 1.
- Si no sabes customer_name o notes usa null.
- Si no hay sku, usa null.
- Conserva atributos de variante en raw_name (ej: talla, color, presentacion, capacidad).
- Responde SOLO JSON.

Chat:
"""${clippedChat}"""`,
      },
    ],
    stream: false,
  };

  const upstream = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(upstreamPayload),
  });

  const rawText = await upstream.text();
  let rawJson: Record<string, unknown> | null = null;
  try {
    rawJson = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null;
  } catch (_error) {
    rawJson = null;
  }

  if (!upstream.ok) {
    const deepseekError =
      (rawJson?.error && typeof rawJson.error === 'object' && 'message' in rawJson.error)
        ? String((rawJson.error as { message?: unknown }).message || '')
        : null;

    return jsonResponse(
      {
        error: 'DeepSeek request failed',
        details: deepseekError || rawText.slice(0, 1200) || `HTTP ${upstream.status}`,
        status: upstream.status,
      },
      upstream.status,
    );
  }

  const choice = Array.isArray(rawJson?.choices) ? rawJson?.choices?.[0] as Record<string, unknown> : null;
  const message = choice && typeof choice === 'object' ? (choice.message as Record<string, unknown> | undefined) : null;
  const content = normalizeContent(message?.content);

  if (!content) {
    return jsonResponse({ error: 'DeepSeek returned empty content', raw: rawJson }, 502);
  }

  const parsed = parseAiJson(content);
  if (!parsed) {
    return jsonResponse({ error: 'Could not parse JSON from model output', content }, 502);
  }

  const parsedOrder = (parsed.order || {}) as Record<string, unknown>;
  const parsedLines = Array.isArray(parsed.line_items) ? parsed.line_items as Array<Record<string, unknown>> : [];

  const lineItems = parsedLines
    .map((item) => ({
      raw_name: String(item?.raw_name || '').trim(),
      sku: item?.sku ? String(item.sku).trim() : null,
      quantity: Math.max(1, Math.round(Number(item?.quantity || 1))),
      unit_hint: item?.unit_hint ? String(item.unit_hint).trim() : null,
      unit_price: item?.unit_price == null ? null : Number(item.unit_price || 0),
    }))
    .filter((item) => item.raw_name);

  if (!lineItems.length) {
    return jsonResponse({ error: 'Model output did not include line_items' }, 422);
  }

  const confidenceRaw = Number(parsedOrder?.confidence ?? 0);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.min(1, Math.max(0, confidenceRaw))
    : 0;

  const responsePayload = {
    order: {
      customer_name: parsedOrder?.customer_name ? String(parsedOrder.customer_name).trim() : null,
      notes: parsedOrder?.notes ? String(parsedOrder.notes).trim() : null,
      confidence: Number(confidence.toFixed(3)),
    },
    line_items: lineItems,
    model: rawJson?.model || model,
    usage: rawJson?.usage || null,
    raw: parsed,
    cache_hit: false,
  };

  try {
    await supabase
      .from('chat_order_ai_cache')
      .upsert(
        {
          tenant_id: tenantId,
          chat_hash: chatHash,
          chat_text_norm: normalizedChat.slice(0, 2000),
          response_payload: responsePayload,
          model: String(rawJson?.model || model),
          use_count: 1,
          last_used_at: nowIso,
          expires_at: expiresAt,
        },
        { onConflict: 'tenant_id,chat_hash' },
      );

    const { data: staleRows } = await supabase
      .from('chat_order_ai_cache')
      .select('cache_id')
      .eq('tenant_id', tenantId)
      .order('last_used_at', { ascending: false })
      .order('created_at', { ascending: false })
      .range(maxCacheItems, maxCacheItems + 250);

    const staleIds = (staleRows || []).map((row) => row.cache_id).filter(Boolean);
    if (staleIds.length) {
      await supabase.from('chat_order_ai_cache').delete().in('cache_id', staleIds);
    }
  } catch (_cacheWriteError) {
    // Cache best-effort; do not fail the request.
  }

  return jsonResponse(responsePayload);
});
