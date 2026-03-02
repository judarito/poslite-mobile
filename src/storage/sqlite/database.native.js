import * as SQLite from 'expo-sqlite';

const DB_NAME = 'poslite_mobile.db';

let dbPromise = null;

async function getDb() {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  }
  return dbPromise;
}

export async function initOfflineDatabase() {
  const db = await getDb();

  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS local_sales_draft (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      location_id TEXT,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_sale_lines_draft (
      id TEXT PRIMARY KEY,
      sale_draft_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_payments_draft (
      id TEXT PRIMARY KEY,
      sale_draft_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_cartera_payments_draft (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_supplier_payments_draft (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_ops (
      op_id TEXT PRIMARY KEY,
      op_type TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pending_ops_status_created
      ON pending_ops (status, created_at);

    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_cache (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      auth_user_id TEXT NOT NULL,
      user_profile_json TEXT NOT NULL,
      tenant_json TEXT NOT NULL,
      cached_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS menu_cache (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      auth_user_id TEXT NOT NULL,
      menu_json TEXT NOT NULL,
      cached_at TEXT NOT NULL
    );
  `);
}

export async function saveAuthCache({ authUserId, userProfile, tenant }) {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `
      INSERT INTO auth_cache (id, auth_user_id, user_profile_json, tenant_json, cached_at)
      VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        auth_user_id = excluded.auth_user_id,
        user_profile_json = excluded.user_profile_json,
        tenant_json = excluded.tenant_json,
        cached_at = excluded.cached_at
    `,
    [
      authUserId,
      JSON.stringify(userProfile),
      JSON.stringify(tenant || {}),
      now,
    ],
  );
}

export async function getAuthCache() {
  const db = await getDb();
  const row = await db.getFirstAsync(
    `SELECT auth_user_id, user_profile_json, tenant_json, cached_at FROM auth_cache WHERE id = 1`,
  );
  if (!row) return null;

  return {
    authUserId: row.auth_user_id,
    userProfile: JSON.parse(row.user_profile_json),
    tenant: JSON.parse(row.tenant_json),
    cachedAt: row.cached_at,
  };
}

export async function clearAuthCache() {
  const db = await getDb();
  await db.runAsync(`DELETE FROM auth_cache WHERE id = 1`);
}

export async function saveMenuCache({ authUserId, menuTree }) {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `
      INSERT INTO menu_cache (id, auth_user_id, menu_json, cached_at)
      VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        auth_user_id = excluded.auth_user_id,
        menu_json = excluded.menu_json,
        cached_at = excluded.cached_at
    `,
    [authUserId, JSON.stringify(menuTree || []), now],
  );
}

export async function getMenuCache() {
  const db = await getDb();
  const row = await db.getFirstAsync(
    `SELECT auth_user_id, menu_json, cached_at FROM menu_cache WHERE id = 1`,
  );
  if (!row) return null;

  return {
    authUserId: row.auth_user_id,
    menuTree: JSON.parse(row.menu_json),
    cachedAt: row.cached_at,
  };
}

export async function clearMenuCache() {
  const db = await getDb();
  await db.runAsync(`DELETE FROM menu_cache WHERE id = 1`);
}

export async function upsertSyncState(key, value) {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `
      INSERT INTO sync_state (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `,
    [key, JSON.stringify(value), now],
  );
}

export async function getSyncState(key) {
  const db = await getDb();
  const row = await db.getFirstAsync(
    `SELECT value, updated_at FROM sync_state WHERE key = ?`,
    [key],
  );
  if (!row) return null;
  return {
    value: JSON.parse(row.value),
    updatedAt: row.updated_at,
  };
}

export async function clearSyncState(key) {
  const db = await getDb();
  await db.runAsync(`DELETE FROM sync_state WHERE key = ?`, [key]);
}

export async function enqueuePendingOp(op) {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `
      INSERT INTO pending_ops (
        op_id, op_type, tenant_id, user_id, device_id,
        payload, status, retry_count, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)
    `,
    [
      op.opId,
      op.opType,
      op.tenantId,
      op.userId,
      op.deviceId,
      JSON.stringify(op.payload || {}),
      now,
      now,
    ],
  );
}

export async function getPendingOpsCount() {
  const db = await getDb();
  const row = await db.getFirstAsync(
    `SELECT COUNT(*) AS total FROM pending_ops WHERE status IN ('PENDING','FAILED')`,
  );
  return Number(row?.total || 0);
}

export async function getPendingOps(limit = 50) {
  const db = await getDb();
  const rows = await db.getAllAsync(
    `
      SELECT
        op_id, op_type, tenant_id, user_id, device_id, payload, status,
        retry_count, last_error, created_at, updated_at
      FROM pending_ops
      WHERE status IN ('PENDING', 'FAILED')
        AND (last_error IS NULL OR last_error NOT LIKE 'NO_RETRY:%')
      ORDER BY created_at ASC
      LIMIT ?
    `,
    [limit],
  );

  return (rows || []).map((row) => ({
    opId: row.op_id,
    opType: row.op_type,
    tenantId: row.tenant_id,
    userId: row.user_id,
    deviceId: row.device_id,
    payload: JSON.parse(row.payload || '{}'),
    status: row.status,
    retryCount: Number(row.retry_count || 0),
    lastError: row.last_error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function markPendingOpProcessing(opId) {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `
      UPDATE pending_ops
      SET status = 'PROCESSING', updated_at = ?
      WHERE op_id = ?
    `,
    [now, opId],
  );
}

export async function markPendingOpDone(opId) {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `
      UPDATE pending_ops
      SET status = 'DONE',
          last_error = NULL,
          updated_at = ?
      WHERE op_id = ?
    `,
    [now, opId],
  );
}

export async function markPendingOpFailed(opId, errorMessage) {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `
      UPDATE pending_ops
      SET status = 'FAILED',
          retry_count = retry_count + 1,
          last_error = ?,
          updated_at = ?
      WHERE op_id = ?
    `,
    [String(errorMessage || 'Error desconocido'), now, opId],
  );
}

export async function resetStuckProcessingOps() {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `
      UPDATE pending_ops
      SET status = 'PENDING',
          updated_at = ?
      WHERE status = 'PROCESSING'
    `,
    [now],
  );
}

export async function getPendingSaleOps(tenantId, limit = 200) {
  const db = await getDb();
  const rows = await db.getAllAsync(
    `
      SELECT
        op_id, tenant_id, payload, status, retry_count, last_error, created_at, updated_at
      FROM pending_ops
      WHERE op_type = 'CREATE_SALE'
        AND status IN ('PENDING','FAILED')
        AND tenant_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `,
    [tenantId, limit],
  );

  return (rows || []).map((row) => ({
    opId: row.op_id,
    tenantId: row.tenant_id,
    payload: JSON.parse(row.payload || '{}'),
    status: row.status,
    retryCount: Number(row.retry_count || 0),
    lastError: row.last_error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getPendingSaleOpById(opId) {
  const db = await getDb();
  const row = await db.getFirstAsync(
    `
      SELECT
        op_id, tenant_id, payload, status, retry_count, last_error, created_at, updated_at
      FROM pending_ops
      WHERE op_type = 'CREATE_SALE'
        AND op_id = ?
        AND status IN ('PENDING','FAILED')
      LIMIT 1
    `,
    [opId],
  );

  if (!row) return null;
  return {
    opId: row.op_id,
    tenantId: row.tenant_id,
    payload: JSON.parse(row.payload || '{}'),
    status: row.status,
    retryCount: Number(row.retry_count || 0),
    lastError: row.last_error || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function retryPendingOp(opId) {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `
      UPDATE pending_ops
      SET status = 'PENDING',
          last_error = NULL,
          updated_at = ?
      WHERE op_id = ?
    `,
    [now, opId],
  );
}

export async function discardPendingOp(opId) {
  const db = await getDb();
  await db.runAsync(
    `
      DELETE FROM pending_ops
      WHERE op_id = ?
    `,
    [opId],
  );
}

export async function updatePendingOpPayload(opId, payload) {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `
      UPDATE pending_ops
      SET payload = ?,
          updated_at = ?
      WHERE op_id = ?
    `,
    [JSON.stringify(payload || {}), now, opId],
  );
}
