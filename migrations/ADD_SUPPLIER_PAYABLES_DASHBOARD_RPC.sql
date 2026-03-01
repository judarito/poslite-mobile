-- ===================================================================
-- Core Compras v6: Bandeja global de CxP proveedores (dashboard)
-- ===================================================================

CREATE OR REPLACE FUNCTION sp_get_supplier_payables_dashboard(
  p_tenant UUID,
  p_status TEXT DEFAULT 'OPEN_PARTIAL',
  p_due_in_days INTEGER DEFAULT NULL
)
RETURNS TABLE (
  payable_id UUID,
  purchase_id UUID,
  supplier_id UUID,
  supplier_name TEXT,
  invoice_number TEXT,
  due_date DATE,
  total_amount NUMERIC(14,2),
  paid_amount NUMERIC(14,2),
  balance NUMERIC(14,2),
  status TEXT,
  location_id UUID,
  location_name TEXT,
  created_at TIMESTAMPTZ,
  days_to_due INTEGER,
  is_overdue BOOLEAN
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    sp.payable_id,
    sp.purchase_id,
    sp.supplier_id,
    COALESCE(tp.trade_name, tp.legal_name, 'Proveedor') AS supplier_name,
    sp.invoice_number,
    sp.due_date,
    sp.total_amount,
    sp.paid_amount,
    sp.balance,
    sp.status,
    p.location_id,
    l.name AS location_name,
    sp.created_at,
    CASE
      WHEN sp.due_date IS NULL THEN NULL
      ELSE (sp.due_date - CURRENT_DATE)::INTEGER
    END AS days_to_due,
    CASE
      WHEN sp.due_date IS NULL THEN FALSE
      ELSE sp.due_date < CURRENT_DATE
    END AS is_overdue
  FROM supplier_payables sp
  JOIN purchases p ON p.purchase_id = sp.purchase_id
  LEFT JOIN locations l ON l.location_id = p.location_id
  LEFT JOIN third_parties tp ON tp.third_party_id = sp.supplier_id
  WHERE sp.tenant_id = p_tenant
    AND p.tenant_id = p_tenant
    AND (
      p_status = 'ALL'
      OR (p_status = 'OPEN_PARTIAL' AND sp.status IN ('OPEN', 'PARTIAL'))
      OR sp.status = p_status
    )
    AND (
      p_due_in_days IS NULL
      OR (
        sp.due_date IS NOT NULL
        AND sp.due_date <= (CURRENT_DATE + p_due_in_days)
      )
    )
  ORDER BY
    CASE WHEN sp.due_date IS NULL THEN 1 ELSE 0 END,
    sp.due_date ASC,
    sp.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION sp_get_supplier_payables_dashboard(UUID, TEXT, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';
