-- ===================================================================
-- Core Compras v5: Cuentas por pagar a proveedores (AP)
-- ===================================================================

CREATE TABLE IF NOT EXISTS supplier_payables (
  payable_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  supplier_id UUID NOT NULL REFERENCES third_parties(third_party_id),
  purchase_id UUID NOT NULL REFERENCES purchases(purchase_id),
  invoice_number TEXT,
  due_date DATE,
  total_amount NUMERIC(14,2) NOT NULL CHECK (total_amount >= 0),
  paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  balance NUMERIC(14,2) NOT NULL CHECK (balance >= 0),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PARTIAL', 'PAID', 'CANCELLED')),
  note TEXT,
  created_by UUID REFERENCES users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, purchase_id)
);

CREATE TABLE IF NOT EXISTS supplier_payable_payments (
  payable_payment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  payable_id UUID NOT NULL REFERENCES supplier_payables(payable_id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_method TEXT,
  note TEXT,
  created_by UUID REFERENCES users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_payables_tenant ON supplier_payables(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_payables_supplier ON supplier_payables(tenant_id, supplier_id, status);
CREATE INDEX IF NOT EXISTS idx_supplier_payables_purchase ON supplier_payables(tenant_id, purchase_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_tenant ON supplier_payable_payments(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_payable ON supplier_payable_payments(payable_id);

ALTER TABLE supplier_payables ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payable_payments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'supplier_payables'
      AND policyname = 'tenant_isolation_supplier_payables'
  ) THEN
    CREATE POLICY tenant_isolation_supplier_payables ON supplier_payables
      USING (tenant_id = get_current_user_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'supplier_payable_payments'
      AND policyname = 'tenant_isolation_supplier_payments'
  ) THEN
    CREATE POLICY tenant_isolation_supplier_payments ON supplier_payable_payments
      USING (tenant_id = get_current_user_tenant_id());
  END IF;
END
$$;

GRANT SELECT, INSERT, UPDATE ON supplier_payables TO authenticated;
GRANT SELECT, INSERT ON supplier_payable_payments TO authenticated;

CREATE OR REPLACE FUNCTION sp_create_supplier_payable(
  p_tenant UUID,
  p_purchase_id UUID,
  p_created_by UUID,
  p_due_date DATE DEFAULT NULL,
  p_invoice_number TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_purchase purchases%ROWTYPE;
  v_payable_id UUID;
BEGIN
  SELECT *
  INTO v_purchase
  FROM purchases p
  WHERE p.tenant_id = p_tenant
    AND p.purchase_id = p_purchase_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found';
  END IF;

  IF v_purchase.supplier_id IS NULL THEN
    RAISE EXCEPTION 'Purchase has no supplier';
  END IF;

  SELECT payable_id
  INTO v_payable_id
  FROM supplier_payables sp
  WHERE sp.tenant_id = p_tenant
    AND sp.purchase_id = p_purchase_id;

  IF v_payable_id IS NOT NULL THEN
    UPDATE supplier_payables
    SET due_date = COALESCE(p_due_date, due_date),
        invoice_number = COALESCE(p_invoice_number, invoice_number),
        note = COALESCE(p_note, note),
        updated_at = NOW()
    WHERE payable_id = v_payable_id;

    RETURN v_payable_id;
  END IF;

  INSERT INTO supplier_payables (
    tenant_id,
    supplier_id,
    purchase_id,
    due_date,
    invoice_number,
    total_amount,
    paid_amount,
    balance,
    status,
    note,
    created_by
  ) VALUES (
    p_tenant,
    v_purchase.supplier_id,
    p_purchase_id,
    p_due_date,
    p_invoice_number,
    COALESCE(v_purchase.total, 0),
    0,
    COALESCE(v_purchase.total, 0),
    CASE WHEN COALESCE(v_purchase.total, 0) > 0 THEN 'OPEN' ELSE 'PAID' END,
    p_note,
    p_created_by
  )
  RETURNING payable_id INTO v_payable_id;

  RETURN v_payable_id;
END;
$$;

CREATE OR REPLACE FUNCTION sp_register_supplier_payment(
  p_tenant UUID,
  p_payable_id UUID,
  p_amount NUMERIC,
  p_created_by UUID,
  p_payment_method TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_payable supplier_payables%ROWTYPE;
  v_payment_id UUID;
  v_new_paid NUMERIC(14,2);
  v_new_balance NUMERIC(14,2);
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than 0';
  END IF;

  SELECT *
  INTO v_payable
  FROM supplier_payables sp
  WHERE sp.tenant_id = p_tenant
    AND sp.payable_id = p_payable_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payable not found';
  END IF;

  IF v_payable.status IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'Payable status does not allow payments: %', v_payable.status;
  END IF;

  IF p_amount > v_payable.balance THEN
    RAISE EXCEPTION 'Payment exceeds balance. Balance: %, payment: %', v_payable.balance, p_amount;
  END IF;

  INSERT INTO supplier_payable_payments (
    tenant_id,
    payable_id,
    amount,
    payment_method,
    note,
    created_by
  ) VALUES (
    p_tenant,
    p_payable_id,
    ROUND(p_amount, 2),
    p_payment_method,
    p_note,
    p_created_by
  )
  RETURNING payable_payment_id INTO v_payment_id;

  v_new_paid := ROUND(v_payable.paid_amount + p_amount, 2);
  v_new_balance := ROUND(v_payable.total_amount - v_new_paid, 2);

  UPDATE supplier_payables
  SET paid_amount = v_new_paid,
      balance = GREATEST(v_new_balance, 0),
      status = CASE
        WHEN GREATEST(v_new_balance, 0) = 0 THEN 'PAID'
        WHEN v_new_paid > 0 THEN 'PARTIAL'
        ELSE 'OPEN'
      END,
      updated_at = NOW()
  WHERE payable_id = p_payable_id;

  RETURN v_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION sp_create_supplier_payable(UUID, UUID, UUID, DATE, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION sp_register_supplier_payment(UUID, UUID, NUMERIC, UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
