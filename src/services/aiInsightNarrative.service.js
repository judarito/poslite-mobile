import { supabase } from '../lib/supabase';
import { ensureEmbeddedModelReady } from './commandEngine/embeddedModel.service';
import { getSimpleCache, saveSimpleCache } from './offlineCache.service';

const TEXT_EDGE_FUNCTION = process.env.EXPO_PUBLIC_DEEPSEEK_TEXT_EDGE_FUNCTION || 'deepseek-proxy';
const DEFAULT_TEXT_MODEL = process.env.EXPO_PUBLIC_DEEPSEEK_TEXT_MODEL || 'deepseek-chat';
const LOCAL_INSIGHTS_LLM_ENDPOINT = process.env.EXPO_PUBLIC_LOCAL_LLM_INSIGHTS_URL || '';
const DEFAULT_TIMEOUT_MS = 2200;
const MIN_EMBEDDED_TIMEOUT_MS = 8000;
const DEFAULT_CONTEXT = Number(process.env.EXPO_PUBLIC_EMBEDDED_LLM_CONTEXT_SIZE || 2048);

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

function normalizeArray(values, max = 4) {
  return (Array.isArray(values) ? values : [])
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .slice(0, max);
}

function clampConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(Math.max(0, Math.min(1, n)).toFixed(2));
}

function normalizeNarrative(data = {}) {
  const summary = String(data?.narrative_summary || data?.summary || '').trim();
  return {
    narrative_summary: summary || null,
    actions: normalizeArray(data?.actions),
    risks: normalizeArray(data?.risks),
    confidence: clampConfidence(data?.confidence),
  };
}

function hasUsefulNarrative(payload) {
  return Boolean(
    payload?.narrative_summary ||
      (Array.isArray(payload?.actions) && payload.actions.length > 0) ||
      (Array.isArray(payload?.risks) && payload.risks.length > 0),
  );
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

function resolveLocalLlmMode() {
  const mode = String(process.env.EXPO_PUBLIC_LOCAL_LLM_MODE || 'auto').trim().toLowerCase();
  if (mode === 'embedded') return 'embedded';
  if (mode === 'endpoint') return 'endpoint';
  return 'auto';
}

function resolveTimeoutMs(mode = 'auto') {
  const parsed = Number(process.env.EXPO_PUBLIC_LOCAL_LLM_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const resolved = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
  if (mode === 'embedded' || mode === 'auto') {
    return Math.max(MIN_EMBEDDED_TIMEOUT_MS, resolved);
  }
  return resolved;
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
        reject(new Error(`Embedded insights LLM timeout (${timeout}ms).`));
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

function summarizeInsightForPrompt(insight = {}) {
  const highlights = (Array.isArray(insight?.highlights) ? insight.highlights : [])
    .slice(0, 8)
    .map((h) => `${h?.label || 'dato'}: ${h?.value ?? '-'}`)
    .join(' | ');

  const findings = (Array.isArray(insight?.findings) ? insight.findings : [])
    .slice(0, 8)
    .map((f) => `${f?.label || '-'} => ${f?.value || '-'}${f?.meta ? ` (${f.meta})` : ''}`)
    .join(' | ');

  const recs = (Array.isArray(insight?.recommendations) ? insight.recommendations : [])
    .slice(0, 5)
    .map((r) => String(r || '').trim())
    .filter(Boolean)
    .join(' | ');

  return {
    insight_id: insight?.insightId || null,
    title: insight?.title || 'Analisis IA',
    summary: insight?.summary || '',
    highlights,
    findings,
    recommendations: recs,
  };
}

function buildMessages(insight) {
  const payload = summarizeInsightForPrompt(insight);
  const payloadText = JSON.stringify(payload, null, 2);
  return [
    {
      role: 'system',
      content:
        'Eres analista de negocio para POS. SOLO puedes usar los datos entregados. No inventes cifras ni entidades. Responde SOLO JSON valido.',
    },
    {
      role: 'user',
      content: `Genera narrativa ejecutiva a partir de este analisis deterministico.

Responde JSON EXACTO:
{
  "narrative_summary": "string",
  "actions": ["string", "string"],
  "risks": ["string"],
  "confidence": number
}

Reglas:
- Usa maximo 1 linea para narrative_summary.
- actions: 2 a 4 acciones concretas.
- risks: 0 a 3 riesgos clave.
- confidence entre 0 y 1.
- No inventes numeros nuevos, solo reusa la info disponible.
- Responde SOLO JSON.

ANALISIS:
${payloadText}`,
    },
  ];
}

async function parseNarrativeWithEmbeddedLlm({ tenantId, insight, timeoutMs }) {
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
    };
  }

  const completionFn =
    (typeof contextResult.context?.completion === 'function' && contextResult.context.completion.bind(contextResult.context)) ||
    (typeof contextResult.context?.chatCompletion === 'function' && contextResult.context.chatCompletion.bind(contextResult.context));

  if (!completionFn) {
    return {
      success: false,
      skipped: false,
      reason: 'Contexto llama.rn no expone completion/chatCompletion.',
    };
  }

  try {
    const rawResult = await withTimeout(
      completionFn({
        messages: buildMessages(insight),
        n_predict: 220,
        temperature: 0.1,
        response_format: {
          type: 'json_object',
        },
      }),
      timeoutMs,
    );

    const responseText = extractCompletionText(rawResult);
    const parsed = parseJsonSafe(responseText);
    const normalized = normalizeNarrative(parsed || {});
    if (!hasUsefulNarrative(normalized)) {
      return {
        success: false,
        skipped: false,
        reason: 'LLM local embebido no produjo narrativa util.',
      };
    }

    return {
      success: true,
      data: {
        ...normalized,
        model: 'qwen2.5-1.5b-embedded',
      },
    };
  } catch (error) {
    return {
      success: false,
      skipped: false,
      reason: String(error?.message || 'Error ejecutando LLM local embebido.'),
    };
  }
}

async function parseNarrativeWithEndpointLlm({ tenantId, insight }) {
  if (!tenantId) return { success: false, skipped: true, reason: 'tenantId requerido.' };

  const endpoint = String(LOCAL_INSIGHTS_LLM_ENDPOINT || '').trim();
  if (!endpoint) {
    return {
      success: false,
      skipped: true,
      reason: 'Local insights LLM endpoint no configurado (EXPO_PUBLIC_LOCAL_LLM_INSIGHTS_URL).',
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
        insight: summarizeInsightForPrompt(insight),
      }),
      signal: controller.signal,
    });

    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch (_e) {
      parsed = null;
    }

    if (!response.ok) {
      return {
        success: false,
        skipped: false,
        reason: `Local insights LLM endpoint HTTP ${response.status}`,
      };
    }

    const payload = normalizeNarrative(parsed?.data || parsed || {});
    if (!hasUsefulNarrative(payload)) {
      return {
        success: false,
        skipped: false,
        reason: 'Local insights endpoint no devolvio narrativa valida.',
      };
    }

    return {
      success: true,
      data: {
        ...payload,
        model: parsed?.model || 'local-llm-insights-endpoint',
      },
    };
  } catch (error) {
    const isAbort = String(error?.name || '').toLowerCase() === 'aborterror';
    return {
      success: false,
      skipped: false,
      reason: isAbort ? `Local insights endpoint timeout (${timeoutMs}ms)` : 'Local insights endpoint error',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function parseNarrativeWithLocalLlm({ tenantId, insight }) {
  const mode = resolveLocalLlmMode();
  const timeoutMs = resolveTimeoutMs(mode);

  if (mode === 'embedded') {
    return parseNarrativeWithEmbeddedLlm({
      tenantId,
      insight,
      timeoutMs,
    });
  }

  if (mode === 'endpoint') {
    return parseNarrativeWithEndpointLlm({
      tenantId,
      insight,
    });
  }

  const embedded = await parseNarrativeWithEmbeddedLlm({
    tenantId,
    insight,
    timeoutMs,
  });
  if (embedded.success) return embedded;

  const endpoint = await parseNarrativeWithEndpointLlm({
    tenantId,
    insight,
  });
  if (endpoint.success) return endpoint;

  return {
    success: false,
    skipped: false,
    reason: `Local insights LLM auto sin resultado. embedded=${embedded.reason || 'na'}; endpoint=${endpoint.reason || 'na'}`,
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

async function parseNarrativeWithCloudLlm({ tenantId, insight }) {
  if (!tenantId) {
    return { success: false, error: 'tenantId es requerido.' };
  }

  const { data, error } = await supabase.functions.invoke(TEXT_EDGE_FUNCTION, {
    body: {
      model: DEFAULT_TEXT_MODEL,
      temperature: 0.1,
      max_tokens: 700,
      messages: buildMessages(insight),
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
  const normalized = normalizeNarrative(parsed || {});
  if (!hasUsefulNarrative(normalized)) {
    return { success: false, error: 'Cloud LLM no devolvio narrativa valida.' };
  }

  return {
    success: true,
    data: {
      ...normalized,
      model: data?.model || null,
      usage: data?.usage || null,
    },
  };
}

function narrativeCacheKey(tenantId, insightId) {
  return `ai-narrative:${tenantId || 'na'}:${insightId || 'na'}`;
}

export async function generateInsightNarrative({
  tenantId,
  insight,
  offlineMode = false,
  skipLocalLlm = false,
  forceCloud = false,
}) {
  if (!tenantId) {
    return { success: false, error: 'tenantId es requerido.' };
  }
  const insightId = String(insight?.insightId || '').trim();
  if (!insightId) {
    return { success: false, error: 'insightId es requerido para narrativa.' };
  }

  const cacheKey = narrativeCacheKey(tenantId, insightId);

  if (offlineMode) {
    const cached = await getSimpleCache(cacheKey);
    if (cached?.value) {
      return {
        success: true,
        data: {
          ...cached.value,
          engine: {
            ...(cached.value?.engine || {}),
            source: 'cache_local',
            cachedAt: cached.cachedAt || null,
          },
        },
      };
    }
    return { success: false, error: 'Modo offline: no hay narrativa IA cacheada para este analisis.' };
  }

  const fallbackChain = [];

  if (!skipLocalLlm && !forceCloud) {
    fallbackChain.push('local_llm');
    const local = await parseNarrativeWithLocalLlm({
      tenantId,
      insight,
    });

    if (local.success && hasUsefulNarrative(local.data)) {
      const result = {
        ...local.data,
        engine: {
          source: 'local_llm',
          fallback_chain: fallbackChain,
          model: local?.data?.model || 'local-llm',
        },
      };
      await saveSimpleCache(cacheKey, result);
      return { success: true, data: result };
    }
  }

  fallbackChain.push('cloud_llm');
  const cloud = await parseNarrativeWithCloudLlm({
    tenantId,
    insight,
  });

  if (cloud.success && hasUsefulNarrative(cloud.data)) {
    const result = {
      ...cloud.data,
      engine: {
        source: 'cloud_llm',
        fallback_chain: fallbackChain,
        model: cloud?.data?.model || null,
      },
    };
    await saveSimpleCache(cacheKey, result);
    return { success: true, data: result };
  }

  const cached = await getSimpleCache(cacheKey);
  if (cached?.value) {
    return {
      success: true,
      data: {
        ...cached.value,
        engine: {
          ...(cached.value?.engine || {}),
          source: 'cache_fallback',
          fallback_chain: fallbackChain,
          warning: cloud.error || 'No se pudo generar narrativa actual.',
          cachedAt: cached.cachedAt || null,
        },
      },
    };
  }

  return {
    success: false,
    error: cloud.error || 'No fue posible generar narrativa IA.',
  };
}
