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

async function extractTextWithOcrSpace(imageDataUrl: string, apiKey: string) {
  const form = new FormData();
  form.append('base64Image', imageDataUrl);
  form.append('language', 'spa');
  form.append('isOverlayRequired', 'false');
  form.append('OCREngine', '2');

  const response = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    headers: {
      apikey: apiKey,
    },
    body: form,
  });

  const rawText = await response.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null;
  } catch (_error) {
    json = null;
  }

  if (!response.ok) {
    return {
      success: false,
      error: `OCR.Space HTTP ${response.status}`,
      details: rawText.slice(0, 1200),
    };
  }

  const parsedResults = Array.isArray(json?.ParsedResults)
    ? (json?.ParsedResults as Array<Record<string, unknown>>)
    : [];
  const parsedText = parsedResults
    .map((item) => String(item?.ParsedText || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();

  const isErrored = Boolean(json?.IsErroredOnProcessing);
  const errors = Array.isArray(json?.ErrorMessage) ? json?.ErrorMessage.join(' | ') : String(json?.ErrorMessage || '');
  if (isErrored || !parsedText) {
    return {
      success: false,
      error: 'OCR.Space no pudo extraer texto',
      details: errors || rawText.slice(0, 1200),
    };
  }

  return {
    success: true,
    text: parsedText,
  };
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
  const ocrSpaceApiKey = Deno.env.get('OCR_SPACE_API_KEY') || 'helloworld';

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch (_error) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const image = String(body.image || '').trim();
  const mimeType = String(body.mime_type || 'image/jpeg').trim();
  const prompt = String(body.prompt || '').trim();

  if (!image) {
    return jsonResponse({ error: 'image is required (base64 or data URL)' }, 400);
  }
  if (!prompt) {
    return jsonResponse({ error: 'prompt is required' }, 400);
  }

  const model = String(body.model || 'deepseek-chat');
  const temperature = Number(body.temperature ?? 0.1);
  const maxTokens = Number(body.max_tokens ?? 2400);

  const imageUrl = image.startsWith('data:') ? image : `data:${mimeType};base64,${image}`;
  const ocrResult = await extractTextWithOcrSpace(imageUrl, ocrSpaceApiKey);
  if (!ocrResult.success) {
    return jsonResponse(
      {
        error: ocrResult.error,
        details: ocrResult.details,
      },
      400,
    );
  }

  const ocrText = String(ocrResult.text || '').slice(0, 12000);
  const upstreamPayload = {
    model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      {
        role: 'system',
        content: 'Eres un agente que estructura facturas para POS a partir de texto OCR. Responde SOLO JSON valido.',
      },
      {
        role: 'user',
        content: `${prompt}\n\nTexto OCR:\n"""${ocrText}"""`,
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

  return jsonResponse({
    content,
    model: rawJson?.model || model,
    usage: rawJson?.usage || null,
    ocr_text: ocrText,
    raw: rawJson,
  });
});
