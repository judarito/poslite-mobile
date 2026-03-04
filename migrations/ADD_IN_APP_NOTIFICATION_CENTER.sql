-- ============================================================
-- Centro de notificaciones in-app (MVP)
-- - Eventos + inbox por usuario
-- - Preferencias por usuario/evento
-- - Dedupe por dedupe_key
-- - Integración opcional con system_alerts existente
-- ============================================================

-- 0) Helpers
CREATE OR REPLACE FUNCTION get_current_user_app_user_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT u.user_id
  FROM users u
  WHERE u.auth_user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION fn_notification_severity_rank(p_severity text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE UPPER(COALESCE(p_severity, 'INFO'))
    WHEN 'CRITICAL' THEN 3
    WHEN 'WARNING' THEN 2
    ELSE 1
  END;
$$;

CREATE OR REPLACE FUNCTION fn_user_is_admin_or_manager(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON r.role_id = ur.role_id
    WHERE ur.user_id = p_user_id
      AND UPPER(r.name) IN ('ADMINISTRADOR', 'GERENTE')
  );
$$;

CREATE OR REPLACE FUNCTION fn_user_is_cashier(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON r.role_id = ur.role_id
    WHERE ur.user_id = p_user_id
      AND UPPER(r.name) = 'CAJERO'
  );
$$;

CREATE OR REPLACE FUNCTION fn_user_assigned_locations_for(p_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT DISTINCT cr.location_id
  FROM cash_register_assignments cra
  JOIN cash_registers cr ON cr.cash_register_id = cra.cash_register_id
  WHERE cra.user_id = p_user_id
    AND cra.is_active = true;
$$;

-- 1) Tablas base
CREATE TABLE IF NOT EXISTS notification_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'INFO' CHECK (UPPER(severity) IN ('INFO','WARNING','CRITICAL')),
  title text NOT NULL,
  message text NOT NULL,
  entity_type text,
  entity_id uuid,
  location_id uuid REFERENCES locations(location_id) ON DELETE SET NULL,
  cash_register_id uuid REFERENCES cash_registers(cash_register_id) ON DELETE SET NULL,
  target_role text,
  dedupe_key text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(user_id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_notification_events_tenant_created
  ON notification_events(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_notification_events_tenant_type_created
  ON notification_events(tenant_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_notification_events_scope
  ON notification_events(tenant_id, location_id, cash_register_id, target_role, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_notification_events_tenant_dedupe
  ON notification_events(tenant_id, dedupe_key, created_at DESC)
  WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_notification_prefs (
  pref_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  event_type text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  min_severity text NOT NULL DEFAULT 'INFO' CHECK (UPPER(min_severity) IN ('INFO','WARNING','CRITICAL')),
  mute_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, event_type)
);

CREATE INDEX IF NOT EXISTS ix_user_notification_prefs_tenant_user
  ON user_notification_prefs(tenant_id, user_id);

CREATE TABLE IF NOT EXISTS notifications (
  notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  event_id uuid REFERENCES notification_events(event_id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'IN_APP' CHECK (channel = 'IN_APP'),
  event_type text NOT NULL,
  severity text NOT NULL CHECK (UPPER(severity) IN ('INFO','WARNING','CRITICAL')),
  title text NOT NULL,
  message text NOT NULL,
  action_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, event_id, channel)
);

CREATE INDEX IF NOT EXISTS ix_notifications_tenant_user_created
  ON notifications(tenant_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_notifications_tenant_user_unread
  ON notifications(tenant_id, user_id, is_read, created_at DESC);

-- 2) Trigger updated_at en prefs
CREATE OR REPLACE FUNCTION trg_touch_user_notification_prefs()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_user_notification_prefs ON user_notification_prefs;
CREATE TRIGGER trg_touch_user_notification_prefs
BEFORE UPDATE ON user_notification_prefs
FOR EACH ROW
EXECUTE FUNCTION trg_touch_user_notification_prefs();

-- 3) Emisión de eventos + fanout a inbox
CREATE OR REPLACE FUNCTION fn_emit_notification_event(
  p_tenant uuid,
  p_event_type text,
  p_severity text,
  p_title text,
  p_message text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_dedupe_key text DEFAULT NULL,
  p_target_user_id uuid DEFAULT NULL,
  p_target_role text DEFAULT NULL,
  p_location_id uuid DEFAULT NULL,
  p_cash_register_id uuid DEFAULT NULL,
  p_action_url text DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL,
  p_dedupe_window_minutes integer DEFAULT 10
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
  v_actor_id uuid;
  v_severity text;
  v_window interval;
BEGIN
  IF p_tenant IS NULL THEN
    RAISE EXCEPTION 'p_tenant es requerido';
  END IF;

  IF COALESCE(trim(p_event_type), '') = '' THEN
    RAISE EXCEPTION 'p_event_type es requerido';
  END IF;

  IF COALESCE(trim(p_title), '') = '' THEN
    RAISE EXCEPTION 'p_title es requerido';
  END IF;

  IF COALESCE(trim(p_message), '') = '' THEN
    RAISE EXCEPTION 'p_message es requerido';
  END IF;

  v_severity := UPPER(COALESCE(NULLIF(trim(p_severity), ''), 'INFO'));
  IF v_severity NOT IN ('INFO','WARNING','CRITICAL') THEN
    v_severity := 'INFO';
  END IF;

  v_actor_id := get_current_user_app_user_id();
  v_window := make_interval(mins => GREATEST(COALESCE(p_dedupe_window_minutes, 10), 1));

  IF p_dedupe_key IS NOT NULL AND trim(p_dedupe_key) <> '' THEN
    SELECT ne.event_id
      INTO v_event_id
      FROM notification_events ne
     WHERE ne.tenant_id = p_tenant
       AND ne.dedupe_key = p_dedupe_key
       AND ne.created_at >= now() - v_window
     ORDER BY ne.created_at DESC
     LIMIT 1;
  END IF;

  IF v_event_id IS NULL THEN
    INSERT INTO notification_events (
      tenant_id,
      event_type,
      severity,
      title,
      message,
      entity_type,
      entity_id,
      location_id,
      cash_register_id,
      target_role,
      dedupe_key,
      payload,
      created_by,
      occurred_at
    ) VALUES (
      p_tenant,
      p_event_type,
      v_severity,
      p_title,
      p_message,
      p_entity_type,
      p_entity_id,
      p_location_id,
      p_cash_register_id,
      NULLIF(trim(COALESCE(p_target_role, '')), ''),
      NULLIF(trim(COALESCE(p_dedupe_key, '')), ''),
      COALESCE(p_payload, '{}'::jsonb),
      v_actor_id,
      now()
    )
    RETURNING event_id INTO v_event_id;
  END IF;

  INSERT INTO notifications (
    tenant_id,
    user_id,
    event_id,
    channel,
    event_type,
    severity,
    title,
    message,
    action_url,
    metadata
  )
  SELECT
    p_tenant,
    u.user_id,
    v_event_id,
    'IN_APP',
    p_event_type,
    v_severity,
    p_title,
    p_message,
    p_action_url,
    COALESCE(p_payload, '{}'::jsonb)
  FROM users u
  LEFT JOIN LATERAL (
    SELECT up.enabled, up.min_severity, up.mute_until
    FROM user_notification_prefs up
    WHERE up.tenant_id = p_tenant
      AND up.user_id = u.user_id
      AND up.event_type IN (p_event_type, '*')
    ORDER BY CASE WHEN up.event_type = p_event_type THEN 0 ELSE 1 END
    LIMIT 1
  ) pref ON TRUE
  WHERE u.tenant_id = p_tenant
    AND u.is_active = true
    AND (p_target_user_id IS NULL OR u.user_id = p_target_user_id)
    AND (
      p_target_role IS NULL
      OR EXISTS (
        SELECT 1
        FROM user_roles ur2
        JOIN roles r2 ON r2.role_id = ur2.role_id
        WHERE ur2.user_id = u.user_id
          AND r2.tenant_id = p_tenant
          AND UPPER(r2.name) = UPPER(p_target_role)
      )
    )
    AND (
      p_location_id IS NULL
      OR fn_user_is_admin_or_manager(u.user_id)
      OR (
        fn_user_is_cashier(u.user_id)
        AND p_location_id IN (
          SELECT fn_user_assigned_locations_for(u.user_id)
        )
      )
      OR NOT fn_user_is_cashier(u.user_id)
    )
    AND (
      p_cash_register_id IS NULL
      OR fn_user_is_admin_or_manager(u.user_id)
      OR EXISTS (
        SELECT 1
        FROM cash_register_assignments cra
        WHERE cra.user_id = u.user_id
          AND cra.cash_register_id = p_cash_register_id
          AND cra.is_active = true
      )
      OR NOT fn_user_is_cashier(u.user_id)
    )
    AND COALESCE(pref.enabled, true) = true
    AND (pref.mute_until IS NULL OR pref.mute_until <= now())
    AND fn_notification_severity_rank(v_severity) >= fn_notification_severity_rank(COALESCE(pref.min_severity, 'INFO'))
  ON CONFLICT (tenant_id, user_id, event_id, channel) DO NOTHING;

  RETURN v_event_id;
END;
$$;

-- 4) Operaciones de inbox del usuario actual
CREATE OR REPLACE FUNCTION fn_list_my_notifications(
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_only_unread boolean DEFAULT false
) RETURNS TABLE (
  notification_id uuid,
  event_id uuid,
  event_type text,
  severity text,
  title text,
  message text,
  action_url text,
  metadata jsonb,
  is_read boolean,
  read_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    n.notification_id,
    n.event_id,
    n.event_type,
    n.severity,
    n.title,
    n.message,
    n.action_url,
    n.metadata,
    n.is_read,
    n.read_at,
    n.created_at
  FROM notifications n
  WHERE n.tenant_id = get_current_user_tenant_id()
    AND n.user_id = get_current_user_app_user_id()
    AND (NOT p_only_unread OR n.is_read = false)
  ORDER BY n.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

CREATE OR REPLACE FUNCTION fn_mark_notification_read(p_notification_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE notifications n
  SET is_read = true,
      read_at = now()
  WHERE n.notification_id = p_notification_id
    AND n.tenant_id = get_current_user_tenant_id()
    AND n.user_id = get_current_user_app_user_id()
    AND n.is_read = false;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

CREATE OR REPLACE FUNCTION fn_mark_all_notifications_read()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE notifications n
  SET is_read = true,
      read_at = now()
  WHERE n.tenant_id = get_current_user_tenant_id()
    AND n.user_id = get_current_user_app_user_id()
    AND n.is_read = false;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION fn_set_my_notification_pref(
  p_event_type text,
  p_enabled boolean DEFAULT true,
  p_min_severity text DEFAULT 'INFO',
  p_mute_until timestamptz DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_user uuid;
  v_min_severity text;
BEGIN
  v_tenant := get_current_user_tenant_id();
  v_user := get_current_user_app_user_id();

  IF v_tenant IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'Usuario no autenticado o sin tenant';
  END IF;

  IF COALESCE(trim(p_event_type), '') = '' THEN
    RAISE EXCEPTION 'p_event_type es requerido';
  END IF;

  v_min_severity := UPPER(COALESCE(NULLIF(trim(p_min_severity), ''), 'INFO'));
  IF v_min_severity NOT IN ('INFO','WARNING','CRITICAL') THEN
    v_min_severity := 'INFO';
  END IF;

  INSERT INTO user_notification_prefs (
    tenant_id,
    user_id,
    event_type,
    enabled,
    min_severity,
    mute_until
  ) VALUES (
    v_tenant,
    v_user,
    p_event_type,
    COALESCE(p_enabled, true),
    v_min_severity,
    p_mute_until
  )
  ON CONFLICT (tenant_id, user_id, event_type)
  DO UPDATE SET
    enabled = EXCLUDED.enabled,
    min_severity = EXCLUDED.min_severity,
    mute_until = EXCLUDED.mute_until,
    updated_at = now();
END;
$$;

-- 5) RLS
ALTER TABLE notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_notification_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_events_select_policy ON notification_events;
CREATE POLICY notification_events_select_policy ON notification_events
FOR SELECT
USING (tenant_id = get_current_user_tenant_id());

DROP POLICY IF EXISTS user_notification_prefs_select_policy ON user_notification_prefs;
CREATE POLICY user_notification_prefs_select_policy ON user_notification_prefs
FOR SELECT
USING (
  tenant_id = get_current_user_tenant_id()
  AND user_id = get_current_user_app_user_id()
);

DROP POLICY IF EXISTS user_notification_prefs_insert_policy ON user_notification_prefs;
CREATE POLICY user_notification_prefs_insert_policy ON user_notification_prefs
FOR INSERT
WITH CHECK (
  tenant_id = get_current_user_tenant_id()
  AND user_id = get_current_user_app_user_id()
);

DROP POLICY IF EXISTS user_notification_prefs_update_policy ON user_notification_prefs;
CREATE POLICY user_notification_prefs_update_policy ON user_notification_prefs
FOR UPDATE
USING (
  tenant_id = get_current_user_tenant_id()
  AND user_id = get_current_user_app_user_id()
)
WITH CHECK (
  tenant_id = get_current_user_tenant_id()
  AND user_id = get_current_user_app_user_id()
);

DROP POLICY IF EXISTS notifications_select_policy ON notifications;
CREATE POLICY notifications_select_policy ON notifications
FOR SELECT
USING (
  tenant_id = get_current_user_tenant_id()
  AND user_id = get_current_user_app_user_id()
);

DROP POLICY IF EXISTS notifications_update_policy ON notifications;
CREATE POLICY notifications_update_policy ON notifications
FOR UPDATE
USING (
  tenant_id = get_current_user_tenant_id()
  AND user_id = get_current_user_app_user_id()
)
WITH CHECK (
  tenant_id = get_current_user_tenant_id()
  AND user_id = get_current_user_app_user_id()
);

-- 6) Integración: generar notificaciones desde system_alerts (si existe)
CREATE OR REPLACE FUNCTION fn_notify_from_system_alerts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_type text;
  v_severity text;
  v_title text;
  v_message text;
  v_ref text;
  v_dedupe text;
BEGIN
  v_event_type := 'system.' || lower(COALESCE(NEW.alert_type, 'alert'));
  v_severity := CASE UPPER(COALESCE(NEW.alert_level, 'WARNING'))
    WHEN 'CRITICAL' THEN 'CRITICAL'
    WHEN 'EXPIRED' THEN 'CRITICAL'
    WHEN 'HIGH' THEN 'CRITICAL'
    WHEN 'WARNING' THEN 'WARNING'
    WHEN 'MEDIUM' THEN 'WARNING'
    ELSE 'INFO'
  END;

  v_ref := COALESCE(NEW.reference_id::text, NEW.alert_id::text);
  v_title := format('[%s] Alerta %s', UPPER(v_severity), COALESCE(NEW.alert_type, 'SISTEMA'));
  v_message := COALESCE(NEW.data->>'message', NEW.data->>'product_name', NEW.data->>'contract_code', 'Se detectó una alerta del sistema');
  v_dedupe := format('system_alert:%s:%s:%s', NEW.tenant_id::text, COALESCE(NEW.alert_type, 'X'), v_ref);

  PERFORM fn_emit_notification_event(
    NEW.tenant_id,
    v_event_type,
    v_severity,
    v_title,
    v_message,
    COALESCE(NEW.data, '{}'::jsonb) || jsonb_build_object(
      'alert_id', NEW.alert_id,
      'alert_type', NEW.alert_type,
      'alert_level', NEW.alert_level,
      'reference_id', NEW.reference_id
    ),
    v_dedupe,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'system_alert',
    NEW.alert_id,
    15
  );

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'system_alerts'
  ) THEN
    DROP TRIGGER IF EXISTS trg_system_alerts_to_notifications ON system_alerts;
    CREATE TRIGGER trg_system_alerts_to_notifications
    AFTER INSERT OR UPDATE ON system_alerts
    FOR EACH ROW
    EXECUTE FUNCTION fn_notify_from_system_alerts();
  END IF;
END $$;

-- 7) Publicación realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  END IF;
END $$;

-- 8) Permisos de ejecución RPC
GRANT EXECUTE ON FUNCTION fn_emit_notification_event(uuid, text, text, text, text, jsonb, text, uuid, text, uuid, uuid, text, text, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_list_my_notifications(integer, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_mark_notification_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_mark_all_notifications_read() TO authenticated;
GRANT EXECUTE ON FUNCTION fn_set_my_notification_pref(text, boolean, text, timestamptz) TO authenticated;
