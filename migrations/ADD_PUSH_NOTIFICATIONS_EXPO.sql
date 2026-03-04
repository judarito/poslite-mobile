-- ============================================================
-- Push notifications para Expo (barra del sistema)
-- Requiere que exista el centro in-app (notifications + helpers)
-- ============================================================

ALTER TABLE user_notification_prefs
  ADD COLUMN IF NOT EXISTS push_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS user_push_devices (
  push_device_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  expo_push_token text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios','android','web','unknown')),
  device_name text,
  app_version text,
  device_uid text,
  is_active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, expo_push_token)
);

CREATE INDEX IF NOT EXISTS ix_user_push_devices_tenant_user
  ON user_push_devices(tenant_id, user_id, is_active);

CREATE INDEX IF NOT EXISTS ix_user_push_devices_token
  ON user_push_devices(expo_push_token);

CREATE OR REPLACE FUNCTION trg_touch_user_push_devices()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_user_push_devices ON user_push_devices;
CREATE TRIGGER trg_touch_user_push_devices
BEFORE UPDATE ON user_push_devices
FOR EACH ROW
EXECUTE FUNCTION trg_touch_user_push_devices();

CREATE TABLE IF NOT EXISTS notification_push_queue (
  push_queue_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notifications(notification_id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  push_device_id uuid REFERENCES user_push_devices(push_device_id) ON DELETE SET NULL,
  expo_push_token text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','FAILED','RETRY')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notification_id, expo_push_token)
);

CREATE INDEX IF NOT EXISTS ix_notification_push_queue_pending
  ON notification_push_queue(status, next_attempt_at, created_at)
  WHERE status IN ('PENDING','RETRY');

CREATE INDEX IF NOT EXISTS ix_notification_push_queue_tenant_user
  ON notification_push_queue(tenant_id, user_id, created_at DESC);

CREATE OR REPLACE FUNCTION fn_upsert_my_push_device(
  p_expo_push_token text,
  p_platform text DEFAULT 'unknown',
  p_device_name text DEFAULT NULL,
  p_app_version text DEFAULT NULL,
  p_device_uid text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_user uuid;
  v_platform text;
  v_id uuid;
BEGIN
  v_tenant := get_current_user_tenant_id();
  v_user := get_current_user_app_user_id();

  IF v_tenant IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado o sin tenant';
  END IF;

  IF COALESCE(trim(p_expo_push_token), '') = '' THEN
    RAISE EXCEPTION 'p_expo_push_token es requerido';
  END IF;

  v_platform := lower(COALESCE(NULLIF(trim(p_platform), ''), 'unknown'));
  IF v_platform NOT IN ('ios','android','web','unknown') THEN
    v_platform := 'unknown';
  END IF;

  INSERT INTO user_push_devices (
    tenant_id,
    user_id,
    expo_push_token,
    platform,
    device_name,
    app_version,
    device_uid,
    is_active,
    last_seen_at
  ) VALUES (
    v_tenant,
    v_user,
    trim(p_expo_push_token),
    v_platform,
    NULLIF(trim(COALESCE(p_device_name, '')), ''),
    NULLIF(trim(COALESCE(p_app_version, '')), ''),
    NULLIF(trim(COALESCE(p_device_uid, '')), ''),
    true,
    now()
  )
  ON CONFLICT (tenant_id, expo_push_token)
  DO UPDATE SET
    user_id = EXCLUDED.user_id,
    platform = EXCLUDED.platform,
    device_name = EXCLUDED.device_name,
    app_version = EXCLUDED.app_version,
    device_uid = EXCLUDED.device_uid,
    is_active = true,
    last_seen_at = now(),
    updated_at = now()
  RETURNING push_device_id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION fn_deactivate_my_push_device(p_expo_push_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_user uuid;
  v_count integer;
BEGIN
  v_tenant := get_current_user_tenant_id();
  v_user := get_current_user_app_user_id();

  UPDATE user_push_devices upd
  SET is_active = false,
      updated_at = now()
  WHERE upd.tenant_id = v_tenant
    AND upd.user_id = v_user
    AND upd.expo_push_token = p_expo_push_token
    AND upd.is_active = true;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION fn_enqueue_push_for_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO notification_push_queue (
    notification_id,
    tenant_id,
    user_id,
    push_device_id,
    expo_push_token,
    title,
    message,
    payload,
    status,
    attempts,
    next_attempt_at,
    created_at
  )
  SELECT
    NEW.notification_id,
    NEW.tenant_id,
    NEW.user_id,
    upd.push_device_id,
    upd.expo_push_token,
    NEW.title,
    NEW.message,
    COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object(
      'notification_id', NEW.notification_id,
      'event_type', NEW.event_type,
      'severity', NEW.severity,
      'action_url', NEW.action_url
    ),
    'PENDING',
    0,
    now(),
    now()
  FROM user_push_devices upd
  LEFT JOIN LATERAL (
    SELECT up.push_enabled
    FROM user_notification_prefs up
    WHERE up.tenant_id = NEW.tenant_id
      AND up.user_id = NEW.user_id
      AND up.event_type IN (NEW.event_type, '*')
    ORDER BY CASE WHEN up.event_type = NEW.event_type THEN 0 ELSE 1 END
    LIMIT 1
  ) pref ON TRUE
  WHERE upd.tenant_id = NEW.tenant_id
    AND upd.user_id = NEW.user_id
    AND upd.is_active = true
    AND (
      upd.expo_push_token LIKE 'ExponentPushToken%'
      OR upd.expo_push_token LIKE 'ExpoPushToken%'
    )
    AND COALESCE(pref.push_enabled, true) = true
  ON CONFLICT (notification_id, expo_push_token) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_push_for_notification ON notifications;
CREATE TRIGGER trg_enqueue_push_for_notification
AFTER INSERT ON notifications
FOR EACH ROW
EXECUTE FUNCTION fn_enqueue_push_for_notification();

ALTER TABLE user_push_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_push_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_push_devices_select_policy ON user_push_devices;
CREATE POLICY user_push_devices_select_policy ON user_push_devices
FOR SELECT
USING (
  tenant_id = get_current_user_tenant_id()
  AND user_id = get_current_user_app_user_id()
);

DROP POLICY IF EXISTS user_push_devices_insert_policy ON user_push_devices;
CREATE POLICY user_push_devices_insert_policy ON user_push_devices
FOR INSERT
WITH CHECK (
  tenant_id = get_current_user_tenant_id()
  AND user_id = get_current_user_app_user_id()
);

DROP POLICY IF EXISTS user_push_devices_update_policy ON user_push_devices;
CREATE POLICY user_push_devices_update_policy ON user_push_devices
FOR UPDATE
USING (
  tenant_id = get_current_user_tenant_id()
  AND user_id = get_current_user_app_user_id()
)
WITH CHECK (
  tenant_id = get_current_user_tenant_id()
  AND user_id = get_current_user_app_user_id()
);

DROP POLICY IF EXISTS notification_push_queue_select_policy ON notification_push_queue;
CREATE POLICY notification_push_queue_select_policy ON notification_push_queue
FOR SELECT
USING (
  tenant_id = get_current_user_tenant_id()
  AND user_id = get_current_user_app_user_id()
);

GRANT EXECUTE ON FUNCTION fn_upsert_my_push_device(text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_deactivate_my_push_device(text) TO authenticated;
