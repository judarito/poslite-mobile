import { getSimpleCache, saveSimpleCache } from '../offlineCache.service';

const CACHE_VERSION = 'v1';
const DEFAULT_TTL_HOURS = 24 * 7;

function buildCacheKey({ tenantId, inputType = 'text', textHash, catalogFingerprint = 'global' }) {
  return `command-engine:${CACHE_VERSION}:${tenantId}:${inputType}:${catalogFingerprint}:${textHash}`;
}

function getTtlMs() {
  const raw = Number(process.env.EXPO_PUBLIC_COMMAND_CACHE_TTL_HOURS || DEFAULT_TTL_HOURS);
  const hours = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_HOURS;
  return hours * 60 * 60 * 1000;
}

function isExpired(expiresAtIso) {
  if (!expiresAtIso) return true;
  const expiresAt = new Date(expiresAtIso).getTime();
  if (!Number.isFinite(expiresAt)) return true;
  return Date.now() >= expiresAt;
}

export async function getUnifiedCommandCache(params) {
  const key = buildCacheKey(params);
  const cached = await getSimpleCache(key);
  const payload = cached?.value || null;
  if (!payload) return null;

  if (isExpired(payload.expires_at)) {
    return null;
  }

  return payload;
}

export async function saveUnifiedCommandCache(params, resultPayload) {
  const key = buildCacheKey(params);
  const ttlMs = getTtlMs();
  const now = Date.now();

  await saveSimpleCache(key, {
    data: resultPayload,
    cached_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttlMs).toISOString(),
  });
}
