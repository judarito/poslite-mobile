-- ===================================================================
-- Core Compras v2: Ordenes de compra (borrador) y recepcion posterior
-- ===================================================================

CREATE TABLE IF NOT EXISTS purchase_orders (
  purchase_order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  location_id UUID REFERENCES locations(location_id),
  supplier_id UUID REFERENCES third_parties(third_party_id),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'RECEIVED', 'CANCELLED')),
  note TEXT,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  received_purchase_id UUID REFERENCES purchases(purchase_id),
  received_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  purchase_order_line_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(purchase_order_id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  variant_id UUID NOT NULL REFERENCES product_variants(variant_id),
  qty_ordered NUMERIC(14,3) NOT NULL CHECK (qty_ordered > 0),
  unit_cost NUMERIC(14,2) NOT NULL CHECK (unit_cost >= 0),
  batch_number TEXT,
  expiration_date DATE,
  physical_location TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_tenant ON purchase_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_order ON purchase_order_lines(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_tenant ON purchase_order_lines(tenant_id);

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_lines ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'purchase_orders'
      AND policyname = 'tenant_isolation_purchase_orders'
  ) THEN
    CREATE POLICY tenant_isolation_purchase_orders ON purchase_orders
      USING (tenant_id = get_current_user_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'purchase_order_lines'
      AND policyname = 'tenant_isolation_purchase_order_lines'
  ) THEN
    CREATE POLICY tenant_isolation_purchase_order_lines ON purchase_order_lines
      USING (tenant_id = get_current_user_tenant_id());
  END IF;
END
$$;

GRANT SELECT, INSERT, UPDATE ON purchase_orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON purchase_order_lines TO authenticated;

CREATE OR REPLACE FUNCTION sp_create_purchase_order(
  p_tenant UUID,
  p_location UUID,
  p_supplier_id UUID,
  p_created_by UUID,
  p_lines JSONB,
  p_note TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_po_id UUID;
  v_line JSONB;
  v_variant UUID;
  v_qty NUMERIC(14,3);
  v_unit_cost NUMERIC(14,2);
  v_total NUMERIC(14,2) := 0;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Purchase order must have at least one line';
  END IF;

  INSERT INTO purchase_orders (tenant_id, location_id, supplier_id, note, created_by)
  VALUES (p_tenant, p_location, p_supplier_id, p_note, p_created_by)
  RETURNING purchase_order_id INTO v_po_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_variant := (v_line->>'variant_id')::UUID;
    v_qty := (v_line->>'qty')::NUMERIC;
    v_unit_cost := (v_line->>'unit_cost')::NUMERIC;

    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid qty for variant %', v_variant;
    END IF;
    IF v_unit_cost < 0 THEN
      RAISE EXCEPTION 'Invalid unit_cost for variant %', v_variant;
    END IF;

    PERFORM 1
    FROM product_variants pv
    WHERE pv.tenant_id = p_tenant
      AND pv.variant_id = v_variant
      AND pv.is_active = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variant not found/active: %', v_variant;
    END IF;

    INSERT INTO purchase_order_lines (
      purchase_order_id,
      tenant_id,
      variant_id,
      qty_ordered,
      unit_cost,
      batch_number,
      expiration_date,
      physical_location
    ) VALUES (
      v_po_id,
      p_tenant,
      v_variant,
      v_qty,
      v_unit_cost,
      NULLIF(v_line->>'batch_number', ''),
      CASE
        WHEN NULLIF(v_line->>'expiration_date', '') IS NULL THEN NULL
        ELSE (v_line->>'expiration_date')::DATE
      END,
      NULLIF(v_line->>'physical_location', '')
    );

    v_total := v_total + ROUND(v_qty * v_unit_cost, 2);
  END LOOP;

  UPDATE purchase_orders
  SET total = v_total,
      updated_at = NOW()
  WHERE purchase_order_id = v_po_id;

  RETURN v_po_id;
END;
$$;

CREATE OR REPLACE FUNCTION sp_receive_purchase_order(
  p_tenant UUID,
  p_purchase_order_id UUID,
  p_created_by UUID,
  p_note TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_po purchase_orders%ROWTYPE;
  v_lines JSONB;
  v_purchase_id UUID;
  v_note TEXT;
BEGIN
  SELECT *
  INTO v_po
  FROM purchase_orders po
  WHERE po.tenant_id = p_tenant
    AND po.purchase_order_id = p_purchase_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order not found';
  END IF;

  IF v_po.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Purchase order status must be DRAFT. Current: %', v_po.status;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'variant_id', pol.variant_id,
        'qty', pol.qty_ordered,
        'unit_cost', pol.unit_cost,
        'batch_number', pol.batch_number,
        'expiration_date', pol.expiration_date,
        'physical_location', pol.physical_location
      )
    ),
    '[]'::jsonb
  )
  INTO v_lines
  FROM purchase_order_lines pol
  WHERE pol.purchase_order_id = p_purchase_order_id
    AND pol.tenant_id = p_tenant;

  IF jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'Purchase order has no lines';
  END IF;

  v_note := COALESCE(p_note, v_po.note);

  v_purchase_id := sp_create_purchase(
    p_tenant,
    v_po.location_id,
    v_po.supplier_id,
    p_created_by,
    v_lines,
    v_note
  );

  UPDATE purchase_orders
  SET status = 'RECEIVED',
      received_purchase_id = v_purchase_id,
      received_at = NOW(),
      updated_at = NOW()
  WHERE purchase_order_id = p_purchase_order_id;

  RETURN v_purchase_id;
END;
$$;

GRANT EXECUTE ON FUNCTION sp_create_purchase_order(UUID, UUID, UUID, UUID, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION sp_receive_purchase_order(UUID, UUID, UUID, TEXT) TO authenticated;
