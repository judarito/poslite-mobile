/* ============================================================
   MIGRACIÓN: Sistema de Asignación de Cajas a Cajeros
   ============================================================
   
   INSTRUCCIONES:
   1. Abrir Supabase SQL Editor
   2. Copiar y pegar TODO este contenido
   3. Ejecutar
   4. Al final, ejecutar: SELECT fn_init_tenant_roles('tu-tenant-uuid');
   
   ============================================================ */

-- =========================
-- 1) TABLA: ASIGNACIONES CAJERO-CAJA
-- =========================
CREATE TABLE IF NOT EXISTS cash_register_assignments (
  assignment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  cash_register_id UUID NOT NULL REFERENCES cash_registers(cash_register_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by UUID NOT NULL REFERENCES users(user_id),
  note TEXT,
  UNIQUE (tenant_id, cash_register_id, user_id)
);

CREATE INDEX IF NOT EXISTS ix_cash_register_assignments_lookup
ON cash_register_assignments(tenant_id, user_id, cash_register_id, is_active);

-- =========================
-- 2) RESTRICCIONES: SESIÓN ÚNICA
-- =========================
-- Un usuario solo puede tener 1 sesión OPEN a la vez
CREATE UNIQUE INDEX IF NOT EXISTS ux_cash_sessions_one_open_per_user
ON cash_sessions(tenant_id, opened_by)
WHERE status = 'OPEN';

-- Una caja solo puede tener 1 sesión OPEN a la vez
CREATE UNIQUE INDEX IF NOT EXISTS ux_cash_sessions_one_open_per_register
ON cash_sessions(tenant_id, cash_register_id)
WHERE status = 'OPEN';

-- =========================
-- 3) FUNCIONES DE VALIDACIÓN
-- =========================
CREATE OR REPLACE FUNCTION fn_user_can_use_cash_register(
  p_tenant UUID,
  p_user UUID,
  p_cash_register UUID
) RETURNS BOOLEAN
LANGUAGE SQL
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM cash_register_assignments a
    WHERE a.tenant_id = p_tenant
      AND a.user_id = p_user
      AND a.cash_register_id = p_cash_register
      AND a.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION fn_get_open_cash_session_for_user(
  p_tenant UUID,
  p_user UUID
) RETURNS UUID
LANGUAGE SQL
AS $$
  SELECT cs.cash_session_id
  FROM cash_sessions cs
  WHERE cs.tenant_id = p_tenant
    AND cs.opened_by = p_user
    AND cs.status = 'OPEN'
  ORDER BY cs.opened_at DESC
  LIMIT 1;
$$;

-- =========================
-- 4) VISTA: CAJAS ASIGNADAS
-- =========================
CREATE OR REPLACE VIEW vw_user_cash_registers AS
SELECT
  a.tenant_id,
  a.user_id,
  u.full_name AS user_name,
  a.cash_register_id,
  cr.name AS cash_register_name,
  cr.location_id,
  l.name AS location_name,
  a.is_active,
  a.assigned_at,
  a.assigned_by
FROM cash_register_assignments a
JOIN users u ON u.user_id = a.user_id
JOIN cash_registers cr ON cr.cash_register_id = a.cash_register_id
JOIN locations l ON l.location_id = cr.location_id;

-- =========================
-- 5) SP: ASIGNAR CAJA A CAJERO
-- =========================
CREATE OR REPLACE FUNCTION sp_assign_cash_register_to_user(
  p_tenant UUID,
  p_cash_register UUID,
  p_user UUID,
  p_assigned_by UUID,
  p_is_active BOOLEAN DEFAULT true,
  p_note TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO cash_register_assignments(
    tenant_id, cash_register_id, user_id, is_active, assigned_at, assigned_by, note
  )
  VALUES(
    p_tenant, p_cash_register, p_user, p_is_active, now(), p_assigned_by, p_note
  )
  ON CONFLICT (tenant_id, cash_register_id, user_id)
  DO UPDATE SET
    is_active = EXCLUDED.is_active,
    assigned_at = now(),
    assigned_by = EXCLUDED.assigned_by,
    note = EXCLUDED.note;
END;
$$;

-- =========================
-- 6) SP: ABRIR SESIÓN CON VALIDACIÓN
-- =========================
CREATE OR REPLACE FUNCTION sp_open_cash_session(
  p_tenant UUID,
  p_cash_register UUID,
  p_opened_by UUID,
  p_opening_amount NUMERIC(14,2)
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_session UUID;
  v_existing UUID;
BEGIN
  IF NOT fn_user_can_use_cash_register(p_tenant, p_opened_by, p_cash_register) THEN
    RAISE EXCEPTION 'User is not assigned to this cash register';
  END IF;

  v_existing := fn_get_open_cash_session_for_user(p_tenant, p_opened_by);
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  INSERT INTO cash_sessions(
    tenant_id, cash_register_id, opened_by, opened_at, opening_amount, status
  )
  VALUES(
    p_tenant, p_cash_register, p_opened_by, now(), COALESCE(p_opening_amount,0), 'OPEN'
  )
  RETURNING cash_session_id INTO v_session;

  RETURN v_session;
EXCEPTION
  WHEN unique_violation THEN
    v_existing := fn_get_open_cash_session_for_user(p_tenant, p_opened_by);
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
    RAISE;
END;
$$;

-- =========================
-- 7) SP: CERRAR SESIÓN SEGURA
-- =========================
CREATE OR REPLACE FUNCTION sp_close_cash_session_secure(
  p_tenant UUID,
  p_cash_session UUID,
  p_closed_by UUID,
  p_counted_amount NUMERIC(14,2)
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM cash_sessions cs
  WHERE cs.tenant_id = p_tenant
    AND cs.cash_session_id = p_cash_session
    AND cs.status = 'OPEN'
    AND cs.opened_by = p_closed_by
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cash session not found/OPEN or not owned by user';
  END IF;

  PERFORM sp_close_cash_session(p_tenant, p_cash_session, p_closed_by, p_counted_amount);
END;
$$;

-- =========================
-- 8) FUNCIÓN: CONTEXTO POS HOME
-- =========================
CREATE OR REPLACE FUNCTION fn_pos_home_context(
  p_tenant UUID,
  p_user UUID
) RETURNS TABLE(
  open_cash_session_id UUID,
  assigned_registers_count INT,
  single_cash_register_id UUID
)
LANGUAGE SQL
AS $$
  WITH open_s AS (
    SELECT fn_get_open_cash_session_for_user(p_tenant, p_user) AS sid
  ),
  regs AS (
    SELECT a.cash_register_id
    FROM cash_register_assignments a
    WHERE a.tenant_id = p_tenant AND a.user_id = p_user AND a.is_active = true
  )
  SELECT
    (SELECT sid FROM open_s) AS open_cash_session_id,
    (SELECT COUNT(*)::INT FROM regs) AS assigned_registers_count,
    (CASE WHEN (SELECT COUNT(*) FROM regs) = 1 THEN (SELECT cash_register_id FROM regs LIMIT 1) ELSE NULL END) AS single_cash_register_id;
$$;

-- =========================
-- 9) PERMISO NUEVO
-- =========================
INSERT INTO permissions(code, description) 
VALUES ('CASH.ASSIGN', 'Asignar cajas a cajeros')
ON CONFLICT (code) DO NOTHING;

-- =========================
-- 10) POLÍTICAS RLS
-- =========================
-- Habilitar RLS en la tabla
ALTER TABLE cash_register_assignments ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas si existen (para que el script sea idempotente)
DROP POLICY IF EXISTS "Users can access assignments in their tenant" ON cash_register_assignments;
DROP POLICY IF EXISTS "Admins can access all assignments" ON cash_register_assignments;
DROP POLICY IF EXISTS "Cashiers can access their own assignments" ON cash_register_assignments;

-- Política: Admins pueden ver todas las asignaciones de su tenant
CREATE POLICY "Admins can access all assignments"
ON cash_register_assignments FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM users u
    JOIN user_roles ur ON ur.user_id = u.user_id
    JOIN roles r ON r.role_id = ur.role_id
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = cash_register_assignments.tenant_id
      AND r.name = 'ADMINISTRADOR'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u
    JOIN user_roles ur ON ur.user_id = u.user_id
    JOIN roles r ON r.role_id = ur.role_id
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = cash_register_assignments.tenant_id
      AND r.name = 'ADMINISTRADOR'
  )
);

-- Política: Cajeros solo pueden ver sus propias asignaciones
CREATE POLICY "Cashiers can access their own assignments"
ON cash_register_assignments FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.user_id = cash_register_assignments.user_id
      AND u.tenant_id = cash_register_assignments.tenant_id
  )
);

-- =========================
-- 11) MENSAJE FINAL
-- =========================
DO $$
BEGIN
  RAISE NOTICE '✅ Migración completada exitosamente';
  RAISE NOTICE '📝 Ahora ejecuta: SELECT fn_init_tenant_roles(''tu-tenant-uuid'');';
END $$;
