import { supabase } from '../lib/supabase';

const TEXT_EDGE_FUNCTION = process.env.EXPO_PUBLIC_DEEPSEEK_TEXT_EDGE_FUNCTION || 'deepseek-proxy';
const DEFAULT_TEXT_MODEL = process.env.EXPO_PUBLIC_DEEPSEEK_TEXT_MODEL || 'deepseek-chat';
const VALID_TABS = new Set(['sales', 'cash', 'inventory', 'financial', 'production']);

function parseJsonSafe(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_e) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (_err) {
      return null;
    }
  }
}

function normalizeIsoDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : text;
}

function clampConfidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Number(Math.max(0, Math.min(1, parsed)).toFixed(3));
}

function normalizeIntent(intent) {
  const tab = String(intent?.tab || '').trim().toLowerCase();
  const normalizedTab = VALID_TABS.has(tab) ? tab : null;

  const fromDate = normalizeIsoDate(intent?.from_date);
  const toDate = normalizeIsoDate(intent?.to_date);

  let finalFrom = fromDate;
  let finalTo = toDate;
  if (fromDate && toDate && fromDate > toDate) {
    finalFrom = toDate;
    finalTo = fromDate;
  }

  return {
    tab: normalizedTab,
    from_date: finalFrom,
    to_date: finalTo,
    location_id: intent?.location_id ? String(intent.location_id).trim() : null,
    location_name: intent?.location_name ? String(intent.location_name).trim() : null,
    location_text: intent?.location_text
      ? String(intent.location_text).trim()
      : (intent?.location_name ? String(intent.location_name).trim() : null),
    notes: intent?.notes ? String(intent.notes).trim() : null,
    confidence: clampConfidence(intent?.confidence),
  };
}

async function extractInvokeError(error) {
  const fragments = [];
  if (error?.message) fragments.push(String(error.message));

  const context = error?.context;
  if (!context) return fragments.join(' | ') || 'Error desconocido';

  try {
    const response = typeof context.clone === 'function' ? context.clone() : context;
    if (response?.status) fragments.push(`HTTP ${response.status}`);

    let bodyJson = null;
    if (typeof response?.json === 'function') {
      bodyJson = await response.json().catch(() => null);
    }

    if (bodyJson?.error) fragments.push(String(bodyJson.error));
    if (bodyJson?.details) fragments.push(String(bodyJson.details));

    if (!bodyJson && typeof response?.text === 'function') {
      const bodyText = await response.text().catch(() => '');
      if (bodyText?.trim()) fragments.push(bodyText.trim().slice(0, 280));
    }
  } catch (_e) {
    // no-op
  }

  const unique = Array.from(new Set(fragments.filter(Boolean)));
  return unique.join(' | ') || 'Error desconocido';
}

export async function analyzeReportQueryWithCloudLlm({
  tenantId,
  queryText,
  locationOptions = [],
}) {
  if (!tenantId) {
    return { success: false, error: 'tenantId es requerido.' };
  }

  const text = String(queryText || '').trim();
  if (!text) {
    return { success: false, error: 'Escribe una consulta para reportes.' };
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const locationHints = (Array.isArray(locationOptions) ? locationOptions : [])
    .slice(0, 40)
    .map((loc) => `- ${loc?.name || ''} (${loc?.location_id || 'sin-id'})`)
    .filter(Boolean)
    .join('\n');

  const systemPrompt =
    'Eres un parser de consultas de reportes para un POS. Responde SOLO JSON valido, sin markdown ni texto extra.';

  const userPrompt = `Convierte la consulta a JSON EXACTO:
{
  "intent": {
    "tab": "sales|cash|inventory|financial|production|null",
    "from_date": "YYYY-MM-DD|null",
    "to_date": "YYYY-MM-DD|null",
    "location_id": "uuid|null",
    "location_name": "string|null",
    "location_text": "string|null",
    "notes": "string|null",
    "confidence": number
  },
  "summary": "string|null"
}

Reglas:
- confidence entre 0 y 1.
- Si no puedes inferir un campo, usa null.
- Para fechas relativas usa hoy=${todayIso}.
- No inventes location_id. Solo usa uno si viene explicito en la consulta.
- summary debe ser breve (max 1 linea).
- Responde SOLO JSON.

Sedes disponibles:
${locationHints || '- (sin sedes cargadas)'}

Consulta:
"""${text.slice(0, 8000)}"""`;

  const { data, error } = await supabase.functions.invoke(TEXT_EDGE_FUNCTION, {
    body: {
      model: DEFAULT_TEXT_MODEL,
      temperature: 0.1,
      max_tokens: 700,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    },
  });

  if (error) {
    const details = await extractInvokeError(error);
    return {
      success: false,
      error: `Error invocando Edge Function "${TEXT_EDGE_FUNCTION}": ${details}.`,
    };
  }

  const content = data?.content;
  const parsed = parseJsonSafe(content);
  if (!parsed || !parsed.intent) {
    return { success: false, error: 'No se pudo parsear la respuesta IA de consulta de reportes.' };
  }

  return {
    success: true,
    data: {
      intent: normalizeIntent(parsed.intent || {}),
      summary: parsed?.summary ? String(parsed.summary).trim() : null,
      model: data?.model || null,
      usage: data?.usage || null,
      raw: parsed,
      cache_hit: Boolean(data?.cache_hit),
    },
  };
}
