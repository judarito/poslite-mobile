import { ensureEmbeddedModelReady } from './embeddedModel.service';

const LOCAL_REPORT_LLM_ENDPOINT = process.env.EXPO_PUBLIC_LOCAL_LLM_REPORTS_URL || '';
const DEFAULT_TIMEOUT_MS = 2200;
const MIN_EMBEDDED_TIMEOUT_MS = 8000;
const DEFAULT_CONTEXT = Number(process.env.EXPO_PUBLIC_EMBEDDED_LLM_CONTEXT_SIZE || 2048);
const VALID_TABS = new Set(['sales', 'cash', 'inventory', 'financial', 'production']);

let runtimeModuleCache = null;
let contextCache = {
  modelPath: null,
  context: null,
};

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

function resolveTimeoutMs(mode = 'auto') {
  const parsed = Number(process.env.EXPO_PUBLIC_LOCAL_LLM_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const resolved = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
  if (mode === 'embedded' || mode === 'auto') {
    return Math.max(MIN_EMBEDDED_TIMEOUT_MS, resolved);
  }
  return resolved;
}

function resolveLocalLlmMode() {
  const mode = String(process.env.EXPO_PUBLIC_LOCAL_LLM_MODE || 'auto').trim().toLowerCase();
  if (mode === 'embedded') return 'embedded';
  if (mode === 'endpoint') return 'endpoint';
  return 'auto';
}

function withTimeout(promise, timeoutMs) {
  const timeout = Number.isFinite(Number(timeoutMs))
    ? Math.max(1200, Number(timeoutMs))
    : MIN_EMBEDDED_TIMEOUT_MS;

  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const id = setTimeout(() => {
        clearTimeout(id);
        reject(new Error(`Embedded report LLM timeout (${timeout}ms).`));
      }, timeout);
    }),
  ]);
}

function loadRuntimeModule() {
  if (runtimeModuleCache) return runtimeModuleCache;

  try {
    const runtime = require('llama.rn');
    runtimeModuleCache = runtime;
    return runtime;
  } catch (_e) {
    runtimeModuleCache = null;
    return null;
  }
}

function buildMessages(text, locationOptions) {
  const locationHints = (Array.isArray(locationOptions) ? locationOptions : [])
    .slice(0, 35)
    .map((loc) => `- ${loc?.name || ''} (${loc?.location_id || 'sin-id'})`)
    .filter(Boolean)
    .join('\n');

  const todayIso = new Date().toISOString().slice(0, 10);

  return [
    {
      role: 'system',
      content:
        'Eres un parser de consultas de reportes para POS. Debes responder SOLO JSON valido, sin markdown ni texto adicional.',
    },
    {
      role: 'user',
      content: `Convierte esta consulta en JSON EXACTO:\n\n{\n  "intent": {\n    "tab": "sales|cash|inventory|financial|production|null",\n    "from_date": "YYYY-MM-DD|null",\n    "to_date": "YYYY-MM-DD|null",\n    "location_id": "uuid|null",\n    "location_name": "string|null",\n    "location_text": "string|null",\n    "notes": "string|null",\n    "confidence": number\n  },\n  "summary": "string|null"\n}\n\nReglas:\n- confidence entre 0 y 1.\n- Si no puedes inferir un campo, usa null.\n- Usa hoy=${todayIso} para fechas relativas.\n- No inventes location_id.\n- Responde SOLO JSON.\n\nSedes disponibles:\n${locationHints || '- (sin sedes cargadas)'}\n\nConsulta:\n"""${String(text || '').slice(0, 8000)}"""`,
    },
  ];
}

async function ensureContext(modelPath) {
  if (contextCache.context && contextCache.modelPath === modelPath) {
    return { success: true, context: contextCache.context };
  }

  const runtime = loadRuntimeModule();
  if (!runtime) {
    return {
      success: false,
      error:
        'Runtime llama.rn no disponible. Instala dependencia nativa y usa dev/prod build (no Expo Go).',
    };
  }

  try {
    if (contextCache.context?.release) {
      await contextCache.context.release();
    }
  } catch (_e) {
    // no-op
  }

  try {
    const initLlama = runtime?.initLlama || runtime?.default?.initLlama;
    if (typeof initLlama !== 'function') {
      return { success: false, error: 'llama.rn no expone initLlama().' };
    }

    const context = await initLlama({
      model: modelPath,
      n_ctx: DEFAULT_CONTEXT,
      n_gpu_layers: 0,
      embedding: false,
    });

    contextCache = {
      modelPath,
      context,
    };

    return { success: true, context };
  } catch (error) {
    return {
      success: false,
      error: String(error?.message || 'No se pudo inicializar contexto embedded llama.rn.'),
    };
  }
}

function extractCompletionText(result) {
  const text =
    result?.text ||
    result?.content ||
    result?.message?.content ||
    result?.completion ||
    '';
  return String(text || '').trim();
}

async function parseReportQueryWithEmbeddedLlm({ tenantId, text, locationOptions = [], timeoutMs }) {
  if (!tenantId) return { success: false, skipped: true, reason: 'tenantId requerido.' };

  const runtime = loadRuntimeModule();
  if (!runtime) {
    return {
      success: false,
      skipped: true,
      reason: 'llama.rn no disponible en build actual.',
    };
  }

  const modelReady = await ensureEmbeddedModelReady();
  if (!modelReady.success || !modelReady.path) {
    return {
      success: false,
      skipped: true,
      reason: modelReady.error || 'Modelo embebido no disponible.',
    };
  }

  const contextResult = await ensureContext(modelReady.path);
  if (!contextResult.success || !contextResult.context) {
    return {
      success: false,
      skipped: false,
      reason: contextResult.error || 'No se pudo inicializar contexto embedded.',
      error: contextResult.error || 'No se pudo inicializar contexto embedded.',
    };
  }

  const payload = {
    messages: buildMessages(text, locationOptions),
    n_predict: 180,
    temperature: 0.1,
    stop: ['\n\n```'],
    response_format: {
      type: 'json_object',
    },
  };

  const completionFn =
    (typeof contextResult.context?.completion === 'function' && contextResult.context.completion.bind(contextResult.context)) ||
    (typeof contextResult.context?.chatCompletion === 'function' && contextResult.context.chatCompletion.bind(contextResult.context));

  if (!completionFn) {
    return {
      success: false,
      skipped: false,
      reason: 'Contexto llama.rn no expone completion/chatCompletion.',
      error: 'Contexto llama.rn no expone completion/chatCompletion.',
    };
  }

  try {
    const rawResult = await withTimeout(completionFn(payload), timeoutMs);
    const textResult = extractCompletionText(rawResult);
    if (!textResult) {
      return { success: false, skipped: false, reason: 'LLM local embebido no devolvio texto.' };
    }

    const parsed = parseJsonSafe(textResult);
    if (!parsed?.intent) {
      return { success: false, skipped: false, reason: 'LLM local embebido devolvio JSON invalido.' };
    }

    return {
      success: true,
      data: {
        intent: normalizeIntent(parsed.intent || {}),
        summary: parsed?.summary ? String(parsed.summary).trim() : null,
        model: 'qwen2.5-1.5b-embedded',
        usage: rawResult?.timings || null,
        raw: parsed,
        cache_hit: false,
      },
    };
  } catch (error) {
    return {
      success: false,
      skipped: false,
      reason: String(error?.message || 'Error ejecutando LLM local embebido.'),
      error: String(error?.message || 'Error ejecutando LLM local embebido.'),
    };
  }
}

async function parseReportQueryWithEndpointLlm({ tenantId, text, inputType = 'text', locationOptions = [] }) {
  if (!tenantId) return { success: false, skipped: true, reason: 'tenantId requerido.' };

  const endpoint = String(LOCAL_REPORT_LLM_ENDPOINT || '').trim();
  if (!endpoint) {
    return {
      success: false,
      skipped: true,
      reason: 'Local report LLM endpoint no configurado (EXPO_PUBLIC_LOCAL_LLM_REPORTS_URL).',
    };
  }

  const controller = new AbortController();
  const timeoutMs = resolveTimeoutMs('endpoint');
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tenant_id: tenantId,
        input_type: inputType,
        text: String(text || '').slice(0, 10000),
        locations: (Array.isArray(locationOptions) ? locationOptions : []).slice(0, 40),
      }),
      signal: controller.signal,
    });

    const bodyText = await response.text();
    let parsed = null;
    try {
      parsed = bodyText ? JSON.parse(bodyText) : null;
    } catch (_e) {
      parsed = null;
    }

    if (!response.ok) {
      return {
        success: false,
        skipped: false,
        reason: `Local report LLM endpoint HTTP ${response.status}`,
        error: parsed?.error || bodyText?.slice(0, 320) || `HTTP ${response.status}`,
      };
    }

    if (!parsed?.intent) {
      return {
        success: false,
        skipped: false,
        reason: 'Local report LLM endpoint sin intent valido.',
      };
    }

    return {
      success: true,
      data: {
        intent: normalizeIntent(parsed.intent || {}),
        summary: parsed?.summary ? String(parsed.summary).trim() : null,
        model: parsed?.model || 'local-llm-endpoint',
        usage: parsed?.usage || null,
        raw: parsed?.raw || parsed,
        cache_hit: false,
      },
    };
  } catch (error) {
    const isAbort = String(error?.name || '').toLowerCase() === 'aborterror';
    return {
      success: false,
      skipped: false,
      reason: isAbort ? `Local report LLM endpoint timeout (${timeoutMs}ms)` : 'Local report LLM endpoint error',
      error: String(error?.message || 'Local report LLM endpoint error'),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function parseReportQueryWithLocalLlm({
  tenantId,
  text,
  inputType = 'text',
  locationOptions = [],
}) {
  const mode = resolveLocalLlmMode();
  const timeoutMs = resolveTimeoutMs(mode);

  if (mode === 'embedded') {
    return parseReportQueryWithEmbeddedLlm({
      tenantId,
      text,
      locationOptions,
      timeoutMs,
    });
  }

  if (mode === 'endpoint') {
    return parseReportQueryWithEndpointLlm({
      tenantId,
      text,
      inputType,
      locationOptions,
    });
  }

  const embeddedResult = await parseReportQueryWithEmbeddedLlm({
    tenantId,
    text,
    locationOptions,
    timeoutMs,
  });
  if (embeddedResult.success) return embeddedResult;

  const endpointResult = await parseReportQueryWithEndpointLlm({
    tenantId,
    text,
    inputType,
    locationOptions,
  });
  if (endpointResult.success) return endpointResult;

  const embeddedReason = embeddedResult?.reason || embeddedResult?.error || 'embedded unavailable';
  const endpointReason = endpointResult?.reason || endpointResult?.error || 'endpoint unavailable';

  return {
    success: false,
    skipped: false,
    reason: `Local report LLM auto sin resultado. embedded=${embeddedReason}; endpoint=${endpointReason}`,
    error: endpointResult?.error || embeddedResult?.error || null,
  };
}
