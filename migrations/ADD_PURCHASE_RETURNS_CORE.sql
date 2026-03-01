-- ===================================================================
-- Core Compras v4: Devolucion a proveedor
-- ===================================================================

CREATE TABLE IF NOT EXISTS purchase_returns (
  purchase_return_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  purchase_id UUID NOT NULL REFERENCES purchases(purchase_id),
  location_id UUID REFERENCES locations(location_id),
  supplier_id UUID REFERENCES third_parties(third_party_id),
  note TEXT,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_return_lines (
  purchase_return_line_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_return_id UUID NOT NULL REFERENCES purchase_returns(purchase_return_id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  purchase_id UUID NOT NULL REFERENCES purchases(purchase_id),
  source_inventory_move_id UUID NOT NULL REFERENCES inventory_moves(inventory_move_id),
  variant_id UUID NOT NULL REFERENCES product_variants(variant_id),
  qty NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  unit_cost NUMERIC(14,2) NOT NULL CHECK (unit_cost >= 0),
  line_total NUMERIC(14,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_returns_tenant ON purchase_returns(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_purchase ON purchase_returns(tenant_id, purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_return_lines_tenant ON purchase_return_lines(tenant_id, purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_return_lines_source_move ON purchase_return_lines(source_inventory_move_id);

ALTER TABLE purchase_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_return_lines ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'purchase_returns'
      AND policyname = 'tenant_isolation_purchase_returns'
  ) THEN
    CREATE POLICY tenant_isolation_purchase_returns ON purchase_returns
      USING (tenant_id = get_current_user_tenant_id());
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'purchase_return_lines'
      AND policyname = 'tenant_isolation_purchase_return_lines'
  ) THEN
    CREATE POLICY tenant_isolation_purchase_return_lines ON purchase_return_lines
      USING (tenant_id = get_current_user_tenant_id());
  END IF;
END
$$;

GRANT SELECT, INSERT ON purchase_returns TO authenticated;
GRANT SELECT, INSERT ON purchase_return_lines TO authenticated;

CREATE OR REPLACE FUNCTION sp_create_purchase_return(
  p_tenant UUID,
  p_purchase_id UUID,
  p_created_by UUID,
  p_lines JSONB,
  p_note TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_purchase purchases%ROWTYPE;
  v_return_id UUID;
  v_total NUMERIC(14,2) := 0;
  v_line JSONB;
  v_source_line_id UUID;
  v_variant UUID;
  v_qty NUMERIC(14,3);
  v_unit_cost NUMERIC(14,2);
  v_purchased_qty NUMERIC(14,3);
  v_returned_qty NUMERIC(14,3);
  v_available_qty NUMERIC(14,3);
  v_stock NUMERIC(14,3);
  v_line_total NUMERIC(14,2);
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Purchase return must have at least one line';
  END IF;

  SELECT *
  INTO v_purchase
  FROM purchases p
  WHERE p.tenant_id = p_tenant
    AND p.purchase_id = p_purchase_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found';
  END IF;

  INSERT INTO purchase_returns (
    tenant_id,
    purchase_id,
    location_id,
    supplier_id,
    note,
    created_by
  ) VALUES (
    p_tenant,
    p_purchase_id,
    v_purchase.location_id,
    v_purchase.supplier_id,
    p_note,
    p_created_by
  )
  RETURNING purchase_return_id INTO v_return_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_source_line_id := (v_line->>'source_line_id')::UUID;
    v_variant := (v_line->>'variant_id')::UUID;
    v_qty := (v_line->>'qty')::NUMERIC;
    v_unit_cost := (v_line->>'unit_cost')::NUMERIC;

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid qty for line %', v_source_line_id;
    END IF;

    IF v_unit_cost IS NULL OR v_unit_cost < 0 THEN
      RAISE EXCEPTION 'Invalid unit_cost for line %', v_source_line_id;
    END IF;

    SELECT im.quantity
    INTO v_purchased_qty
    FROM inventory_moves im
    WHERE im.tenant_id = p_tenant
      AND im.inventory_move_id = v_source_line_id
      AND im.source_id = p_purchase_id
      AND im.move_type = 'PURCHASE_IN'
      AND im.variant_id = v_variant;

    IF v_purchased_qty IS NULL THEN
      RAISE EXCEPTION 'Source purchase line not found: %', v_source_line_id;
    END IF;

    SELECT COALESCE(SUM(prl.qty), 0)
    INTO v_returned_qty
    FROM purchase_return_lines prl
    WHERE prl.tenant_id = p_tenant
      AND prl.source_inventory_move_id = v_source_line_id;

    v_available_qty := v_purchased_qty - v_returned_qty;

    IF v_qty > v_available_qty THEN
      RAISE EXCEPTION 'Return qty exceeds available for line %. Available: %, requested: %',
        v_source_line_id, v_available_qty, v_qty;
    END IF;

    SELECT COALESCE(sb.on_hand, 0)
    INTO v_stock
    FROM stock_balances sb
    WHERE sb.tenant_id = p_tenant
      AND sb.location_id = v_purchase.location_id
      AND sb.variant_id = v_variant;

    IF v_stock < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock for return. Variant %, stock %, requested %', v_variant, v_stock, v_qty;
    END IF;

    v_line_total := ROUND(v_qty * v_unit_cost, 2);

    INSERT INTO purchase_return_lines (
      purchase_return_id,
      tenant_id,
      purchase_id,
      source_inventory_move_id,
      variant_id,
      qty,
      unit_cost,
      line_total
    ) VALUES (
      v_return_id,
      p_tenant,
      p_purchase_id,
      v_source_line_id,
      v_variant,
      v_qty,
      v_unit_cost,
      v_line_total
    );

    INSERT INTO inventory_moves (
      tenant_id,
      move_type,
      location_id,
      variant_id,
      quantity,
      unit_cost,
      source,
      source_id,
      note,
      created_at,
      created_by
    ) VALUES (
      p_tenant,
      'PURCHASE_RETURN_OUT',
      v_purchase.location_id,
      v_variant,
      v_qty,
      v_unit_cost,
      'PURCHASE_RETURN',
      v_return_id,
      COALESCE(p_note, 'Devolucion a proveedor'),
      NOW(),
      p_created_by
    );

    PERFORM fn_apply_stock_delta(
      p_tenant,
      v_purchase.location_id,
      v_variant,
      -v_qty
    );

    v_total := v_total + v_line_total;
  END LOOP;

  UPDATE purchase_returns
  SET total = v_total
  WHERE purchase_return_id = v_return_id;

  RETURN v_return_id;
END;
$$;

GRANT EXECUTE ON FUNCTION sp_create_purchase_return(UUID, UUID, UUID, JSONB, TEXT) TO authenticated;

-- IMPORTANTE: mantener una sola firma para evitar ambiguedad en PostgREST
DROP FUNCTION IF EXISTS sp_create_purchase_return(UUID, JSONB, TEXT, UUID, UUID);

-- Forzar recarga de schema cache de PostgREST
NOTIFY pgrst, 'reload schema';
