-- ===================================================================
-- Core Seguridad v2: Hardening RLS + alcance por rol/sede (sin cambios de menu_items)
-- ===================================================================

-- 1) Asegurar RLS habilitado en tablas core nuevas/sensibles
ALTER TABLE IF EXISTS purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS purchase_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS purchase_return_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS supplier_payables ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS supplier_payable_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS transfer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS sale_return_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS system_alerts ENABLE ROW LEVEL SECURITY;

-- 2) Helper para validar alertas con location_id embebido en JSON
--    Si no existe location_id, se permite por tenant.
CREATE OR REPLACE FUNCTION fn_alert_location_access(p_data JSONB)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    NOT is_user_cashier()
    OR NOT (p_data ? 'location_id')
    OR (
      (p_data->>'location_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND fn_can_access_location((p_data->>'location_id')::uuid)
    );
$$;

-- 3) sale_return_refunds: alinear con alcance de sale_returns (tenant + sede)
DROP POLICY IF EXISTS sale_return_refunds_tenant_select ON sale_return_refunds;
DROP POLICY IF EXISTS sale_return_refunds_tenant_insert ON sale_return_refunds;
DROP POLICY IF EXISTS sale_return_refunds_role_scope_select ON sale_return_refunds;
DROP POLICY IF EXISTS sale_return_refunds_role_scope_insert ON sale_return_refunds;

CREATE POLICY sale_return_refunds_role_scope_select
ON sale_return_refunds FOR SELECT
USING (
  tenant_id = get_current_user_tenant_id()
  AND (
    NOT is_user_cashier()
    OR EXISTS (
      SELECT 1
      FROM sale_returns sr
      WHERE sr.return_id = sale_return_refunds.return_id
        AND sr.tenant_id = sale_return_refunds.tenant_id
        AND fn_can_access_location(sr.location_id)
    )
  )
);

CREATE POLICY sale_return_refunds_role_scope_insert
ON sale_return_refunds FOR INSERT
WITH CHECK (
  tenant_id = get_current_user_tenant_id()
  AND (
    NOT is_user_cashier()
    OR EXISTS (
      SELECT 1
      FROM sale_returns sr
      WHERE sr.return_id = sale_return_refunds.return_id
        AND sr.tenant_id = sale_return_refunds.tenant_id
        AND fn_can_access_location(sr.location_id)
    )
  )
);

-- 4) system_alerts: reforzar tenant + restricción por sede para cajeros cuando aplique
DROP POLICY IF EXISTS system_alerts_select ON system_alerts;
DROP POLICY IF EXISTS system_alerts_insert ON system_alerts;
DROP POLICY IF EXISTS system_alerts_update ON system_alerts;
DROP POLICY IF EXISTS system_alerts_delete ON system_alerts;
DROP POLICY IF EXISTS system_alerts_role_scope_select ON system_alerts;
DROP POLICY IF EXISTS system_alerts_role_scope_insert ON system_alerts;
DROP POLICY IF EXISTS system_alerts_role_scope_update ON system_alerts;
DROP POLICY IF EXISTS system_alerts_role_scope_delete ON system_alerts;

CREATE POLICY system_alerts_role_scope_select
ON system_alerts FOR SELECT
USING (
  tenant_id = get_current_user_tenant_id()
  AND fn_alert_location_access(data)
);

CREATE POLICY system_alerts_role_scope_insert
ON system_alerts FOR INSERT
WITH CHECK (
  tenant_id = get_current_user_tenant_id()
  AND fn_alert_location_access(data)
);

CREATE POLICY system_alerts_role_scope_update
ON system_alerts FOR UPDATE
USING (
  tenant_id = get_current_user_tenant_id()
  AND fn_alert_location_access(data)
)
WITH CHECK (
  tenant_id = get_current_user_tenant_id()
  AND fn_alert_location_access(data)
);

CREATE POLICY system_alerts_role_scope_delete
ON system_alerts FOR DELETE
USING (
  tenant_id = get_current_user_tenant_id()
  AND fn_alert_location_access(data)
);

NOTIFY pgrst, 'reload schema';
