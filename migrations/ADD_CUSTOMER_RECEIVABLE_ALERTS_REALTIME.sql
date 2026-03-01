-- ===================================================================
-- Alertas realtime v2: Cartera / CxC en system_alerts
-- ===================================================================

DO $$
BEGIN
  ALTER TABLE system_alerts
    DROP CONSTRAINT IF EXISTS system_alerts_alert_type_check;

  ALTER TABLE system_alerts
    ADD CONSTRAINT system_alerts_alert_type_check
    CHECK (alert_type IN ('STOCK', 'LAYAWAY', 'EXPIRATION', 'PAYABLE', 'RECEIVABLE'));
END
$$;

CREATE OR REPLACE FUNCTION fn_refresh_customer_receivable_alerts(
  p_tenant UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM system_alerts sa
  WHERE sa.alert_type = 'RECEIVABLE'
    AND (p_tenant IS NULL OR sa.tenant_id = p_tenant)
    AND NOT EXISTS (
      SELECT 1
      FROM customer_credit_accounts cca
      WHERE cca.credit_account_id = sa.reference_id
        AND cca.tenant_id = sa.tenant_id
        AND cca.is_active = TRUE
        AND cca.current_balance > 0
    );

  INSERT INTO system_alerts (tenant_id, alert_type, alert_level, reference_id, data)
  SELECT
    cca.tenant_id,
    'RECEIVABLE' AS alert_type,
    CASE
      WHEN cca.current_balance > cca.credit_limit THEN 'OVER_LIMIT'
      ELSE 'WITH_DEBT'
    END AS alert_level,
    cca.credit_account_id AS reference_id,
    jsonb_build_object(
      'credit_account_id', cca.credit_account_id,
      'customer_id', cca.customer_id,
      'customer_name', COALESCE(c.full_name, 'Cliente'),
      'customer_document', c.document,
      'credit_limit', cca.credit_limit,
      'current_balance', cca.current_balance,
      'available_credit', GREATEST(0, cca.credit_limit - cca.current_balance),
      'over_limit_amount', GREATEST(0, cca.current_balance - cca.credit_limit)
    ) AS data
  FROM customer_credit_accounts cca
  LEFT JOIN customers c ON c.customer_id = cca.customer_id
  WHERE cca.is_active = TRUE
    AND cca.current_balance > 0
    AND (p_tenant IS NULL OR cca.tenant_id = p_tenant)
  ON CONFLICT (tenant_id, alert_type, reference_id)
  DO UPDATE SET
    alert_level = EXCLUDED.alert_level,
    data = EXCLUDED.data,
    updated_at = NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION fn_refresh_customer_receivable_alerts(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION trg_refresh_customer_receivable_alerts()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant UUID;
BEGIN
  v_tenant := COALESCE(NEW.tenant_id, OLD.tenant_id);
  PERFORM fn_refresh_customer_receivable_alerts(v_tenant);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_credit_accounts_refresh_alerts ON customer_credit_accounts;
CREATE TRIGGER trg_customer_credit_accounts_refresh_alerts
  AFTER INSERT OR UPDATE OF current_balance, credit_limit, is_active
  ON customer_credit_accounts
  FOR EACH ROW
  EXECUTE FUNCTION trg_refresh_customer_receivable_alerts();

DROP TRIGGER IF EXISTS trg_customer_credit_accounts_refresh_alerts_delete ON customer_credit_accounts;
CREATE TRIGGER trg_customer_credit_accounts_refresh_alerts_delete
  AFTER DELETE
  ON customer_credit_accounts
  FOR EACH ROW
  EXECUTE FUNCTION trg_refresh_customer_receivable_alerts();

CREATE INDEX IF NOT EXISTS ix_system_alerts_receivable
  ON system_alerts(tenant_id, alert_type, alert_level, created_at DESC)
  WHERE alert_type = 'RECEIVABLE';

CREATE OR REPLACE FUNCTION fn_refresh_all_alerts()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    PERFORM fn_refresh_stock_alerts();
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'fn_refresh_stock_alerts failed: %', SQLERRM;
  END;

  BEGIN
    PERFORM fn_refresh_layaway_alerts();
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'fn_refresh_layaway_alerts failed: %', SQLERRM;
  END;

  BEGIN
    PERFORM fn_refresh_expiration_alerts();
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'fn_refresh_expiration_alerts failed: %', SQLERRM;
  END;

  BEGIN
    PERFORM fn_refresh_supplier_payable_alerts();
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'fn_refresh_supplier_payable_alerts failed: %', SQLERRM;
  END;

  BEGIN
    PERFORM fn_refresh_customer_receivable_alerts();
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'fn_refresh_customer_receivable_alerts failed: %', SQLERRM;
  END;
END;
$$;

SELECT fn_refresh_customer_receivable_alerts();

NOTIFY pgrst, 'reload schema';
