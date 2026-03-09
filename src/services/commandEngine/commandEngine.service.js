import { analyzeChatOrderText } from '../chatOrderAgent.service';
import { getUnifiedCommandCache, saveUnifiedCommandCache } from './localCache.service';
import { parseSaleCommandWithLocalLlm } from './localLlm.service';
import { parseDeterministicSaleCommand } from './deterministicParser.service';
import { recordCommandEngineMetric } from './metrics.service';
import { hashNormalizedText, normalizeCommandText } from './normalize.service';

function buildEngineMeta({
  source,
  inputType,
  textHash,
  fallbackChain,
  cacheHit = false,
  upstreamCacheHit = false,
  originalSource = null,
  model = null,
}) {
  return {
    source,
    original_source: originalSource,
    cache_hit: cacheHit,
    upstream_cache_hit: upstreamCacheHit,
    input_type: inputType,
    text_hash: textHash,
    fallback_chain: fallbackChain,
    model,
  };
}

function normalizeResultShape(payload) {
  const lineItems = Array.isArray(payload?.line_items) ? payload.line_items : [];
  return {
    order: payload?.order || {},
    line_items: lineItems,
    model: payload?.model || null,
    usage: payload?.usage || null,
    raw: payload?.raw || null,
    cache_hit: Boolean(payload?.cache_hit),
  };
}

function withEngine(payload, engineMeta) {
  return {
    ...normalizeResultShape(payload),
    engine: engineMeta,
  };
}

async function recordLayerMetric({
  tenantId,
  layer,
  success,
  cacheHit = false,
  startedAtMs,
}) {
  const latencyMs = Math.max(0, Date.now() - Number(startedAtMs || Date.now()));
  await recordCommandEngineMetric({
    tenantId,
    layer,
    latencyMs,
    success,
    cacheHit,
  });
}

export async function resolveSaleCommandFromText({
  tenantId,
  inputText,
  inputType = 'text',
  offlineMode = false,
  catalogFingerprint = 'global',
}) {
  if (!tenantId) {
    return { success: false, error: 'tenantId es requerido para Command Engine.' };
  }

  const text = String(inputText || '').trim();
  if (!text) {
    return { success: false, error: 'No hay texto para interpretar comando.' };
  }

  const startedAtMs = Date.now();
  const normalizedText = normalizeCommandText(text);
  const textHash = hashNormalizedText(normalizedText);
  const fallbackChain = [];

  const cacheParams = {
    tenantId,
    inputType,
    catalogFingerprint,
    textHash,
  };

  fallbackChain.push('cache_lookup');
  const cached = await getUnifiedCommandCache(cacheParams);
  if (cached?.data?.line_items?.length) {
    const originalSource = cached?.data?.engine?.source || null;
    const result = withEngine(
      {
        ...cached.data,
        cache_hit: true,
      },
      buildEngineMeta({
        source: 'local_cache',
        originalSource,
        inputType,
        textHash,
        fallbackChain,
        cacheHit: true,
        upstreamCacheHit: Boolean(cached?.data?.engine?.upstream_cache_hit),
        model: cached?.data?.model || null,
      }),
    );
    await recordLayerMetric({
      tenantId,
      layer: 'local_cache',
      success: true,
      cacheHit: true,
      startedAtMs,
    });
    return {
      success: true,
      data: result,
    };
  }
  await recordLayerMetric({
    tenantId,
    layer: 'local_cache',
    success: false,
    cacheHit: false,
    startedAtMs,
  });

  fallbackChain.push('deterministic_parser');
  const deterministic = parseDeterministicSaleCommand(text);
  if (deterministic.success && deterministic?.data?.line_items?.length) {
    const result = withEngine(
      {
        ...deterministic.data,
        cache_hit: false,
      },
      buildEngineMeta({
        source: 'deterministic_parser',
        inputType,
        textHash,
        fallbackChain,
        model: deterministic?.data?.model || null,
      }),
    );

    await saveUnifiedCommandCache(cacheParams, result);
    await recordLayerMetric({
      tenantId,
      layer: 'deterministic_parser',
      success: true,
      cacheHit: false,
      startedAtMs,
    });
    return { success: true, data: result };
  }
  await recordLayerMetric({
    tenantId,
    layer: 'deterministic_parser',
    success: false,
    cacheHit: false,
    startedAtMs,
  });

  fallbackChain.push('local_llm');
  const localLlm = await parseSaleCommandWithLocalLlm({
    tenantId,
    text,
    inputType,
  });

  if (localLlm.success && localLlm?.data?.line_items?.length) {
    const result = withEngine(
      {
        ...localLlm.data,
        cache_hit: false,
      },
      buildEngineMeta({
        source: 'local_llm',
        inputType,
        textHash,
        fallbackChain,
        model: localLlm?.data?.model || 'local-llm',
      }),
    );

    await saveUnifiedCommandCache(cacheParams, result);
    await recordLayerMetric({
      tenantId,
      layer: 'local_llm',
      success: true,
      cacheHit: false,
      startedAtMs,
    });
    return { success: true, data: result };
  }
  await recordLayerMetric({
    tenantId,
    layer: 'local_llm',
    success: false,
    cacheHit: false,
    startedAtMs,
  });

  if (offlineMode) {
    const localHint = localLlm.reason
      ? ` Detalle LLM local: ${localLlm.reason}.`
      : '';
    await recordLayerMetric({
      tenantId,
      layer: 'offline_no_match',
      success: false,
      cacheHit: false,
      startedAtMs,
    });
    return {
      success: false,
      error: `Sin conexion: parser local no pudo interpretar el comando.${localHint}`,
    };
  }

  fallbackChain.push('cloud_llm');
  const cloud = await analyzeChatOrderText({
    tenantId,
    chatText: text,
  });

  if (!cloud.success) {
    await recordLayerMetric({
      tenantId,
      layer: 'cloud_llm',
      success: false,
      cacheHit: false,
      startedAtMs,
    });
    return { success: false, error: cloud.error || 'No fue posible interpretar comando con IA cloud.' };
  }

  const cloudResult = withEngine(
    {
      ...cloud.data,
      cache_hit: false,
    },
    buildEngineMeta({
      source: 'cloud_llm',
      inputType,
      textHash,
      fallbackChain,
      upstreamCacheHit: Boolean(cloud?.data?.cache_hit),
      model: cloud?.data?.model || null,
    }),
  );

  await saveUnifiedCommandCache(cacheParams, cloudResult);
  await recordLayerMetric({
    tenantId,
    layer: 'cloud_llm',
    success: true,
    cacheHit: Boolean(cloud?.data?.cache_hit),
    startedAtMs,
  });

  return {
    success: true,
    data: cloudResult,
  };
}
