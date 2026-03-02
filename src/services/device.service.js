import { getSyncState, upsertSyncState } from '../storage/sqlite/database';

const DEVICE_KEY = 'device_id';

function generateDeviceId() {
  const rand = Math.random().toString(36).slice(2, 10);
  return `dev_${Date.now().toString(36)}_${rand}`;
}

export async function getOrCreateDeviceId() {
  const stored = await getSyncState(DEVICE_KEY);
  if (stored?.value?.deviceId) {
    return stored.value.deviceId;
  }

  const deviceId = generateDeviceId();
  await upsertSyncState(DEVICE_KEY, { deviceId });
  return deviceId;
}
