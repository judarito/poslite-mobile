import { getSimpleCache, saveSimpleCache } from '../offlineCache.service';

const METRICS_VERSION = 'v1';
const MAX_LATENCY_SAMPLES = 120;

function metricsKey(tenantId) {
  return `command-engine-metrics:${METRICS_VERSION}:${tenantId || 'na'}`;
}

function nowIso() {
  return new Date().toISOString();
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function updateLayer(layerStats, latencyMs, success) {
  const current = layerStats || {
    count: 0,
    success: 0,
    failed: 0,
    total_latency_ms: 0,
    samples_ms: [],
  };

  const samples = Array.isArray(current.samples_ms) ? [...current.samples_ms] : [];
  samples.push(Math.max(0, Math.round(toNumber(latencyMs, 0))));
  while (samples.length > MAX_LATENCY_SAMPLES) {
    samples.shift();
  }

  return {
    count: Number(current.count || 0) + 1,
    success: Number(current.success || 0) + (success ? 1 : 0),
    failed: Number(current.failed || 0) + (success ? 0 : 1),
    total_latency_ms: Number(current.total_latency_ms || 0) + Math.max(0, Math.round(toNumber(latencyMs, 0))),
    samples_ms: samples,
  };
}

function computeP95(samples) {
  const list = Array.isArray(samples)
    ? samples.map((n) => Math.max(0, Math.round(toNumber(n, 0)))).sort((a, b) => a - b)
    : [];
  if (!list.length) return 0;
  const index = Math.min(list.length - 1, Math.ceil(list.length * 0.95) - 1);
  return list[index] || 0;
}

function normalizeBucketMap(rawMap) {
  if (!rawMap || typeof rawMap !== 'object') return {};
  const output = {};
  Object.entries(rawMap).forEach(([key, value]) => {
    const cleanKey = String(key || '').trim();
    if (!cleanKey) return;
    const count = Math.max(0, Math.round(toNumber(value, 0)));
    if (!count) return;
    output[cleanKey] = count;
  });
  return output;
}

function incrementBucket(map, key) {
  const cleanKey = String(key || '').trim();
  if (!cleanKey) return map || {};
  const base = normalizeBucketMap(map);
  base[cleanKey] = Number(base[cleanKey] || 0) + 1;
  return base;
}

export async function recordCommandEngineMetric({
  tenantId,
  layer,
  latencyMs,
  success,
  cacheHit = false,
}) {
  if (!tenantId || !layer) return;

  const key = metricsKey(tenantId);
  const cached = await getSimpleCache(key);
  const prev = cached?.value || {
    totals: {
      requests: 0,
      success: 0,
      failed: 0,
      cache_hits: 0,
    },
    layers: {},
    updated_at: nowIso(),
  };

  const totals = {
    requests: Number(prev?.totals?.requests || 0) + 1,
    success: Number(prev?.totals?.success || 0) + (success ? 1 : 0),
    failed: Number(prev?.totals?.failed || 0) + (success ? 0 : 1),
    cache_hits: Number(prev?.totals?.cache_hits || 0) + (cacheHit ? 1 : 0),
  };

  const nextLayer = updateLayer(prev?.layers?.[layer], latencyMs, success);
  const layers = {
    ...(prev?.layers || {}),
    [layer]: nextLayer,
  };

  await saveSimpleCache(key, {
    totals,
    layers,
    resolution: prev?.resolution || { total: 0, sources: {}, input_types: {}, cache_cross_input_hits: 0 },
    updated_at: nowIso(),
  });
}

export async function recordCommandEngineResolutionSource({
  tenantId,
  source,
  inputType = null,
  cacheCrossInput = false,
}) {
  if (!tenantId || !source) return;

  const key = metricsKey(tenantId);
  const cached = await getSimpleCache(key);
  const prev = cached?.value || {
    totals: {
      requests: 0,
      success: 0,
      failed: 0,
      cache_hits: 0,
    },
    layers: {},
    resolution: { total: 0, sources: {}, input_types: {}, cache_cross_input_hits: 0 },
    updated_at: nowIso(),
  };

  const previousResolution = prev?.resolution || { total: 0, sources: {}, input_types: {}, cache_cross_input_hits: 0 };
  const nextResolution = {
    total: Number(previousResolution?.total || 0) + 1,
    sources: incrementBucket(previousResolution?.sources, source),
    input_types: inputType ? incrementBucket(previousResolution?.input_types, inputType) : normalizeBucketMap(previousResolution?.input_types),
    cache_cross_input_hits: Number(previousResolution?.cache_cross_input_hits || 0) + (cacheCrossInput ? 1 : 0),
  };

  await saveSimpleCache(key, {
    totals: prev?.totals || { requests: 0, success: 0, failed: 0, cache_hits: 0 },
    layers: prev?.layers || {},
    resolution: nextResolution,
    updated_at: nowIso(),
  });
}

export async function getCommandEngineMetrics(tenantId) {
  if (!tenantId) return { success: false, error: 'tenantId requerido.' };

  const key = metricsKey(tenantId);
  const cached = await getSimpleCache(key);
  const raw = cached?.value || null;

  if (!raw) {
    return {
      success: true,
      data: {
        totals: { requests: 0, success: 0, failed: 0, cache_hits: 0, hit_rate: 0 },
        layers: {},
        resolution: {
          total: 0,
          sources: {},
          input_types: {},
          cache_cross_input_hits: 0,
        },
        updated_at: null,
      },
    };
  }

  const requests = Number(raw?.totals?.requests || 0);
  const cacheHits = Number(raw?.totals?.cache_hits || 0);
  const layers = {};
  const resolutionRaw = raw?.resolution || {};
  const sourceCounts = normalizeBucketMap(resolutionRaw?.sources);
  const inputTypeCounts = normalizeBucketMap(resolutionRaw?.input_types);
  const resolutionTotalFromBuckets = Object.values(sourceCounts).reduce((sum, value) => sum + Number(value || 0), 0);
  const resolutionTotal = Math.max(
    Number(resolutionRaw?.total || 0),
    Number(resolutionTotalFromBuckets || 0),
  );
  const resolutionSources = {};
  Object.entries(sourceCounts).forEach(([source, count]) => {
    resolutionSources[source] = {
      count,
      share: resolutionTotal > 0 ? Number((Number(count) / resolutionTotal).toFixed(4)) : 0,
    };
  });

  const resolutionInputTypes = {};
  Object.entries(inputTypeCounts).forEach(([inputType, count]) => {
    resolutionInputTypes[inputType] = {
      count,
      share: resolutionTotal > 0 ? Number((Number(count) / resolutionTotal).toFixed(4)) : 0,
    };
  });

  Object.entries(raw?.layers || {}).forEach(([layer, stats]) => {
    const count = Number(stats?.count || 0);
    const success = Number(stats?.success || 0);
    const failed = Number(stats?.failed || 0);
    const totalLatency = Number(stats?.total_latency_ms || 0);
    const samples = Array.isArray(stats?.samples_ms) ? stats.samples_ms : [];

    layers[layer] = {
      count,
      success,
      failed,
      avg_latency_ms: count > 0 ? Math.round(totalLatency / count) : 0,
      p95_latency_ms: computeP95(samples),
      success_rate: count > 0 ? Number((success / count).toFixed(4)) : 0,
    };
  });

  return {
    success: true,
    data: {
      totals: {
        requests,
        success: Number(raw?.totals?.success || 0),
        failed: Number(raw?.totals?.failed || 0),
        cache_hits: cacheHits,
        hit_rate: requests > 0 ? Number((cacheHits / requests).toFixed(4)) : 0,
      },
      layers,
      resolution: {
        total: resolutionTotal,
        sources: resolutionSources,
        input_types: resolutionInputTypes,
        cache_cross_input_hits: Number(resolutionRaw?.cache_cross_input_hits || 0),
      },
      updated_at: raw?.updated_at || null,
    },
  };
}
