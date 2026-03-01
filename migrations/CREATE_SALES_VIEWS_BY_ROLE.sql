/* ============================================================
   FIX: Vista de Ventas con Restricción por Rol de Usuario
   ============================================================
   
   Esta vista aplica automáticamente las restricciones:
   - CAJERO: Solo ve ventas de sus sesiones de caja
   - ADMINISTRADOR: Ve todas las ventas del tenant
   - OTROS ROLES: Ven todas las ventas del tenant
   
   Los reportes deben usar esta vista en lugar de la tabla sales
   
   ============================================================ */

-- Vista para ventas con filtrado por rol
CREATE OR REPLACE VIEW v_sales_by_role AS
SELECT 
  s.*
FROM sales s
WHERE 
  s.tenant_id = get_current_user_tenant_id()
  AND (
    -- Caso 1: Usuario es ADMINISTRADOR - ve todo
    is_user_admin()
    OR
    -- Caso 2: Usuario es CAJERO - solo ve sus propias ventas con sesión
    (
      is_user_cashier()
      AND s.cash_session_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM cash_sessions cs
        JOIN users u ON u.user_id = cs.opened_by
        WHERE cs.cash_session_id = s.cash_session_id
          AND u.auth_user_id = auth.uid()
      )
    )
    OR
    -- Caso 3: Usuario NO es admin NI cajero - ve todo del tenant
    (
      NOT is_user_admin()
      AND NOT is_user_cashier()
    )
  );

-- Vista para líneas de venta con filtrado por rol
CREATE OR REPLACE VIEW v_sale_lines_by_role AS
SELECT 
  sl.*
FROM sale_lines sl
WHERE EXISTS (
  SELECT 1 FROM v_sales_by_role vs
  WHERE vs.sale_id = sl.sale_id
);

-- Vista para pagos de venta con filtrado por rol
CREATE OR REPLACE VIEW v_sale_payments_by_role AS
SELECT 
  sp.*
FROM sale_payments sp
WHERE EXISTS (
  SELECT 1 FROM v_sales_by_role vs
  WHERE vs.sale_id = sp.sale_id
);

-- Vista para devoluciones con filtrado por rol
CREATE OR REPLACE VIEW v_sale_returns_by_role AS
SELECT 
  sr.*
FROM sale_returns sr
WHERE EXISTS (
  SELECT 1 FROM v_sales_by_role vs
  WHERE vs.sale_id = sr.sale_id
);

-- Vista para sesiones de caja con filtrado por rol
CREATE OR REPLACE VIEW v_cash_sessions_by_role AS
SELECT 
  cs.*
FROM cash_sessions cs
WHERE 
  cs.tenant_id = get_current_user_tenant_id()
  AND (
    -- Admin ve todas
    is_user_admin()
    OR
    -- Cajero solo ve las suyas
    (
      is_user_cashier()
      AND EXISTS (
        SELECT 1 FROM users u
        WHERE u.auth_user_id = auth.uid()
          AND u.user_id = cs.opened_by
      )
    )
    OR
    -- Otros roles ven todas
    (
      NOT is_user_admin()
      AND NOT is_user_cashier()
    )
  );

-- Vista para movimientos de caja con filtrado por rol
CREATE OR REPLACE VIEW v_cash_movements_by_role AS
SELECT 
  cm.*
FROM cash_movements cm
WHERE EXISTS (
  SELECT 1 FROM v_cash_sessions_by_role cs
  WHERE cs.cash_session_id = cm.cash_session_id
);

-- =========================
-- HABILITAR RLS EN LAS VISTAS
-- =========================
-- Las vistas deben tener RLS para que Supabase las respete
ALTER VIEW v_sales_by_role SET (security_invoker = true);
ALTER VIEW v_sale_lines_by_role SET (security_invoker = true);
ALTER VIEW v_sale_payments_by_role SET (security_invoker = true);
ALTER VIEW v_sale_returns_by_role SET (security_invoker = true);
ALTER VIEW v_cash_sessions_by_role SET (security_invoker = true);
ALTER VIEW v_cash_movements_by_role SET (security_invoker = true);

-- =========================
-- MENSAJE FINAL
-- =========================
DO $$
BEGIN
  RAISE NOTICE '✅ Vistas creadas correctamente';
  RAISE NOTICE '📝 Los servicios deben usar v_sales_by_role en lugar de sales';
  RAISE NOTICE '📝 Los cajeros solo verán sus datos en reportes';
END $$;
