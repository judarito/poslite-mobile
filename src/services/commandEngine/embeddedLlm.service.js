import { ensureEmbeddedModelReady, getEmbeddedModelStatus } from './embeddedModel.service';

const DEFAULT_EMBEDDED_TIMEOUT_MS = Number(process.env.EXPO_PUBLIC_LOCAL_LLM_TIMEOUT_MS || 2600);
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

function normalizeLineItems(input) {
  const source = Array.isArray(input) ? input : [];
  return source
    .map((item) => ({
      raw_name: String(item?.raw_name || '').trim(),
      sku: item?.sku ? String(item.sku).trim() : null,
      quantity: Math.max(1, Math.round(Number(item?.quantity || 1))),
      unit_hint: item?.unit_hint ? String(item.unit_hint).trim() : null,
      unit_price: item?.unit_price == null ? null : Number(item.unit_price || 0),
    }))
    .filter((item) => item.raw_name);
}

function normalizeOrder(order) {
  const confidence = Number(order?.confidence || 0);
  return {
    customer_name: order?.customer_name ? String(order.customer_name).trim() : null,
    notes: order?.notes ? String(order.notes).trim() : null,
    confidence: Number.isFinite(confidence)
      ? Number(Math.max(0, Math.min(1, confidence)).toFixed(3))
      : 0,
  };
}

function withTimeout(promise, timeoutMs) {
  const timeout = Number.isFinite(Number(timeoutMs))
    ? Math.max(1200, Number(timeoutMs))
    : DEFAULT_EMBEDDED_TIMEOUT_MS;

  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const id = setTimeout(() => {
        clearTimeout(id);
        reject(new Error(`Embedded LLM timeout (${timeout}ms).`));
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

function buildMessages(text) {
  return [
    {
      role: 'system',
      content:
        'Eres un parser de comandos para POS. Debes responder SOLO JSON valido, sin markdown ni texto adicional.',
    },
    {
      role: 'user',
      content: `Convierte este texto en JSON EXACTO:\n\n{\n  "order": {\n    "customer_name": "string|null",\n    "notes": "string|null",\n    "confidence": number\n  },\n  "line_items": [\n    {\n      "raw_name": "string",\n      "sku": "string|null",\n      "quantity": number,\n      "unit_hint": "string|null",\n      "unit_price": number|null\n    }\n  ]\n}\n\nReglas:\n- No inventes productos no presentes en el texto.\n- quantity siempre > 0, si falta usa 1.\n- confidence entre 0 y 1.\n- Si no hay customer_name o notes, usa null.\n- Si no hay sku, usa null.\n- Conserva atributos de variante en raw_name (talla, color, presentacion, capacidad).\n- Responde SOLO JSON.\n\nTexto:\n\"\"\"${String(text || '').slice(0, 10000)}\"\"\"`,
    },
  ];
}

async function ensureContext(modelPath) {
  if (contextCache.context && contextCache.modelPath === modelPath) {
    return { success: true, context: contextCache.context, reused: true };
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
      return {
        success: false,
        error: 'llama.rn no expone initLlama().',
      };
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

    return { success: true, context, reused: false };
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

async function runCompletion(context, text, timeoutMs) {
  const payload = {
    messages: buildMessages(text),
    n_predict: 220,
    temperature: 0.1,
    stop: ['\n\n```'],
    response_format: {
      type: 'json_object',
    },
  };

  const completionFn =
    (typeof context?.completion === 'function' && context.completion.bind(context)) ||
    (typeof context?.chatCompletion === 'function' && context.chatCompletion.bind(context));

  if (!completionFn) {
    return {
      success: false,
      error: 'Contexto llama.rn no expone completion/chatCompletion.',
    };
  }

  try {
    const rawResult = await withTimeout(completionFn(payload), timeoutMs);
    const textResult = extractCompletionText(rawResult);
    if (!textResult) {
      return {
        success: false,
        error: 'LLM embebido no devolvio texto.',
      };
    }

    const parsed = parseJsonSafe(textResult);
    if (!parsed) {
      return {
        success: false,
        error: 'LLM embebido devolvio salida no parseable como JSON.',
      };
    }

    const lineItems = normalizeLineItems(parsed?.line_items);
    if (!lineItems.length) {
      return {
        success: false,
        error: 'LLM embebido no devolvio line_items validos.',
      };
    }

    return {
      success: true,
      data: {
        order: normalizeOrder(parsed?.order || {}),
        line_items: lineItems,
        model: 'qwen2.5-1.5b-embedded',
        usage: rawResult?.timings || null,
        raw: parsed,
        cache_hit: false,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: String(error?.message || 'Error ejecutando inferencia embedded.'),
    };
  }
}

export function isEmbeddedLlmModeEnabled() {
  const mode = String(process.env.EXPO_PUBLIC_LOCAL_LLM_MODE || 'auto').trim().toLowerCase();
  return mode === 'embedded' || mode === 'auto';
}

export async function getEmbeddedLlmStatus() {
  const modelStatus = await getEmbeddedModelStatus();
  const runtime = loadRuntimeModule();

  return {
    success: true,
    data: {
      mode: String(process.env.EXPO_PUBLIC_LOCAL_LLM_MODE || 'auto').trim().toLowerCase(),
      runtime_available: Boolean(runtime?.initLlama || runtime?.default?.initLlama),
      model: modelStatus,
    },
  };
}

export async function parseSaleCommandWithEmbeddedLlm({
  tenantId,
  text,
  timeoutMs = DEFAULT_EMBEDDED_TIMEOUT_MS,
}) {
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

  const completion = await runCompletion(contextResult.context, text, timeoutMs);
  if (!completion.success) {
    return {
      success: false,
      skipped: false,
      reason: completion.error || 'LLM embebido sin resultado valido.',
      error: completion.error || 'LLM embebido sin resultado valido.',
    };
  }

  return completion;
}
