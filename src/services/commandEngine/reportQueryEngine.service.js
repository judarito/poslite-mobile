import { analyzeReportQueryWithCloudLlm } from '../reportQueryAgent.service';
import { getUnifiedCommandCache, saveUnifiedCommandCache } from './localCache.service';
import { parseReportQueryWithLocalLlm } from './reportLocalLlm.service';
import { parseDeterministicReportQuery } from './reportDeterministicParser.service';
import { recordCommandEngineMetric, recordCommandEngineResolutionSource } from './metrics.service';
import { hashNormalizedText, normalizeCommandText } from './normalize.service';

const VALID_TABS = new Set(['sales', 'cash', 'inventory', 'financial', 'production']);

function buildEngineMeta({
  source,
  inputType,
  textHash,
  fallbackChain,
  cacheHit = false,
  upstreamCacheHit = false,
  originalSource = null,
  model = null,
  cacheInputType = null,
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
    cache_input_type: cacheInputType,
  };
}

function clampConfidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Number(Math.max(0, Math.min(1, parsed)).toFixed(3));
}

function normalizeIsoDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : text;
}

function buildLocationIndex(locationOptions = []) {
  const list = Array.isArray(locationOptions) ? locationOptions : [];
  return list
    .map((entry) => ({
      location_id: String(entry?.location_id || '').trim(),
      name: String(entry?.name || '').trim(),
      normalized_name: normalizeCommandText(entry?.name || ''),
    }))
    .filter((entry) => entry.location_id && entry.name && entry.normalized_name);
}

function resolveLocation(intent, locationOptions = []) {
  const index = buildLocationIndex(locationOptions);
  if (!index.length) {
    return {
      location_id: null,
      location_name: null,
      location_text: intent?.location_text ? String(intent.location_text).trim() : null,
    };
  }

  const explicitId = String(intent?.location_id || '').trim();
  if (explicitId) {
    const byId = index.find((entry) => entry.location_id === explicitId);
    if (byId) {
      return {
        location_id: byId.location_id,
        location_name: byId.name,
        location_text: byId.name,
      };
    }
  }

  const queryText = String(intent?.location_text || intent?.location_name || '').trim();
  const normalizedQuery = normalizeCommandText(queryText);
  if (!normalizedQuery) {
    return { location_id: null, location_name: null, location_text: null };
  }

  let best = null;
  index.forEach((entry) => {
    if (!normalizedQuery.includes(entry.normalized_name) && !entry.normalized_name.includes(normalizedQuery)) {
      return;
    }
    const score = Math.min(normalizedQuery.length, entry.normalized_name.length);
    if (!best || score > best.score) {
      best = { ...entry, score };
    }
  });

  if (!best) {
    return {
      location_id: null,
      location_name: null,
      location_text: queryText || null,
    };
  }

  return {
    location_id: best.location_id,
    location_name: best.name,
    location_text: best.name,
  };
}

function normalizeIntent(payload, locationOptions = []) {
  const tab = String(payload?.tab || '').trim().toLowerCase();
  const normalizedTab = VALID_TABS.has(tab) ? tab : null;

  const fromDate = normalizeIsoDate(payload?.from_date);
  const toDate = normalizeIsoDate(payload?.to_date);

  let finalFrom = fromDate;
  let finalTo = toDate;
  if (fromDate && toDate && fromDate > toDate) {
    finalFrom = toDate;
    finalTo = fromDate;
  }

  const location = resolveLocation(payload || {}, locationOptions);

  return {
    tab: normalizedTab,
    from_date: finalFrom,
    to_date: finalTo,
    location_id: location.location_id,
    location_name: location.location_name,
    location_text: location.location_text,
    notes: payload?.notes ? String(payload.notes).trim() : null,
    confidence: clampConfidence(payload?.confidence),
  };
}

function hasUsefulIntent(intent) {
  return Boolean(intent?.tab || intent?.from_date || intent?.to_date || intent?.location_id || intent?.location_text);
}

function normalizeResultShape(payload, locationOptions = []) {
  const intent = normalizeIntent(payload?.intent || {}, locationOptions);
  return {
    intent,
    summary: payload?.summary ? String(payload.summary).trim() : null,
    model: payload?.model || null,
    usage: payload?.usage || null,
    raw: payload?.raw || null,
    cache_hit: Boolean(payload?.cache_hit),
  };
}

function withEngine(payload, engineMeta, locationOptions) {
  return {
    ...normalizeResultShape(payload, locationOptions),
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

async function recordResolutionMetric({
  tenantId,
  source,
  inputType,
  cacheCrossInput = false,
}) {
  await recordCommandEngineResolutionSource({
    tenantId,
    source,
    inputType,
    cacheCrossInput,
  });
}

function buildReportsCatalogFingerprint(locationOptions = []) {
  const fingerprintText = (Array.isArray(locationOptions) ? locationOptions : [])
    .map((entry) => `${entry?.location_id || ''}:${normalizeCommandText(entry?.name || '')}`)
    .sort()
    .join('|');
  return `reports-v1:${hashNormalizedText(fingerprintText || 'no-locations')}`;
}

export async function resolveReportQueryFromText({
  tenantId,
  inputText,
  inputType = 'text',
  cacheInputType = null,
  offlineMode = false,
  locationOptions = [],
  skipCache = false,
  skipDeterministic = false,
  skipLocalLlm = false,
  forceCloud = false,
}) {
  if (!tenantId) {
    return { success: false, error: 'tenantId es requerido para Report Query Engine.' };
  }

  const text = String(inputText || '').trim();
  if (!text) {
    return { success: false, error: 'No hay texto para interpretar consulta.' };
  }

  const startedAtMs = Date.now();
  const normalizedText = normalizeCommandText(text);
  const textHash = hashNormalizedText(normalizedText);
  const fallbackChain = [];
  const shouldSkipCache = Boolean(skipCache || forceCloud);
  const shouldSkipDeterministic = Boolean(skipDeterministic || forceCloud);
  const shouldSkipLocalLlm = Boolean(skipLocalLlm || forceCloud);
  const effectiveCacheInputType = String(cacheInputType || inputType || 'text').trim() || 'text';
  const catalogFingerprint = buildReportsCatalogFingerprint(locationOptions);

  const cacheParams = {
    tenantId,
    inputType: effectiveCacheInputType,
    catalogFingerprint,
    textHash,
  };

  if (!shouldSkipCache) {
    fallbackChain.push('cache_lookup');
    const cached = await getUnifiedCommandCache(cacheParams);
    if (cached?.data?.intent && hasUsefulIntent(cached.data.intent)) {
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
          cacheInputType: effectiveCacheInputType,
        }),
        locationOptions,
      );

      await recordLayerMetric({
        tenantId,
        layer: 'reports_local_cache',
        success: true,
        cacheHit: true,
        startedAtMs,
      });
      await recordResolutionMetric({
        tenantId,
        source: 'local_cache',
        inputType,
        cacheCrossInput: effectiveCacheInputType !== inputType,
      });
      return { success: true, data: result };
    }

    await recordLayerMetric({
      tenantId,
      layer: 'reports_local_cache',
      success: false,
      cacheHit: false,
      startedAtMs,
    });
  }

  if (!shouldSkipDeterministic) {
    fallbackChain.push('deterministic_parser');
    const deterministic = parseDeterministicReportQuery(text, {
      locationOptions,
    });

    if (deterministic.success && hasUsefulIntent(deterministic?.data?.intent)) {
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
          cacheInputType: effectiveCacheInputType,
        }),
        locationOptions,
      );

      await saveUnifiedCommandCache(cacheParams, result);
      await recordLayerMetric({
        tenantId,
        layer: 'reports_deterministic_parser',
        success: true,
        cacheHit: false,
        startedAtMs,
      });
      await recordResolutionMetric({
        tenantId,
        source: 'deterministic_parser',
        inputType,
      });
      return { success: true, data: result };
    }

    await recordLayerMetric({
      tenantId,
      layer: 'reports_deterministic_parser',
      success: false,
      cacheHit: false,
      startedAtMs,
    });
  }

  let localLlm = { success: false, skipped: true, reason: 'local_llm skipped' };
  if (!shouldSkipLocalLlm) {
    fallbackChain.push('local_llm');
    localLlm = await parseReportQueryWithLocalLlm({
      tenantId,
      text,
      inputType,
      locationOptions,
    });

    if (localLlm.success && hasUsefulIntent(localLlm?.data?.intent)) {
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
          cacheInputType: effectiveCacheInputType,
        }),
        locationOptions,
      );

      await saveUnifiedCommandCache(cacheParams, result);
      await recordLayerMetric({
        tenantId,
        layer: 'reports_local_llm',
        success: true,
        cacheHit: false,
        startedAtMs,
      });
      await recordResolutionMetric({
        tenantId,
        source: 'local_llm',
        inputType,
      });
      return { success: true, data: result };
    }

    await recordLayerMetric({
      tenantId,
      layer: 'reports_local_llm',
      success: false,
      cacheHit: false,
      startedAtMs,
    });
  }

  if (offlineMode) {
    const localHint = localLlm.reason
      ? ` Detalle LLM local: ${localLlm.reason}.`
      : '';
    await recordLayerMetric({
      tenantId,
      layer: 'reports_offline_no_match',
      success: false,
      cacheHit: false,
      startedAtMs,
    });
    return {
      success: false,
      error: `Sin conexion: no fue posible interpretar la consulta en cache/parser/LLM local.${localHint}`,
    };
  }

  fallbackChain.push('cloud_llm');
  const cloud = await analyzeReportQueryWithCloudLlm({
    tenantId,
    queryText: text,
    locationOptions,
  });

  if (!cloud.success || !hasUsefulIntent(cloud?.data?.intent)) {
    await recordLayerMetric({
      tenantId,
      layer: 'reports_cloud_llm',
      success: false,
      cacheHit: false,
      startedAtMs,
    });
    return {
      success: false,
      error: cloud.error || 'No fue posible interpretar consulta con IA cloud.',
    };
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
      cacheInputType: effectiveCacheInputType,
    }),
    locationOptions,
  );

  await saveUnifiedCommandCache(cacheParams, cloudResult);
  await recordLayerMetric({
    tenantId,
    layer: 'reports_cloud_llm',
    success: true,
    cacheHit: Boolean(cloud?.data?.cache_hit),
    startedAtMs,
  });
  await recordResolutionMetric({
    tenantId,
    source: 'cloud_llm',
    inputType,
  });

  return {
    success: true,
    data: cloudResult,
  };
}
