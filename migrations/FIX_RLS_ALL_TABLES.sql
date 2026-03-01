/* ============================================================
   FIX COMPLETO: Políticas RLS para Todas las Tablas
   ============================================================
   
   ADMINISTRADOR: Ve y gestiona todo del tenant
   CAJERO: Solo ve sus propias sesiones, ventas y transacciones
   
   ============================================================ */

-- =========================
-- 1) SALE_LINES
-- =========================
ALTER TABLE sale_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage all sale lines" ON sale_lines;
DROP POLICY IF EXISTS "Cashiers can view their own sale lines" ON sale_lines;
DROP POLICY IF EXISTS "Cashiers can create sale lines" ON sale_lines;

CREATE POLICY "Admins can manage all sale lines"
ON sale_lines FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM users u
    JOIN user_roles ur ON ur.user_id = u.user_id
    JOIN roles r ON r.role_id = ur.role_id
    JOIN sales s ON s.sale_id = sale_lines.sale_id
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = s.tenant_id
      AND r.name = 'ADMINISTRADOR'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u
    JOIN user_roles ur ON ur.user_id = u.user_id
    JOIN roles r ON r.role_id = ur.role_id
    JOIN sales s ON s.sale_id = sale_lines.sale_id
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = s.tenant_id
      AND r.name = 'ADMINISTRADOR'
  )
);

CREATE POLICY "Cashiers can view their own sale lines"
ON sale_lines FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users u
    JOIN sales s ON s.sale_id = sale_lines.sale_id
    JOIN cash_sessions cs ON cs.cash_session_id = s.cash_session_id
    WHERE u.auth_user_id = auth.uid()
      AND u.user_id = cs.opened_by
  )
);

CREATE POLICY "Cashiers can create sale lines"
ON sale_lines FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u
    JOIN sales s ON s.sale_id = sale_lines.sale_id
    JOIN cash_sessions cs ON cs.cash_session_id = s.cash_session_id
    WHERE u.auth_user_id = auth.uid()
      AND u.user_id = cs.opened_by
      AND cs.status = 'OPEN'
  )
);

-- =========================
-- 2) SALE_PAYMENTS
-- =========================
ALTER TABLE sale_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage all sale payments" ON sale_payments;
DROP POLICY IF EXISTS "Cashiers can view their own sale payments" ON sale_payments;
DROP POLICY IF EXISTS "Cashiers can create sale payments" ON sale_payments;

CREATE POLICY "Admins can manage all sale payments"
ON sale_payments FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM users u
    JOIN user_roles ur ON ur.user_id = u.user_id
    JOIN roles r ON r.role_id = ur.role_id
    JOIN sales s ON s.sale_id = sale_payments.sale_id
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = s.tenant_id
      AND r.name = 'ADMINISTRADOR'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u
    JOIN user_roles ur ON ur.user_id = u.user_id
    JOIN roles r ON r.role_id = ur.role_id
    JOIN sales s ON s.sale_id = sale_payments.sale_id
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = s.tenant_id
      AND r.name = 'ADMINISTRADOR'
  )
);

CREATE POLICY "Cashiers can view their own sale payments"
ON sale_payments FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users u
    JOIN sales s ON s.sale_id = sale_payments.sale_id
    JOIN cash_sessions cs ON cs.cash_session_id = s.cash_session_id
    WHERE u.auth_user_id = auth.uid()
      AND u.user_id = cs.opened_by
  )
);

CREATE POLICY "Cashiers can create sale payments"
ON sale_payments FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u
    JOIN sales s ON s.sale_id = sale_payments.sale_id
    JOIN cash_sessions cs ON cs.cash_session_id = s.cash_session_id
    WHERE u.auth_user_id = auth.uid()
      AND u.user_id = cs.opened_by
      AND cs.status = 'OPEN'
  )
);

-- =========================
-- 3) CASH_MOVEMENTS
-- =========================
ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage all cash movements" ON cash_movements;
DROP POLICY IF EXISTS "Cashiers can view their own movements" ON cash_movements;
DROP POLICY IF EXISTS "Cashiers can create movements" ON cash_movements;

CREATE POLICY "Admins can manage all cash movements"
ON cash_movements FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM users u
    JOIN user_roles ur ON ur.user_id = u.user_id
    JOIN roles r ON r.role_id = ur.role_id
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = cash_movements.tenant_id
      AND r.name = 'ADMINISTRADOR'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u
    JOIN user_roles ur ON ur.user_id = u.user_id
    JOIN roles r ON r.role_id = ur.role_id
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = cash_movements.tenant_id
      AND r.name = 'ADMINISTRADOR'
  )
);

CREATE POLICY "Cashiers can view their own movements"
ON cash_movements FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users u
    JOIN cash_sessions cs ON cs.cash_session_id = cash_movements.cash_session_id
    WHERE u.auth_user_id = auth.uid()
      AND u.user_id = cs.opened_by
      AND u.tenant_id = cash_movements.tenant_id
  )
);

CREATE POLICY "Cashiers can create movements"
ON cash_movements FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u
    JOIN cash_sessions cs ON cs.cash_session_id = cash_movements.cash_session_id
    WHERE u.auth_user_id = auth.uid()
      AND u.user_id = cs.opened_by
      AND u.tenant_id = cash_movements.tenant_id
      AND cs.status = 'OPEN'
  )
);

-- =========================
-- MENSAJE FINAL
-- =========================
DO $$
BEGIN
  RAISE NOTICE '✅ Políticas RLS actualizadas para todas las tablas';
  RAISE NOTICE '📝 ADMINISTRADOR puede ver todo';
  RAISE NOTICE '📝 CAJERO solo ve sus propias transacciones';
END $$;
