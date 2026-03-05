-- ============================================================
-- Cache de conversion Chat -> Venta (IA)
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_order_ai_cache (
  cache_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  chat_hash text NOT NULL,
  chat_text_norm text NOT NULL,
  response_payload jsonb NOT NULL,
  model text,
  use_count integer NOT NULL DEFAULT 1,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, chat_hash)
);

CREATE INDEX IF NOT EXISTS ix_chat_order_ai_cache_lookup
  ON chat_order_ai_cache(tenant_id, chat_hash);

CREATE INDEX IF NOT EXISTS ix_chat_order_ai_cache_recent
  ON chat_order_ai_cache(tenant_id, last_used_at DESC, created_at DESC);

CREATE OR REPLACE FUNCTION trg_touch_chat_order_ai_cache()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_chat_order_ai_cache ON chat_order_ai_cache;
CREATE TRIGGER trg_touch_chat_order_ai_cache
BEFORE UPDATE ON chat_order_ai_cache
FOR EACH ROW
EXECUTE FUNCTION trg_touch_chat_order_ai_cache();

ALTER TABLE chat_order_ai_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_order_ai_cache_select_policy ON chat_order_ai_cache;
CREATE POLICY chat_order_ai_cache_select_policy ON chat_order_ai_cache
FOR SELECT
USING (
  tenant_id = get_current_user_tenant_id()
);

DROP POLICY IF EXISTS chat_order_ai_cache_insert_policy ON chat_order_ai_cache;
CREATE POLICY chat_order_ai_cache_insert_policy ON chat_order_ai_cache
FOR INSERT
WITH CHECK (
  tenant_id = get_current_user_tenant_id()
);

DROP POLICY IF EXISTS chat_order_ai_cache_update_policy ON chat_order_ai_cache;
CREATE POLICY chat_order_ai_cache_update_policy ON chat_order_ai_cache
FOR UPDATE
USING (
  tenant_id = get_current_user_tenant_id()
)
WITH CHECK (
  tenant_id = get_current_user_tenant_id()
);
