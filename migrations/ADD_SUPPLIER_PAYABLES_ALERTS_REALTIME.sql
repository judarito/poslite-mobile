-- ===================================================================
-- Alertas realtime v1: Cuentas por pagar de proveedores en system_alerts
-- ===================================================================

DO $$
BEGIN
  ALTER TABLE system_alerts
    DROP CONSTRAINT IF EXISTS system_alerts_alert_type_check;

  ALTER TABLE system_alerts
    ADD CONSTRAINT system_alerts_alert_type_check
    CHECK (alert_type IN ('STOCK', 'LAYAWAY', 'EXPIRATION', 'PAYABLE'));
END
$$;

CREATE OR REPLACE FUNCTION fn_refresh_supplier_payable_alerts()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM system_alerts sa
  WHERE sa.alert_type = 'PAYABLE'
    AND NOT EXISTS (
      SELECT 1
      FROM supplier_payables sp
      WHERE sp.payable_id = sa.reference_id
        AND sp.tenant_id = sa.tenant_id
        AND sp.status IN ('OPEN', 'PARTIAL')
        AND sp.balance > 0
        AND sp.due_date IS NOT NULL
        AND sp.due_date <= (CURRENT_DATE + 7)
    );

  INSERT INTO system_alerts (tenant_id, alert_type, alert_level, reference_id, data)
  SELECT
    sp.tenant_id,
    'PAYABLE' AS alert_type,
    CASE
      WHEN sp.due_date < CURRENT_DATE THEN 'OVERDUE'
      ELSE 'DUE_SOON'
    END AS alert_level,
    sp.payable_id AS reference_id,
    jsonb_build_object(
      'payable_id', sp.payable_id,
      'purchase_id', sp.purchase_id,
      'supplier_id', sp.supplier_id,
      'supplier_name', COALESCE(tp.trade_name, tp.legal_name, 'Proveedor'),
      'invoice_number', sp.invoice_number,
      'due_date', sp.due_date,
      'days_to_due', (sp.due_date - CURRENT_DATE)::INTEGER,
      'total_amount', sp.total_amount,
      'paid_amount', sp.paid_amount,
      'balance', sp.balance,
      'status', sp.status,
      'location_id', p.location_id,
      'location_name', l.name
    ) AS data
  FROM supplier_payables sp
  JOIN purchases p ON p.purchase_id = sp.purchase_id
  LEFT JOIN locations l ON l.location_id = p.location_id
  LEFT JOIN third_parties tp ON tp.third_party_id = sp.supplier_id
  WHERE sp.status IN ('OPEN', 'PARTIAL')
    AND sp.balance > 0
    AND sp.due_date IS NOT NULL
    AND sp.due_date <= (CURRENT_DATE + 7)
  ON CONFLICT (tenant_id, alert_type, reference_id)
  DO UPDATE SET
    alert_level = EXCLUDED.alert_level,
    data = EXCLUDED.data,
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION trg_refresh_supplier_payable_alerts()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM fn_refresh_supplier_payable_alerts();
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_supplier_payables_refresh_alerts ON supplier_payables;
CREATE TRIGGER trg_supplier_payables_refresh_alerts
  AFTER INSERT OR UPDATE OF due_date, balance, status, updated_at
  ON supplier_payables
  FOR EACH STATEMENT
  EXECUTE FUNCTION trg_refresh_supplier_payable_alerts();

DROP TRIGGER IF EXISTS trg_supplier_payables_refresh_alerts_delete ON supplier_payables;
CREATE TRIGGER trg_supplier_payables_refresh_alerts_delete
  AFTER DELETE
  ON supplier_payables
  FOR EACH STATEMENT
  EXECUTE FUNCTION trg_refresh_supplier_payable_alerts();

CREATE INDEX IF NOT EXISTS ix_system_alerts_payable
  ON system_alerts(tenant_id, alert_type, alert_level, created_at DESC)
  WHERE alert_type = 'PAYABLE';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'system_alerts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE system_alerts;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION fn_refresh_all_alerts()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM fn_refresh_stock_alerts();
  PERFORM fn_refresh_layaway_alerts();
  PERFORM fn_refresh_expiration_alerts();
  PERFORM fn_refresh_supplier_payable_alerts();
END;
$$;

SELECT fn_refresh_supplier_payable_alerts();

NOTIFY pgrst, 'reload schema';
