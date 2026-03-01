/* ============================================================
   FIX ALTERNATIVO: Funciones SQL en lugar de Vistas
   ============================================================
   
   Las vistas en Supabase no respetan RLS correctamente cuando
   se consultan desde el cliente. La solución es usar funciones
   SQL que ejecuten las consultas con SECURITY DEFINER.
   
   ============================================================ */

-- =========================
-- FUNCIÓN: Obtener ventas filtradas por rol
-- =========================
CREATE OR REPLACE FUNCTION get_sales_by_role(
  p_from_date timestamptz,
  p_to_date timestamptz,
  p_location_id uuid DEFAULT NULL
)
RETURNS TABLE (
  sale_id uuid,
  tenant_id uuid,
  location_id uuid,
  cash_session_id uuid,
  customer_id uuid,
  sold_by uuid,
  sale_number text,
  subtotal numeric,
  discount_total numeric,
  tax_total numeric,
  total numeric,
  status text,
  sold_at timestamptz,
  note text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_tenant_id uuid;
  v_is_admin boolean;
  v_is_cashier boolean;
BEGIN
  -- Obtener tenant y roles del usuario actual
  v_tenant_id := get_current_user_tenant_id();
  v_is_admin := is_user_admin();
  v_is_cashier := is_user_cashier();
  
  RETURN QUERY
  SELECT 
    s.sale_id,
    s.tenant_id,
    s.location_id,
    s.cash_session_id,
    s.customer_id,
    s.sold_by,
    s.sale_number,
    s.subtotal,
    s.discount_total,
    s.tax_total,
    s.total,
    s.status,
    s.sold_at,
    s.note,
    s.created_at
  FROM sales s
  WHERE 
    s.tenant_id = v_tenant_id
    AND s.sold_at >= p_from_date
    AND s.sold_at <= p_to_date
    AND (p_location_id IS NULL OR s.location_id = p_location_id)
    AND s.status IN ('COMPLETED', 'PARTIAL_RETURN', 'RETURNED')
    AND (
      -- Admin ve todas
      v_is_admin
      OR
      -- Cajero solo ve sus ventas
      (
        v_is_cashier
        AND s.cash_session_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM cash_sessions cs
          JOIN users u ON u.user_id = cs.opened_by
          WHERE cs.cash_session_id = s.cash_session_id
            AND u.auth_user_id = auth.uid()
        )
      )
      OR
      -- Otros roles ven todas
      (NOT v_is_admin AND NOT v_is_cashier)
    )
  ORDER BY s.sold_at DESC;
END;
$$;

-- =========================
-- FUNCIÓN: Obtener líneas de venta filtradas
-- =========================
CREATE OR REPLACE FUNCTION get_sale_lines_by_role(
  p_from_date timestamptz,
  p_to_date timestamptz
)
RETURNS TABLE (
  sale_line_id uuid,
  sale_id uuid,
  variant_id uuid,
  quantity numeric,
  unit_price numeric,
  unit_cost numeric,
  discount_amount numeric,
  tax_amount numeric,
  line_total numeric,
  tax_detail jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_tenant_id uuid;
  v_is_admin boolean;
  v_is_cashier boolean;
BEGIN
  v_tenant_id := get_current_user_tenant_id();
  v_is_admin := is_user_admin();
  v_is_cashier := is_user_cashier();
  
  RETURN QUERY
  SELECT 
    sl.sale_line_id,
    sl.sale_id,
    sl.variant_id,
    sl.quantity,
    sl.unit_price,
    sl.unit_cost,
    sl.discount_amount,
    sl.tax_amount,
    sl.line_total,
    sl.tax_detail
  FROM sale_lines sl
  JOIN sales s ON s.sale_id = sl.sale_id
  WHERE 
    s.tenant_id = v_tenant_id
    AND s.sold_at >= p_from_date
    AND s.sold_at <= p_to_date
    AND s.status IN ('COMPLETED', 'PARTIAL_RETURN', 'RETURNED')
    AND (
      v_is_admin
      OR
      (
        v_is_cashier
        AND s.cash_session_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM cash_sessions cs
          JOIN users u ON u.user_id = cs.opened_by
          WHERE cs.cash_session_id = s.cash_session_id
            AND u.auth_user_id = auth.uid()
        )
      )
      OR
      (NOT v_is_admin AND NOT v_is_cashier)
    );
END;
$$;

-- =========================
-- FUNCIÓN: Obtener pagos de venta filtrados
-- =========================
CREATE OR REPLACE FUNCTION get_sale_payments_by_role(
  p_from_date timestamptz,
  p_to_date timestamptz
)
RETURNS TABLE (
  sale_payment_id uuid,
  sale_id uuid,
  payment_method_id uuid,
  amount numeric,
  reference_number text
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_tenant_id uuid;
  v_is_admin boolean;
  v_is_cashier boolean;
BEGIN
  v_tenant_id := get_current_user_tenant_id();
  v_is_admin := is_user_admin();
  v_is_cashier := is_user_cashier();
  
  RETURN QUERY
  SELECT 
    sp.sale_payment_id,
    sp.sale_id,
    sp.payment_method_id,
    sp.amount,
    sp.reference_number
  FROM sale_payments sp
  JOIN sales s ON s.sale_id = sp.sale_id
  WHERE 
    s.tenant_id = v_tenant_id
    AND s.sold_at >= p_from_date
    AND s.sold_at <= p_to_date
    AND s.status IN ('COMPLETED', 'PARTIAL_RETURN', 'RETURNED')
    AND (
      v_is_admin
      OR
      (
        v_is_cashier
        AND s.cash_session_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM cash_sessions cs
          JOIN users u ON u.user_id = cs.opened_by
          WHERE cs.cash_session_id = s.cash_session_id
            AND u.auth_user_id = auth.uid()
        )
      )
      OR
      (NOT v_is_admin AND NOT v_is_cashier)
    );
END;
$$;

-- =========================
-- FUNCIÓN: Obtener movimientos de caja filtrados
-- =========================
CREATE OR REPLACE FUNCTION get_cash_movements_by_role(
  p_from_date timestamptz,
  p_to_date timestamptz,
  p_location_id uuid DEFAULT NULL,
  p_type text DEFAULT NULL
)
RETURNS TABLE (
  cash_movement_id uuid,
  cash_session_id uuid,
  type text,
  category text,
  amount numeric,
  note text,
  created_at timestamptz,
  created_by uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_tenant_id uuid;
  v_is_admin boolean;
  v_is_cashier boolean;
BEGIN
  v_tenant_id := get_current_user_tenant_id();
  v_is_admin := is_user_admin();
  v_is_cashier := is_user_cashier();
  
  RETURN QUERY
  SELECT 
    cm.cash_movement_id,
    cm.cash_session_id,
    cm.type,
    cm.category,
    cm.amount,
    cm.note,
    cm.created_at,
    cm.created_by
  FROM cash_movements cm
  JOIN cash_sessions cs ON cs.cash_session_id = cm.cash_session_id
  WHERE 
    cm.tenant_id = v_tenant_id
    AND cm.created_at >= p_from_date
    AND cm.created_at <= p_to_date
    AND (p_type IS NULL OR cm.type = p_type)
    AND (p_location_id IS NULL OR cs.cash_register_id IN (
      SELECT cash_register_id FROM cash_registers WHERE location_id = p_location_id
    ))
    AND (
      v_is_admin
      OR
      (
        v_is_cashier
        AND EXISTS (
          SELECT 1 FROM users u
          WHERE u.auth_user_id = auth.uid()
            AND u.user_id = cs.opened_by
        )
      )
      OR
      (NOT v_is_admin AND NOT v_is_cashier)
    )
  ORDER BY cm.created_at DESC;
END;
$$;

-- =========================
-- MENSAJE FINAL
-- =========================
DO $$
BEGIN
  RAISE NOTICE '✅ Funciones de filtrado creadas correctamente';
  RAISE NOTICE '📝 Usar get_sales_by_role() en lugar de consultar sales directamente';
  RAISE NOTICE '📝 Los cajeros solo verán sus datos';
END $$;
