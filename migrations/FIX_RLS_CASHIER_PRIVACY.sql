/* ============================================================
   FIX: Políticas RLS para Privacidad de Cajeros
   ============================================================
   
   Los cajeros solo deben ver:
   - Sus propias sesiones de caja
   - Las ventas de sus propias sesiones
   
   Los administradores pueden ver todo.
   Otros roles pueden ver todo del tenant.
   
   ============================================================ */

-- =========================
-- 0) FUNCIONES HELPER
-- =========================

-- Función para verificar si el usuario es ADMINISTRADOR
CREATE OR REPLACE FUNCTION is_user_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users u
    JOIN user_roles ur ON ur.user_id = u.user_id
    JOIN roles r ON r.role_id = ur.role_id
    WHERE u.auth_user_id = auth.uid()
      AND r.name = 'ADMINISTRADOR'
  );
$$;

-- Función para verificar si el usuario es CAJERO
CREATE OR REPLACE FUNCTION is_user_cashier()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users u
    JOIN user_roles ur ON ur.user_id = u.user_id
    JOIN roles r ON r.role_id = ur.role_id
    WHERE u.auth_user_id = auth.uid()
      AND r.name = 'CAJERO'
  );
$$;

-- Función para obtener el tenant_id del usuario actual
CREATE OR REPLACE FUNCTION get_current_user_tenant_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT tenant_id FROM users WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

-- =========================
-- 1) POLÍTICAS: CASH_SESSIONS
-- =========================
ALTER TABLE cash_sessions ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas existentes
DROP POLICY IF EXISTS "Users can view sessions in their tenant" ON cash_sessions;
DROP POLICY IF EXISTS "Admins can manage all cash sessions" ON cash_sessions;
DROP POLICY IF EXISTS "Cashiers can view their own sessions" ON cash_sessions;
DROP POLICY IF EXISTS "Cashiers can manage their own sessions" ON cash_sessions;

-- Admins pueden ver y gestionar todas las sesiones
CREATE POLICY "Admins can manage all cash sessions"
ON cash_sessions FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM users u
    JOIN user_roles ur ON ur.user_id = u.user_id
    JOIN roles r ON r.role_id = ur.role_id
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = cash_sessions.tenant_id
      AND r.name = 'ADMINISTRADOR'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u
    JOIN user_roles ur ON ur.user_id = u.user_id
    JOIN roles r ON r.role_id = ur.role_id
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = cash_sessions.tenant_id
      AND r.name = 'ADMINISTRADOR'
  )
);

-- Cajeros solo pueden ver sus propias sesiones
CREATE POLICY "Cashiers can view their own sessions"
ON cash_sessions FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.user_id = cash_sessions.opened_by
      AND u.tenant_id = cash_sessions.tenant_id
  )
);

-- Cajeros solo pueden modificar sus propias sesiones OPEN
CREATE POLICY "Cashiers can manage their own sessions"
ON cash_sessions FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.user_id = cash_sessions.opened_by
      AND u.tenant_id = cash_sessions.tenant_id
      AND cash_sessions.status = 'OPEN'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.user_id = cash_sessions.opened_by
      AND u.tenant_id = cash_sessions.tenant_id
  )
);

-- =========================
-- 2) POLÍTICAS: SALES
-- =========================
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas existentes
DROP POLICY IF EXISTS "Users can view sales in their tenant" ON sales;
DROP POLICY IF EXISTS "Admins can manage all sales" ON sales;
DROP POLICY IF EXISTS "Cashiers can view their own sales" ON sales;
DROP POLICY IF EXISTS "Cashiers can create sales" ON sales;
DROP POLICY IF EXISTS "Other roles can view sales" ON sales;
DROP POLICY IF EXISTS "Users can view sales" ON sales;
DROP POLICY IF EXISTS "Non-cashiers can create sales" ON sales;

-- UNA SOLA política para SELECT que maneja todos los casos
CREATE POLICY "Users can view sales"
ON sales FOR SELECT
USING (
  tenant_id = get_current_user_tenant_id()
  AND (
    -- Caso 1: Usuario es ADMINISTRADOR - ve todo
    is_user_admin()
    OR
    -- Caso 2: Usuario es CAJERO - solo ve sus propias ventas con sesión
    (
      is_user_cashier()
      AND cash_session_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM cash_sessions cs
        JOIN users u ON u.user_id = cs.opened_by
        WHERE cs.cash_session_id = sales.cash_session_id
          AND u.auth_user_id = auth.uid()
      )
    )
    OR
    -- Caso 3: Usuario NO es admin NI cajero - ve todo del tenant
    (
      NOT is_user_admin()
      AND NOT is_user_cashier()
    )
  )
);

-- Admins pueden gestionar todas las ventas (INSERT, UPDATE, DELETE)
CREATE POLICY "Admins can manage all sales"
ON sales FOR ALL
USING (
  is_user_admin()
  AND tenant_id = get_current_user_tenant_id()
)
WITH CHECK (
  is_user_admin()
  AND tenant_id = get_current_user_tenant_id()
);

-- Cajeros pueden crear ventas SOLO en sus propias sesiones activas
CREATE POLICY "Cashiers can create sales"
ON sales FOR INSERT
WITH CHECK (
  is_user_cashier()
  AND tenant_id = get_current_user_tenant_id()
  AND cash_session_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM cash_sessions cs
    JOIN users u ON u.user_id = cs.opened_by
    WHERE cs.cash_session_id = sales.cash_session_id
      AND u.auth_user_id = auth.uid()
      AND cs.status = 'OPEN'
  )
);

-- Usuarios NO cajeros (otros roles) pueden crear ventas
CREATE POLICY "Non-cashiers can create sales"
ON sales FOR INSERT
WITH CHECK (
  NOT is_user_cashier()
  AND tenant_id = get_current_user_tenant_id()
);

-- =========================
-- 3) MENSAJE FINAL
-- =========================
DO $$
BEGIN
  RAISE NOTICE '✅ Políticas RLS actualizadas correctamente';
  RAISE NOTICE '📝 Los cajeros ahora solo ven sus propias sesiones y ventas';
END $$;
