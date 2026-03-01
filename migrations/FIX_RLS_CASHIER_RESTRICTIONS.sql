-- =====================================================
-- RESTRICCIONES DE ACCESO PARA ROL CAJERO
-- Los cajeros solo pueden ver:
-- 1. Sus propias ventas (de sus sesiones de caja)
-- 2. Inventario de las sedes donde tienen cajas asignadas
-- =====================================================

-- =====================================================
-- FUNCIÓN HELPER: Obtener ubicaciones asignadas al usuario
-- =====================================================

CREATE OR REPLACE FUNCTION get_user_assigned_locations()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT DISTINCT cr.location_id
  FROM users u
  JOIN cash_register_assignments a ON a.user_id = u.user_id AND a.is_active = true
  JOIN cash_registers cr ON cr.cash_register_id = a.cash_register_id
  WHERE u.auth_user_id = auth.uid()
    AND u.tenant_id = a.tenant_id;
$$;

-- =====================================================
-- FUNCIÓN HELPER: Verificar si usuario es ADMINISTRADOR
-- =====================================================

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

-- =====================================================
-- FUNCIÓN HELPER: Verificar si usuario es CAJERO
-- =====================================================

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

-- =====================================================
-- 1. POLÍTICAS: sale_lines (Líneas de Venta)
-- =====================================================

ALTER TABLE sale_lines ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas existentes
DROP POLICY IF EXISTS "Admins can manage sale lines" ON sale_lines;
DROP POLICY IF EXISTS "Cashiers can view their sale lines" ON sale_lines;
DROP POLICY IF EXISTS "Cashiers can create sale lines" ON sale_lines;

-- Admins pueden gestionar todas las líneas de venta
CREATE POLICY "Admins can manage sale lines"
ON sale_lines FOR ALL
USING (
  is_user_admin()
  AND EXISTS (
    SELECT 1 FROM sales s
    WHERE s.sale_id = sale_lines.sale_id
      AND s.tenant_id = get_current_user_tenant_id()
  )
)
WITH CHECK (
  is_user_admin()
  AND EXISTS (
    SELECT 1 FROM sales s
    WHERE s.sale_id = sale_lines.sale_id
      AND s.tenant_id = get_current_user_tenant_id()
  )
);

-- Cajeros solo pueden ver líneas de SUS ventas
CREATE POLICY "Cashiers can view their sale lines"
ON sale_lines FOR SELECT
USING (
  is_user_cashier()
  AND EXISTS (
    SELECT 1 FROM sales s
    JOIN cash_sessions cs ON cs.cash_session_id = s.cash_session_id
    JOIN users u ON u.user_id = cs.opened_by
    WHERE s.sale_id = sale_lines.sale_id
      AND u.auth_user_id = auth.uid()
      AND s.tenant_id = get_current_user_tenant_id()
  )
);

-- Cajeros pueden crear líneas en SUS ventas
CREATE POLICY "Cashiers can create sale lines"
ON sale_lines FOR INSERT
WITH CHECK (
  is_user_cashier()
  AND EXISTS (
    SELECT 1 FROM sales s
    JOIN cash_sessions cs ON cs.cash_session_id = s.cash_session_id
    JOIN users u ON u.user_id = cs.opened_by
    WHERE s.sale_id = sale_lines.sale_id
      AND u.auth_user_id = auth.uid()
      AND cs.status = 'OPEN'
      AND s.tenant_id = get_current_user_tenant_id()
  )
);

-- =====================================================
-- 2. POLÍTICAS: sale_payments (Pagos de Venta)
-- =====================================================

ALTER TABLE sale_payments ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas existentes
DROP POLICY IF EXISTS "Admins can manage sale payments" ON sale_payments;
DROP POLICY IF EXISTS "Cashiers can view their sale payments" ON sale_payments;
DROP POLICY IF EXISTS "Cashiers can create sale payments" ON sale_payments;

-- Admins pueden gestionar todos los pagos
CREATE POLICY "Admins can manage sale payments"
ON sale_payments FOR ALL
USING (
  is_user_admin()
  AND EXISTS (
    SELECT 1 FROM sales s
    WHERE s.sale_id = sale_payments.sale_id
      AND s.tenant_id = get_current_user_tenant_id()
  )
)
WITH CHECK (
  is_user_admin()
  AND EXISTS (
    SELECT 1 FROM sales s
    WHERE s.sale_id = sale_payments.sale_id
      AND s.tenant_id = get_current_user_tenant_id()
  )
);

-- Cajeros solo pueden ver pagos de SUS ventas
CREATE POLICY "Cashiers can view their sale payments"
ON sale_payments FOR SELECT
USING (
  is_user_cashier()
  AND EXISTS (
    SELECT 1 FROM sales s
    JOIN cash_sessions cs ON cs.cash_session_id = s.cash_session_id
    JOIN users u ON u.user_id = cs.opened_by
    WHERE s.sale_id = sale_payments.sale_id
      AND u.auth_user_id = auth.uid()
      AND s.tenant_id = get_current_user_tenant_id()
  )
);

-- Cajeros pueden crear pagos en SUS ventas
CREATE POLICY "Cashiers can create sale payments"
ON sale_payments FOR INSERT
WITH CHECK (
  is_user_cashier()
  AND EXISTS (
    SELECT 1 FROM sales s
    JOIN cash_sessions cs ON cs.cash_session_id = s.cash_session_id
    JOIN users u ON u.user_id = cs.opened_by
    WHERE s.sale_id = sale_payments.sale_id
      AND u.auth_user_id = auth.uid()
      AND cs.status = 'OPEN'
      AND s.tenant_id = get_current_user_tenant_id()
  )
);

-- =====================================================
-- 3. POLÍTICAS: sale_returns (Devoluciones)
-- =====================================================

ALTER TABLE sale_returns ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas existentes
DROP POLICY IF EXISTS "Admins can manage sale returns" ON sale_returns;
DROP POLICY IF EXISTS "Cashiers can view their sale returns" ON sale_returns;
DROP POLICY IF EXISTS "Cashiers can create sale returns" ON sale_returns;

-- Admins pueden gestionar todas las devoluciones
CREATE POLICY "Admins can manage sale returns"
ON sale_returns FOR ALL
USING (
  is_user_admin()
  AND EXISTS (
    SELECT 1 FROM sales s
    WHERE s.sale_id = sale_returns.sale_id
      AND s.tenant_id = get_current_user_tenant_id()
  )
)
WITH CHECK (
  is_user_admin()
  AND EXISTS (
    SELECT 1 FROM sales s
    WHERE s.sale_id = sale_returns.sale_id
      AND s.tenant_id = get_current_user_tenant_id()
  )
);

-- Cajeros solo pueden ver devoluciones de SUS ventas
CREATE POLICY "Cashiers can view their sale returns"
ON sale_returns FOR SELECT
USING (
  is_user_cashier()
  AND EXISTS (
    SELECT 1 FROM sales s
    JOIN cash_sessions cs ON cs.cash_session_id = s.cash_session_id
    JOIN users u ON u.user_id = cs.opened_by
    WHERE s.sale_id = sale_returns.sale_id
      AND u.auth_user_id = auth.uid()
      AND s.tenant_id = get_current_user_tenant_id()
  )
);

-- Cajeros pueden crear devoluciones de SUS ventas
CREATE POLICY "Cashiers can create sale returns"
ON sale_returns FOR INSERT
WITH CHECK (
  is_user_cashier()
  AND EXISTS (
    SELECT 1 FROM sales s
    JOIN cash_sessions cs ON cs.cash_session_id = s.cash_session_id
    JOIN users u ON u.user_id = cs.opened_by
    WHERE s.sale_id = sale_returns.sale_id
      AND u.auth_user_id = auth.uid()
      AND s.tenant_id = get_current_user_tenant_id()
  )
);

-- =====================================================
-- 4. POLÍTICAS: stock_balances (Inventario por Sede)
-- =====================================================

ALTER TABLE stock_balances ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas existentes
DROP POLICY IF EXISTS "Admins can manage stock balances" ON stock_balances;
DROP POLICY IF EXISTS "Cashiers can view stock in their locations" ON stock_balances;

-- Admins pueden gestionar todo el inventario
CREATE POLICY "Admins can manage stock balances"
ON stock_balances FOR ALL
USING (
  is_user_admin()
  AND tenant_id = get_current_user_tenant_id()
)
WITH CHECK (
  is_user_admin()
  AND tenant_id = get_current_user_tenant_id()
);

-- Cajeros solo pueden ver inventario de SUS sedes asignadas
CREATE POLICY "Cashiers can view stock in their locations"
ON stock_balances FOR SELECT
USING (
  is_user_cashier()
  AND tenant_id = get_current_user_tenant_id()
  AND location_id IN (SELECT get_user_assigned_locations())
);

-- =====================================================
-- 5. POLÍTICAS: inventory_moves (Movimientos por Sede)
-- =====================================================

ALTER TABLE inventory_moves ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas existentes
DROP POLICY IF EXISTS "Admins can manage inventory moves" ON inventory_moves;
DROP POLICY IF EXISTS "Cashiers can view moves in their locations" ON inventory_moves;
DROP POLICY IF EXISTS "Cashiers can create moves in their locations" ON inventory_moves;

-- Admins pueden gestionar todos los movimientos
CREATE POLICY "Admins can manage inventory moves"
ON inventory_moves FOR ALL
USING (
  is_user_admin()
  AND tenant_id = get_current_user_tenant_id()
)
WITH CHECK (
  is_user_admin()
  AND tenant_id = get_current_user_tenant_id()
);

-- Cajeros solo pueden ver movimientos de SUS sedes
CREATE POLICY "Cashiers can view moves in their locations"
ON inventory_moves FOR SELECT
USING (
  is_user_cashier()
  AND tenant_id = get_current_user_tenant_id()
  AND location_id IN (SELECT get_user_assigned_locations())
);

-- Cajeros pueden crear movimientos en SUS sedes (ajustes)
CREATE POLICY "Cashiers can create moves in their locations"
ON inventory_moves FOR INSERT
WITH CHECK (
  is_user_cashier()
  AND tenant_id = get_current_user_tenant_id()
  AND location_id IN (SELECT get_user_assigned_locations())
  AND move_type IN ('SALE', 'RETURN', 'ADJUSTMENT') -- Solo ciertos tipos
);

-- =====================================================
-- 6. POLÍTICAS: layaway_contracts (Contratos por Sede)
-- =====================================================

-- Nota: Estas políticas reemplazan las del archivo SECURITY_FIXES.sql
-- para agregar las restricciones de cajero

ALTER TABLE layaway_contracts ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas existentes
DROP POLICY IF EXISTS "Admins can manage layaway contracts" ON layaway_contracts;
DROP POLICY IF EXISTS "Cashiers can view contracts in their locations" ON layaway_contracts;
DROP POLICY IF EXISTS "Cashiers can create contracts in their locations" ON layaway_contracts;
DROP POLICY IF EXISTS "Cashiers can update contracts in their locations" ON layaway_contracts;

-- Admins pueden gestionar todos los contratos
CREATE POLICY "Admins can manage layaway contracts"
ON layaway_contracts FOR ALL
USING (
  is_user_admin()
  AND tenant_id = get_current_user_tenant_id()
)
WITH CHECK (
  is_user_admin()
  AND tenant_id = get_current_user_tenant_id()
);

-- Cajeros solo pueden ver contratos de SUS sedes
CREATE POLICY "Cashiers can view contracts in their locations"
ON layaway_contracts FOR SELECT
USING (
  is_user_cashier()
  AND tenant_id = get_current_user_tenant_id()
  AND location_id IN (SELECT get_user_assigned_locations())
);

-- Cajeros pueden crear contratos en SUS sedes
CREATE POLICY "Cashiers can create contracts in their locations"
ON layaway_contracts FOR INSERT
WITH CHECK (
  is_user_cashier()
  AND tenant_id = get_current_user_tenant_id()
  AND location_id IN (SELECT get_user_assigned_locations())
);

-- Cajeros pueden actualizar contratos de SUS sedes
CREATE POLICY "Cashiers can update contracts in their locations"
ON layaway_contracts FOR UPDATE
USING (
  is_user_cashier()
  AND tenant_id = get_current_user_tenant_id()
  AND location_id IN (SELECT get_user_assigned_locations())
)
WITH CHECK (
  is_user_cashier()
  AND tenant_id = get_current_user_tenant_id()
  AND location_id IN (SELECT get_user_assigned_locations())
);

-- =====================================================
-- 7. POLÍTICAS: layaway_items (Items por Contrato)
-- =====================================================

ALTER TABLE layaway_items ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas existentes
DROP POLICY IF EXISTS "Admins can manage layaway items" ON layaway_items;
DROP POLICY IF EXISTS "Cashiers can view items in their contracts" ON layaway_items;
DROP POLICY IF EXISTS "Cashiers can create items in their contracts" ON layaway_items;

-- Admins pueden gestionar todos los items
CREATE POLICY "Admins can manage layaway items"
ON layaway_items FOR ALL
USING (
  is_user_admin()
  AND EXISTS (
    SELECT 1 FROM layaway_contracts lc
    WHERE lc.layaway_id = layaway_items.layaway_id
      AND lc.tenant_id = get_current_user_tenant_id()
  )
)
WITH CHECK (
  is_user_admin()
  AND EXISTS (
    SELECT 1 FROM layaway_contracts lc
    WHERE lc.layaway_id = layaway_items.layaway_id
      AND lc.tenant_id = get_current_user_tenant_id()
  )
);

-- Cajeros solo pueden ver items de contratos de SUS sedes
CREATE POLICY "Cashiers can view items in their contracts"
ON layaway_items FOR SELECT
USING (
  is_user_cashier()
  AND EXISTS (
    SELECT 1 FROM layaway_contracts lc
    WHERE lc.layaway_id = layaway_items.layaway_id
      AND lc.tenant_id = get_current_user_tenant_id()
      AND lc.location_id IN (SELECT get_user_assigned_locations())
  )
);

-- Cajeros pueden crear items en contratos de SUS sedes
CREATE POLICY "Cashiers can create items in their contracts"
ON layaway_items FOR INSERT
WITH CHECK (
  is_user_cashier()
  AND EXISTS (
    SELECT 1 FROM layaway_contracts lc
    WHERE lc.layaway_id = layaway_items.layaway_id
      AND lc.tenant_id = get_current_user_tenant_id()
      AND lc.location_id IN (SELECT get_user_assigned_locations())
  )
);

-- =====================================================
-- 8. POLÍTICAS: layaway_payments (Pagos por Sesión)
-- =====================================================

ALTER TABLE layaway_payments ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas existentes
DROP POLICY IF EXISTS "Admins can manage layaway payments" ON layaway_payments;
DROP POLICY IF EXISTS "Cashiers can view their layaway payments" ON layaway_payments;
DROP POLICY IF EXISTS "Cashiers can create layaway payments" ON layaway_payments;

-- Admins pueden gestionar todos los pagos
CREATE POLICY "Admins can manage layaway payments"
ON layaway_payments FOR ALL
USING (
  is_user_admin()
  AND tenant_id = get_current_user_tenant_id()
)
WITH CHECK (
  is_user_admin()
  AND tenant_id = get_current_user_tenant_id()
);

-- Cajeros solo pueden ver pagos de SUS sesiones
CREATE POLICY "Cashiers can view their layaway payments"
ON layaway_payments FOR SELECT
USING (
  is_user_cashier()
  AND tenant_id = get_current_user_tenant_id()
  AND (
    cash_session_id IS NULL -- Pagos sin sesión visibles para todos los cajeros de la sede
    OR EXISTS (
      SELECT 1 FROM cash_sessions cs
      JOIN users u ON u.user_id = cs.opened_by
      WHERE cs.cash_session_id = layaway_payments.cash_session_id
        AND u.auth_user_id = auth.uid()
    )
  )
);

-- Cajeros pueden crear pagos en SUS sesiones
CREATE POLICY "Cashiers can create layaway payments"
ON layaway_payments FOR INSERT
WITH CHECK (
  is_user_cashier()
  AND tenant_id = get_current_user_tenant_id()
  AND (
    cash_session_id IS NULL
    OR EXISTS (
      SELECT 1 FROM cash_sessions cs
      JOIN users u ON u.user_id = cs.opened_by
      WHERE cs.cash_session_id = layaway_payments.cash_session_id
        AND u.auth_user_id = auth.uid()
        AND cs.status = 'OPEN'
    )
  )
);

-- =====================================================
-- 9. POLÍTICAS: layaway_installments (Cuotas)
-- =====================================================

ALTER TABLE layaway_installments ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas existentes
DROP POLICY IF EXISTS "Admins can manage layaway installments" ON layaway_installments;
DROP POLICY IF EXISTS "Cashiers can view installments in their contracts" ON layaway_installments;
DROP POLICY IF EXISTS "Cashiers can create installments" ON layaway_installments;
DROP POLICY IF EXISTS "Cashiers can update installments" ON layaway_installments;

-- Admins pueden gestionar todas las cuotas
CREATE POLICY "Admins can manage layaway installments"
ON layaway_installments FOR ALL
USING (
  is_user_admin()
  AND EXISTS (
    SELECT 1 FROM layaway_contracts lc
    WHERE lc.layaway_id = layaway_installments.layaway_id
      AND lc.tenant_id = get_current_user_tenant_id()
  )
)
WITH CHECK (
  is_user_admin()
  AND EXISTS (
    SELECT 1 FROM layaway_contracts lc
    WHERE lc.layaway_id = layaway_installments.layaway_id
      AND lc.tenant_id = get_current_user_tenant_id()
  )
);

-- Cajeros solo pueden ver cuotas de contratos de SUS sedes
CREATE POLICY "Cashiers can view installments in their contracts"
ON layaway_installments FOR SELECT
USING (
  is_user_cashier()
  AND EXISTS (
    SELECT 1 FROM layaway_contracts lc
    WHERE lc.layaway_id = layaway_installments.layaway_id
      AND lc.tenant_id = get_current_user_tenant_id()
      AND lc.location_id IN (SELECT get_user_assigned_locations())
  )
);

-- Cajeros pueden crear cuotas
CREATE POLICY "Cashiers can create installments"
ON layaway_installments FOR INSERT
WITH CHECK (
  is_user_cashier()
  AND EXISTS (
    SELECT 1 FROM layaway_contracts lc
    WHERE lc.layaway_id = layaway_installments.layaway_id
      AND lc.tenant_id = get_current_user_tenant_id()
      AND lc.location_id IN (SELECT get_user_assigned_locations())
  )
);

-- Cajeros pueden actualizar cuotas (marcar como pagadas)
CREATE POLICY "Cashiers can update installments"
ON layaway_installments FOR UPDATE
USING (
  is_user_cashier()
  AND EXISTS (
    SELECT 1 FROM layaway_contracts lc
    WHERE lc.layaway_id = layaway_installments.layaway_id
      AND lc.tenant_id = get_current_user_tenant_id()
      AND lc.location_id IN (SELECT get_user_assigned_locations())
  )
)
WITH CHECK (
  is_user_cashier()
  AND EXISTS (
    SELECT 1 FROM layaway_contracts lc
    WHERE lc.layaway_id = layaway_installments.layaway_id
      AND lc.tenant_id = get_current_user_tenant_id()
      AND lc.location_id IN (SELECT get_user_assigned_locations())
  )
);

-- =====================================================
-- VERIFICACIÓN POST-APLICACIÓN
-- =====================================================

-- Verificar que todas las tablas tienen RLS habilitado
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN (
    'sale_lines', 'sale_payments', 'sale_returns',
    'stock_balances', 'inventory_moves',
    'layaway_contracts', 'layaway_items', 'layaway_payments', 'layaway_installments'
  )
ORDER BY tablename;
-- Resultado esperado: todas con rowsecurity = true

-- Verificar políticas por tabla
SELECT schemaname, tablename, policyname, cmd, roles
FROM pg_policies
WHERE tablename IN (
  'sale_lines', 'sale_payments', 'sale_returns',
  'stock_balances', 'inventory_moves',
  'layaway_contracts', 'layaway_items', 'layaway_payments', 'layaway_installments'
)
ORDER BY tablename, cmd, policyname;

-- =====================================================
-- MENSAJE FINAL
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '✅ Políticas RLS para CAJEROS implementadas correctamente';
  RAISE NOTICE '📍 Cajeros solo ven:';
  RAISE NOTICE '   - Sus propias ventas (de sus sesiones)';
  RAISE NOTICE '   - Inventario de sus sedes asignadas';
  RAISE NOTICE '   - Contratos de plan separe de sus sedes';
  RAISE NOTICE '   - Pagos realizados en sus sesiones';
  RAISE NOTICE '🔒 Administradores ven todo sin restricciones';
END $$;
