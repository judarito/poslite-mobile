import AsyncStorage from '@react-native-async-storage/async-storage';

const WEB_CACHE_KEY = 'poslite_web_auth_cache';
const WEB_PENDING_KEY = 'poslite_web_pending_count';
const WEB_MENU_KEY = 'poslite_web_menu_cache';
const WEB_PENDING_OPS_KEY = 'poslite_web_pending_ops';

export async function initOfflineDatabase() {}

function normalizePendingQueryInput(input, defaultLimit = 50) {
  if (typeof input === 'number') {
    return {
      limit: Number.isFinite(input) ? Math.max(1, Math.floor(input)) : defaultLimit,
      tenantId: null,
      userId: null,
    };
  }

  const options = input || {};
  const parsedLimit = Number(options.limit || defaultLimit);
  return {
    limit: Number.isFinite(parsedLimit) ? Math.max(1, Math.floor(parsedLimit)) : defaultLimit,
    tenantId: options.tenantId || null,
    userId: options.userId || null,
  };
}

export async function saveAuthCache({ authUserId, userProfile, tenant }) {
  const payload = {
    authUserId,
    userProfile,
    tenant: tenant || {},
    cachedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(WEB_CACHE_KEY, JSON.stringify(payload));
}

export async function getAuthCache() {
  const raw = await AsyncStorage.getItem(WEB_CACHE_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function clearAuthCache() {
  await AsyncStorage.removeItem(WEB_CACHE_KEY);
}

export async function saveMenuCache({ authUserId, menuTree }) {
  const payload = {
    authUserId,
    menuTree: menuTree || [],
    cachedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(WEB_MENU_KEY, JSON.stringify(payload));
}

export async function getMenuCache() {
  const raw = await AsyncStorage.getItem(WEB_MENU_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function clearMenuCache() {
  await AsyncStorage.removeItem(WEB_MENU_KEY);
}

export async function upsertSyncState(key, value) {
  await AsyncStorage.setItem(`sync_state_${key}`, JSON.stringify(value));
}

export async function getSyncState(key) {
  const raw = await AsyncStorage.getItem(`sync_state_${key}`);
  if (!raw) return null;
  return {
    value: JSON.parse(raw),
    updatedAt: null,
  };
}

export async function clearSyncState(key) {
  await AsyncStorage.removeItem(`sync_state_${key}`);
}

export async function enqueuePendingOp(op = {}) {
  const raw = await AsyncStorage.getItem(WEB_PENDING_OPS_KEY);
  const list = raw ? JSON.parse(raw) : [];
  list.push({
    opId: op.opId,
    opType: op.opType,
    tenantId: op.tenantId,
    userId: op.userId,
    deviceId: op.deviceId,
    payload: op.payload || {},
    status: 'PENDING',
    retryCount: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await AsyncStorage.setItem(WEB_PENDING_OPS_KEY, JSON.stringify(list));
  await AsyncStorage.setItem(
    WEB_PENDING_KEY,
    String(list.filter((op) => op.status === 'PENDING' || op.status === 'FAILED').length),
  );
}

export async function getPendingOpsCount(filters = {}) {
  const tenantId = filters?.tenantId || null;
  const userId = filters?.userId || null;
  const raw = await AsyncStorage.getItem(WEB_PENDING_OPS_KEY);
  const list = raw ? JSON.parse(raw) : [];
  return list.filter(
    (op) =>
      (op.status === 'PENDING' || op.status === 'FAILED') &&
      (!tenantId || op.tenantId === tenantId) &&
      (!userId || op.userId === userId),
  ).length;
}

export async function getPendingOps(input = 50) {
  const { limit, tenantId, userId } = normalizePendingQueryInput(input, 50);
  const raw = await AsyncStorage.getItem(WEB_PENDING_OPS_KEY);
  const list = raw ? JSON.parse(raw) : [];
  return list
    .filter(
      (op) =>
        (op.status === 'PENDING' || op.status === 'FAILED') &&
        !String(op.lastError || '').startsWith('NO_RETRY:') &&
        (!tenantId || op.tenantId === tenantId) &&
        (!userId || op.userId === userId),
    )
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(0, limit);
}

async function updatePendingList(transform) {
  const raw = await AsyncStorage.getItem(WEB_PENDING_OPS_KEY);
  const list = raw ? JSON.parse(raw) : [];
  const next = transform(list);
  await AsyncStorage.setItem(WEB_PENDING_OPS_KEY, JSON.stringify(next));
  await AsyncStorage.setItem(
    WEB_PENDING_KEY,
    String(next.filter((op) => op.status === 'PENDING' || op.status === 'FAILED').length),
  );
}

export async function markPendingOpProcessing(opId) {
  await updatePendingList((list) =>
    list.map((op) =>
      op.opId === opId ? { ...op, status: 'PROCESSING', updatedAt: new Date().toISOString() } : op,
    ),
  );
}

export async function markPendingOpDone(opId) {
  await updatePendingList((list) =>
    list.map((op) =>
      op.opId === opId
        ? {
            ...op,
            status: 'DONE',
            lastError: null,
            updatedAt: new Date().toISOString(),
          }
        : op,
    ),
  );
}

export async function markPendingOpFailed(opId, errorMessage) {
  await updatePendingList((list) =>
    list.map((op) =>
      op.opId === opId
        ? {
            ...op,
            status: 'FAILED',
            retryCount: Number(op.retryCount || 0) + 1,
            lastError: String(errorMessage || 'Error desconocido'),
            updatedAt: new Date().toISOString(),
          }
        : op,
    ),
  );
}

export async function resetStuckProcessingOps() {
  await updatePendingList((list) =>
    list.map((op) =>
      op.status === 'PROCESSING'
        ? { ...op, status: 'PENDING', updatedAt: new Date().toISOString() }
        : op,
    ),
  );
}

export async function getPendingSaleOps(tenantId, limit = 200) {
  const raw = await AsyncStorage.getItem(WEB_PENDING_OPS_KEY);
  const list = raw ? JSON.parse(raw) : [];
  return list
    .filter(
      (op) =>
        op.opType === 'CREATE_SALE' &&
        op.tenantId === tenantId &&
        (op.status === 'PENDING' || op.status === 'FAILED'),
    )
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

export async function getPendingSaleOpById(opId) {
  const raw = await AsyncStorage.getItem(WEB_PENDING_OPS_KEY);
  const list = raw ? JSON.parse(raw) : [];
  const found = list.find(
    (op) =>
      op.opType === 'CREATE_SALE' &&
      op.opId === opId &&
      (op.status === 'PENDING' || op.status === 'FAILED'),
  );
  return found || null;
}

export async function retryPendingOp(opId) {
  await updatePendingList((list) =>
    list.map((op) =>
      op.opId === opId
        ? {
            ...op,
            status: 'PENDING',
            lastError: null,
            updatedAt: new Date().toISOString(),
          }
        : op,
    ),
  );
}

export async function discardPendingOp(opId) {
  await updatePendingList((list) => list.filter((op) => op.opId !== opId));
}

export async function updatePendingOpPayload(opId, payload) {
  await updatePendingList((list) =>
    list.map((op) =>
      op.opId === opId
        ? {
            ...op,
            payload: payload || {},
            updatedAt: new Date().toISOString(),
          }
      : op,
    ),
  );
}

export async function clearOfflineOperationalData() {
  await AsyncStorage.removeItem(WEB_PENDING_KEY);
  await AsyncStorage.removeItem(WEB_PENDING_OPS_KEY);

  const allKeys = await AsyncStorage.getAllKeys();
  const syncKeys = allKeys.filter((key) => key.startsWith('sync_state_'));
  if (syncKeys.length > 0) {
    await AsyncStorage.multiRemove(syncKeys);
  }
}
