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
    `SELECT COUNT(*) AS total FROM pending_ops WHERE status = 'PENDING'`,
  );
  return Number(row?.total || 0);
}
