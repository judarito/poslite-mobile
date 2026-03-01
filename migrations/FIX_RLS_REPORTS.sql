/* ============================================================
   FIX: Políticas RLS para Vistas de Reportes
   ============================================================
   
   Las vistas de reportes deben ser accesibles para ADMINISTRADOR
   sin restricciones, pero respetando las políticas para CAJERO.
   
   ============================================================ */

-- =========================
-- 1) PRODUCTOS (necesario para vistas)
-- =========================
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view products in their tenant" ON products;

CREATE POLICY "Users can view products in their tenant"
ON products FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = products.tenant_id
  )
);

-- =========================
-- 2) CUSTOMERS (necesario para vistas)
-- =========================
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view customers in their tenant" ON customers;

CREATE POLICY "Users can view customers in their tenant"
ON customers FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = customers.tenant_id
  )
);

-- =========================
-- 3) STOCK_MOVEMENTS (necesario para kardex)
-- =========================
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage stock movements" ON stock_movements;
DROP POLICY IF EXISTS "Users can view stock movements" ON stock_movements;

CREATE POLICY "Admins can manage stock movements"
ON stock_movements FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM users u
    JOIN user_roles ur ON ur.user_id = u.user_id
    JOIN roles r ON r.role_id = ur.role_id
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = stock_movements.tenant_id
      AND r.name = 'ADMINISTRADOR'
  )
);

CREATE POLICY "Users can view stock movements"
ON stock_movements FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = stock_movements.tenant_id
  )
);

-- =========================
-- MENSAJE FINAL
-- =========================
DO $$
BEGIN
  RAISE NOTICE '✅ Políticas RLS para vistas de reportes actualizadas';
  RAISE NOTICE '📝 Los reportes ahora funcionarán correctamente';
END $$;
