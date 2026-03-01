-- ===================================================================
-- Core Ventas v2: Devoluciones robustas con reembolso por metodos de pago
-- ===================================================================

CREATE TABLE IF NOT EXISTS sale_return_refunds (
  refund_payment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  return_id UUID NOT NULL REFERENCES sale_returns(return_id) ON DELETE CASCADE,
  payment_method_id UUID NOT NULL REFERENCES payment_methods(payment_method_id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  reference TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(user_id)
);

CREATE INDEX IF NOT EXISTS idx_sale_return_refunds_tenant
  ON sale_return_refunds(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sale_return_refunds_return
  ON sale_return_refunds(return_id);

ALTER TABLE sale_return_refunds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sale_return_refunds_tenant_select ON sale_return_refunds;
DROP POLICY IF EXISTS sale_return_refunds_tenant_insert ON sale_return_refunds;

CREATE POLICY sale_return_refunds_tenant_select
ON sale_return_refunds FOR SELECT
USING (
  tenant_id = get_current_user_tenant_id()
  AND EXISTS (
    SELECT 1
    FROM sale_returns sr
    WHERE sr.return_id = sale_return_refunds.return_id
      AND sr.tenant_id = sale_return_refunds.tenant_id
  )
);

CREATE POLICY sale_return_refunds_tenant_insert
ON sale_return_refunds FOR INSERT
WITH CHECK (
  tenant_id = get_current_user_tenant_id()
  AND EXISTS (
    SELECT 1
    FROM sale_returns sr
    WHERE sr.return_id = sale_return_refunds.return_id
      AND sr.tenant_id = sale_return_refunds.tenant_id
  )
);

GRANT SELECT, INSERT ON sale_return_refunds TO authenticated;

CREATE OR REPLACE FUNCTION sp_create_return_v2(
  p_tenant UUID,
  p_sale_id UUID,
  p_created_by UUID,
  p_lines JSONB,
  p_refunds JSONB,
  p_reason TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_return_id UUID;
  v_refund_total NUMERIC(14,2);
  v_paid_total NUMERIC(14,2) := 0;
  v_refund JSONB;
  v_payment_method_id UUID;
  v_amount NUMERIC(14,2);
  v_reference TEXT;
  v_note TEXT;
BEGIN
  IF p_refunds IS NULL OR jsonb_typeof(p_refunds) <> 'array' OR jsonb_array_length(p_refunds) = 0 THEN
    RAISE EXCEPTION 'Return refunds are required';
  END IF;

  v_return_id := sp_create_return(
    p_tenant,
    p_sale_id,
    p_created_by,
    p_lines,
    p_reason
  );

  SELECT sr.refund_total
  INTO v_refund_total
  FROM sale_returns sr
  WHERE sr.tenant_id = p_tenant
    AND sr.return_id = v_return_id;

  IF v_refund_total IS NULL THEN
    RAISE EXCEPTION 'Return not found after creation';
  END IF;

  FOR v_refund IN SELECT * FROM jsonb_array_elements(p_refunds)
  LOOP
    v_payment_method_id := (v_refund->>'payment_method_id')::UUID;
    v_amount := ROUND((v_refund->>'amount')::NUMERIC, 2);
    v_reference := NULLIF(v_refund->>'reference', '');
    v_note := NULLIF(v_refund->>'note', '');

    IF v_payment_method_id IS NULL THEN
      RAISE EXCEPTION 'payment_method_id is required in refunds';
    END IF;

    IF v_amount IS NULL OR v_amount <= 0 THEN
      RAISE EXCEPTION 'Refund amount must be greater than 0';
    END IF;

    PERFORM 1
    FROM payment_methods pm
    WHERE pm.tenant_id = p_tenant
      AND pm.payment_method_id = v_payment_method_id
      AND pm.is_active = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Payment method not found/active: %', v_payment_method_id;
    END IF;

    INSERT INTO sale_return_refunds (
      tenant_id,
      return_id,
      payment_method_id,
      amount,
      reference,
      note,
      created_by
    ) VALUES (
      p_tenant,
      v_return_id,
      v_payment_method_id,
      v_amount,
      v_reference,
      v_note,
      p_created_by
    );

    v_paid_total := v_paid_total + v_amount;
  END LOOP;

  IF ROUND(v_paid_total, 2) <> ROUND(v_refund_total, 2) THEN
    RAISE EXCEPTION 'Refund payment total (%) must equal return total (%)', v_paid_total, v_refund_total;
  END IF;

  RETURN v_return_id;
END;
$$;

GRANT EXECUTE ON FUNCTION sp_create_return_v2(UUID, UUID, UUID, JSONB, JSONB, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
