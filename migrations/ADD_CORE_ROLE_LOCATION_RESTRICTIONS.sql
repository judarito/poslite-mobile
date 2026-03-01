-- ===================================================================
-- Core Seguridad v1: Restricciones por rol/sede para modulos nuevos
-- ===================================================================

-- Helpers reutilizables para politicas RLS
CREATE OR REPLACE FUNCTION fn_is_admin_or_manager()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.user_id
    JOIN roles r ON r.role_id = ur.role_id
    WHERE u.auth_user_id = auth.uid()
      AND r.name IN ('ADMINISTRADOR', 'GERENTE')
  );
$$;

CREATE OR REPLACE FUNCTION fn_user_assigned_locations()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT DISTINCT cr.location_id
  FROM users u
  JOIN cash_register_assignments a
    ON a.user_id = u.user_id
   AND a.is_active = TRUE
  JOIN cash_registers cr
    ON cr.cash_register_id = a.cash_register_id
  WHERE u.auth_user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION fn_can_access_location(p_location_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    fn_is_admin_or_manager()
    OR (
      is_user_cashier()
      AND p_location_id IN (SELECT fn_user_assigned_locations())
    )
    OR NOT is_user_cashier();
$$;

-- =====================================================
-- purchase_orders / purchase_order_lines
-- =====================================================
DROP POLICY IF EXISTS tenant_isolation_purchase_orders ON purchase_orders;
DROP POLICY IF EXISTS tenant_isolation_purchase_order_lines ON purchase_order_lines;
DROP POLICY IF EXISTS purchase_orders_role_scope_select ON purchase_orders;
DROP POLICY IF EXISTS purchase_orders_role_scope_insert ON purchase_orders;
DROP POLICY IF EXISTS purchase_orders_role_scope_update ON purchase_orders;
DROP POLICY IF EXISTS purchase_order_lines_role_scope_select ON purchase_order_lines;
DROP POLICY IF EXISTS purchase_order_lines_role_scope_insert ON purchase_order_lines;
DROP POLICY IF EXISTS purchase_order_lines_role_scope_update ON purchase_order_lines;
DROP POLICY IF EXISTS purchase_order_lines_role_scope_delete ON purchase_order_lines;

CREATE POLICY purchase_orders_role_scope_select
ON purchase_orders FOR SELECT
USING (
  tenant_id = get_current_user_tenant_id()
  AND fn_can_access_location(location_id)
);

CREATE POLICY purchase_orders_role_scope_insert
ON purchase_orders FOR INSERT
WITH CHECK (
  tenant_id = get_current_user_tenant_id()
  AND fn_can_access_location(location_id)
);

CREATE POLICY purchase_orders_role_scope_update
ON purchase_orders FOR UPDATE
USING (
  tenant_id = get_current_user_tenant_id()
  AND fn_can_access_location(location_id)
)
WITH CHECK (
  tenant_id = get_current_user_tenant_id()
  AND fn_can_access_location(location_id)
);

CREATE POLICY purchase_order_lines_role_scope_select
ON purchase_order_lines FOR SELECT
USING (
  tenant_id = get_current_user_tenant_id()
  AND (
    NOT is_user_cashier()
    OR EXISTS (
      SELECT 1
      FROM purchase_orders po
      WHERE po.purchase_order_id = purchase_order_lines.purchase_order_id
        AND po.tenant_id = purchase_order_lines.tenant_id
        AND fn_can_access_location(po.location_id)
    )
  )
);

CREATE POLICY purchase_order_lines_role_scope_insert
ON purchase_order_lines FOR INSERT
WITH CHECK (
  tenant_id = get_current_user_tenant_id()
  AND (
    NOT is_user_cashier()
    OR EXISTS (
      SELECT 1
      FROM purchase_orders po
      WHERE po.purchase_order_id = purchase_order_lines.purchase_order_id
        AND po.tenant_id = purchase_order_lines.tenant_id
        AND fn_can_access_location(po.location_id)
    )
  )
);

CREATE POLICY purchase_order_lines_role_scope_update
ON purchase_order_lines FOR UPDATE
USING (
  tenant_id = get_current_user_tenant_id()
  AND (
    NOT is_user_cashier()
    OR EXISTS (
      SELECT 1
      FROM purchase_orders po
      WHERE po.purchase_order_id = purchase_order_lines.purchase_order_id
        AND po.tenant_id = purchase_order_lines.tenant_id
        AND fn_can_access_location(po.location_id)
    )
  )
)
WITH CHECK (
  tenant_id = get_current_user_tenant_id()
  AND (
    NOT is_user_cashier()
    OR EXISTS (
      SELECT 1
      FROM purchase_orders po
      WHERE po.purchase_order_id = purchase_order_lines.purchase_order_id
        AND po.tenant_id = purchase_order_lines.tenant_id
        AND fn_can_access_location(po.location_id)
    )
  )
);

CREATE POLICY purchase_order_lines_role_scope_delete
ON purchase_order_lines FOR DELETE
USING (
  tenant_id = get_current_user_tenant_id()
  AND (
    NOT is_user_cashier()
    OR EXISTS (
      SELECT 1
      FROM purchase_orders po
      WHERE po.purchase_order_id = purchase_order_lines.purchase_order_id
        AND po.tenant_id = purchase_order_lines.tenant_id
        AND fn_can_access_location(po.location_id)
    )
  )
);

-- =====================================================
-- purchase_returns / purchase_return_lines
-- =====================================================
DROP POLICY IF EXISTS tenant_isolation_purchase_returns ON purchase_returns;
DROP POLICY IF EXISTS tenant_isolation_purchase_return_lines ON purchase_return_lines;
DROP POLICY IF EXISTS purchase_returns_role_scope_select ON purchase_returns;
DROP POLICY IF EXISTS purchase_returns_role_scope_insert ON purchase_returns;
DROP POLICY IF EXISTS purchase_return_lines_role_scope_select ON purchase_return_lines;
DROP POLICY IF EXISTS purchase_return_lines_role_scope_insert ON purchase_return_lines;

CREATE POLICY purchase_returns_role_scope_select
ON purchase_returns FOR SELECT
USING (
  tenant_id = get_current_user_tenant_id()
  AND fn_can_access_location(location_id)
);

CREATE POLICY purchase_returns_role_scope_insert
ON purchase_returns FOR INSERT
WITH CHECK (
  tenant_id = get_current_user_tenant_id()
  AND fn_can_access_location(location_id)
);

CREATE POLICY purchase_return_lines_role_scope_select
ON purchase_return_lines FOR SELECT
USING (
  tenant_id = get_current_user_tenant_id()
  AND (
    NOT is_user_cashier()
    OR EXISTS (
      SELECT 1
      FROM purchase_returns pr
      WHERE pr.purchase_return_id = purchase_return_lines.purchase_return_id
        AND pr.tenant_id = purchase_return_lines.tenant_id
        AND fn_can_access_location(pr.location_id)
    )
  )
);

CREATE POLICY purchase_return_lines_role_scope_insert
ON purchase_return_lines FOR INSERT
WITH CHECK (
  tenant_id = get_current_user_tenant_id()
  AND (
    NOT is_user_cashier()
    OR EXISTS (
      SELECT 1
      FROM purchase_returns pr
      WHERE pr.purchase_return_id = purchase_return_lines.purchase_return_id
        AND pr.tenant_id = purchase_return_lines.tenant_id
        AND fn_can_access_location(pr.location_id)
    )
  )
);

-- =====================================================
-- supplier_payables / supplier_payable_payments
-- =====================================================
DROP POLICY IF EXISTS tenant_isolation_supplier_payables ON supplier_payables;
DROP POLICY IF EXISTS tenant_isolation_supplier_payments ON supplier_payable_payments;
DROP POLICY IF EXISTS supplier_payables_role_scope_select ON supplier_payables;
DROP POLICY IF EXISTS supplier_payables_role_scope_insert ON supplier_payables;
DROP POLICY IF EXISTS supplier_payables_role_scope_update ON supplier_payables;
DROP POLICY IF EXISTS supplier_payable_payments_role_scope_select ON supplier_payable_payments;
DROP POLICY IF EXISTS supplier_payable_payments_role_scope_insert ON supplier_payable_payments;

CREATE POLICY supplier_payables_role_scope_select
ON supplier_payables FOR SELECT
USING (
  tenant_id = get_current_user_tenant_id()
  AND (
    NOT is_user_cashier()
    OR EXISTS (
      SELECT 1
      FROM purchases p
      WHERE p.purchase_id = supplier_payables.purchase_id
        AND p.tenant_id = supplier_payables.tenant_id
        AND fn_can_access_location(p.location_id)
    )
  )
);

CREATE POLICY supplier_payables_role_scope_insert
ON supplier_payables FOR INSERT
WITH CHECK (
  tenant_id = get_current_user_tenant_id()
  AND (
    NOT is_user_cashier()
    OR EXISTS (
      SELECT 1
      FROM purchases p
      WHERE p.purchase_id = supplier_payables.purchase_id
        AND p.tenant_id = supplier_payables.tenant_id
        AND fn_can_access_location(p.location_id)
    )
  )
);

CREATE POLICY supplier_payables_role_scope_update
ON supplier_payables FOR UPDATE
USING (
  tenant_id = get_current_user_tenant_id()
  AND (
    NOT is_user_cashier()
    OR EXISTS (
      SELECT 1
      FROM purchases p
      WHERE p.purchase_id = supplier_payables.purchase_id
        AND p.tenant_id = supplier_payables.tenant_id
        AND fn_can_access_location(p.location_id)
    )
  )
)
WITH CHECK (
  tenant_id = get_current_user_tenant_id()
  AND (
    NOT is_user_cashier()
    OR EXISTS (
      SELECT 1
      FROM purchases p
      WHERE p.purchase_id = supplier_payables.purchase_id
        AND p.tenant_id = supplier_payables.tenant_id
        AND fn_can_access_location(p.location_id)
    )
  )
);

CREATE POLICY supplier_payable_payments_role_scope_select
ON supplier_payable_payments FOR SELECT
USING (
  tenant_id = get_current_user_tenant_id()
  AND (
    NOT is_user_cashier()
    OR EXISTS (
      SELECT 1
      FROM supplier_payables sp
      JOIN purchases p ON p.purchase_id = sp.purchase_id
      WHERE sp.payable_id = supplier_payable_payments.payable_id
        AND sp.tenant_id = supplier_payable_payments.tenant_id
        AND p.tenant_id = supplier_payable_payments.tenant_id
        AND fn_can_access_location(p.location_id)
    )
  )
);

CREATE POLICY supplier_payable_payments_role_scope_insert
ON supplier_payable_payments FOR INSERT
WITH CHECK (
  tenant_id = get_current_user_tenant_id()
  AND (
    NOT is_user_cashier()
    OR EXISTS (
      SELECT 1
      FROM supplier_payables sp
      JOIN purchases p ON p.purchase_id = sp.purchase_id
      WHERE sp.payable_id = supplier_payable_payments.payable_id
        AND sp.tenant_id = supplier_payable_payments.tenant_id
        AND p.tenant_id = supplier_payable_payments.tenant_id
        AND fn_can_access_location(p.location_id)
    )
  )
);

-- =====================================================
-- transfer_requests (in transit)
-- =====================================================
DROP POLICY IF EXISTS tenant_isolation_transfer_requests ON transfer_requests;
DROP POLICY IF EXISTS transfer_requests_role_scope_select ON transfer_requests;
DROP POLICY IF EXISTS transfer_requests_role_scope_insert ON transfer_requests;
DROP POLICY IF EXISTS transfer_requests_role_scope_update ON transfer_requests;

CREATE POLICY transfer_requests_role_scope_select
ON transfer_requests FOR SELECT
USING (
  tenant_id = get_current_user_tenant_id()
  AND (
    NOT is_user_cashier()
    OR fn_can_access_location(from_location_id)
    OR fn_can_access_location(to_location_id)
  )
);

CREATE POLICY transfer_requests_role_scope_insert
ON transfer_requests FOR INSERT
WITH CHECK (
  tenant_id = get_current_user_tenant_id()
  AND (
    NOT is_user_cashier()
    OR fn_can_access_location(from_location_id)
  )
);

CREATE POLICY transfer_requests_role_scope_update
ON transfer_requests FOR UPDATE
USING (
  tenant_id = get_current_user_tenant_id()
  AND (
    NOT is_user_cashier()
    OR fn_can_access_location(to_location_id)
  )
)
WITH CHECK (
  tenant_id = get_current_user_tenant_id()
  AND (
    NOT is_user_cashier()
    OR fn_can_access_location(to_location_id)
  )
);

NOTIFY pgrst, 'reload schema';
