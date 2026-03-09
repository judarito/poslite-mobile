import { parseSaleCommandWithEmbeddedLlm } from './embeddedLlm.service';

const LOCAL_LLM_ENDPOINT = process.env.EXPO_PUBLIC_LOCAL_LLM_PARSER_URL || '';
const DEFAULT_TIMEOUT_MS = 2200;
const MIN_EMBEDDED_TIMEOUT_MS = 8000;

function normalizeLines(lines) {
  const source = Array.isArray(lines) ? lines : [];
  return source
    .map((item) => ({
      raw_name: String(item?.raw_name || '').trim(),
      sku: item?.sku ? String(item.sku).trim() : null,
      quantity: Math.max(1, Number(item?.quantity || 1)),
      unit_hint: item?.unit_hint ? String(item.unit_hint).trim() : null,
      unit_price: item?.unit_price == null ? null : Number(item.unit_price || 0),
    }))
    .filter((item) => item.raw_name);
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

export function isLocalLlmConfigured() {
  const mode = resolveLocalLlmMode();
  if (mode === 'embedded') return true;
  if (mode === 'endpoint') return Boolean(String(LOCAL_LLM_ENDPOINT || '').trim());
  return true;
}

export async function parseSaleCommandWithEndpointLlm({ tenantId, text, inputType = 'text' }) {
  if (!tenantId) return { success: false, skipped: true, reason: 'tenantId requerido.' };
  if (!String(LOCAL_LLM_ENDPOINT || '').trim()) {
    return {
      success: false,
      skipped: true,
      reason: 'Local LLM endpoint no configurado (EXPO_PUBLIC_LOCAL_LLM_PARSER_URL).',
    };
  }

  const controller = new AbortController();
  const timeoutMs = resolveTimeoutMs('endpoint');
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(LOCAL_LLM_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tenant_id: tenantId,
        input_type: inputType,
        text: String(text || '').slice(0, 10000),
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
        reason: `Local LLM endpoint HTTP ${response.status}`,
        error: parsed?.error || bodyText?.slice(0, 320) || `HTTP ${response.status}`,
      };
    }

    const lineItems = normalizeLines(parsed?.line_items);
    if (!lineItems.length) {
      return {
        success: false,
        skipped: false,
        reason: 'Local LLM endpoint sin line_items validos.',
      };
    }

    return {
      success: true,
      data: {
        order: normalizeOrder(parsed?.order || {}),
        line_items: lineItems,
        model: parsed?.model || 'local-llm-endpoint',
        usage: parsed?.usage || null,
        raw: parsed?.raw || parsed || null,
        cache_hit: false,
      },
    };
  } catch (error) {
    const isAbort = String(error?.name || '').toLowerCase() === 'aborterror';
    return {
      success: false,
      skipped: false,
      reason: isAbort ? `Local LLM endpoint timeout (${timeoutMs}ms)` : 'Local LLM endpoint error',
      error: String(error?.message || 'Local LLM endpoint error'),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function parseSaleCommandWithLocalLlm({ tenantId, text, inputType = 'text' }) {
  const mode = resolveLocalLlmMode();
  const timeoutMs = resolveTimeoutMs(mode);

  if (mode === 'embedded') {
    return parseSaleCommandWithEmbeddedLlm({
      tenantId,
      text,
      timeoutMs,
    });
  }

  if (mode === 'endpoint') {
    return parseSaleCommandWithEndpointLlm({
      tenantId,
      text,
      inputType,
    });
  }

  const embeddedResult = await parseSaleCommandWithEmbeddedLlm({
    tenantId,
    text,
    timeoutMs,
  });
  if (embeddedResult.success) return embeddedResult;

  const endpointResult = await parseSaleCommandWithEndpointLlm({
    tenantId,
    text,
    inputType,
  });
  if (endpointResult.success) return endpointResult;

  const embeddedReason = embeddedResult?.reason || embeddedResult?.error || 'embedded unavailable';
  const endpointReason = endpointResult?.reason || endpointResult?.error || 'endpoint unavailable';

  return {
    success: false,
    skipped: false,
    reason: `Local LLM auto sin resultado. embedded=${embeddedReason}; endpoint=${endpointReason}`,
    error: endpointResult?.error || embeddedResult?.error || null,
  };
}
