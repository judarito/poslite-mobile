import AsyncStorage from '@react-native-async-storage/async-storage';

const WEB_CACHE_KEY = 'poslite_web_auth_cache';
const WEB_PENDING_KEY = 'poslite_web_pending_count';

export async function initOfflineDatabase() {}

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

export async function upsertSyncState(key, value) {
  await AsyncStorage.setItem(`sync_state_${key}`, JSON.stringify(value));
}

export async function enqueuePendingOp() {
  const current = Number((await AsyncStorage.getItem(WEB_PENDING_KEY)) || 0);
  await AsyncStorage.setItem(WEB_PENDING_KEY, String(current + 1));
}

export async function getPendingOpsCount() {
  return Number((await AsyncStorage.getItem(WEB_PENDING_KEY)) || 0);
}
