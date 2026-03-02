import { getSyncState, upsertSyncState } from '../storage/sqlite/database';

const CACHE_PREFIX = 'cache';

function safeSerialize(filters) {
  try {
    return JSON.stringify(filters || {});
  } catch (_e) {
    return '{}';
  }
}

function buildKey(namespace, tenantId, page, pageSize, filters) {
  return `${CACHE_PREFIX}:${namespace}:${tenantId || 'na'}:${page || 1}:${pageSize || 20}:${safeSerialize(filters)}`;
}

export async function savePageCache({ namespace, tenantId, page, pageSize, filters, items, total }) {
  const key = buildKey(namespace, tenantId, page, pageSize, filters);
  await upsertSyncState(key, {
    items: items || [],
    total: Number(total || 0),
    cachedAt: new Date().toISOString(),
  });
}

export async function getPageCache({ namespace, tenantId, page, pageSize, filters }) {
  const key = buildKey(namespace, tenantId, page, pageSize, filters);
  const row = await getSyncState(key);
  if (!row?.value) return null;
  return row.value;
}

export async function saveSimpleCache(namespace, value) {
  await upsertSyncState(`${CACHE_PREFIX}:${namespace}`, {
    value,
    cachedAt: new Date().toISOString(),
  });
}

export async function getSimpleCache(namespace) {
  const row = await getSyncState(`${CACHE_PREFIX}:${namespace}`);
  return row?.value || null;
}
