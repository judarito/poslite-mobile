-- ===================================================================
-- Core Compras v3: Recepcion parcial de ordenes de compra
-- ===================================================================

ALTER TABLE purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_status_check;

ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('DRAFT', 'PARTIAL', 'RECEIVED', 'CANCELLED'));

ALTER TABLE purchase_order_lines
  ADD COLUMN IF NOT EXISTS qty_received NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (qty_received >= 0);

CREATE OR REPLACE FUNCTION sp_receive_purchase_order_partial(
  p_tenant UUID,
  p_purchase_order_id UUID,
  p_created_by UUID,
  p_lines JSONB,
  p_note TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_po purchase_orders%ROWTYPE;
  v_line JSONB;
  v_po_line_id UUID;
  v_qty_to_receive NUMERIC(14,3);
  v_new_received NUMERIC(14,3);
  v_note TEXT;
  v_lines_for_purchase JSONB := '[]'::JSONB;
  v_purchase_id UUID;
  v_has_pending BOOLEAN := false;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Receive lines are required';
  END IF;

  SELECT *
  INTO v_po
  FROM purchase_orders po
  WHERE po.tenant_id = p_tenant
    AND po.purchase_order_id = p_purchase_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order not found';
  END IF;

  IF v_po.status NOT IN ('DRAFT', 'PARTIAL') THEN
    RAISE EXCEPTION 'Purchase order status must be DRAFT/PARTIAL. Current: %', v_po.status;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_po_line_id := (v_line->>'purchase_order_line_id')::UUID;
    v_qty_to_receive := (v_line->>'qty_to_receive')::NUMERIC;

    IF v_qty_to_receive IS NULL OR v_qty_to_receive <= 0 THEN
      RAISE EXCEPTION 'Invalid qty_to_receive for line %', v_po_line_id;
    END IF;

    UPDATE purchase_order_lines pol
    SET qty_received = pol.qty_received + v_qty_to_receive
    WHERE pol.purchase_order_line_id = v_po_line_id
      AND pol.purchase_order_id = p_purchase_order_id
      AND pol.tenant_id = p_tenant
      AND (pol.qty_received + v_qty_to_receive) <= pol.qty_ordered
    RETURNING pol.qty_received INTO v_new_received;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Line not found or qty exceeds remaining: %', v_po_line_id;
    END IF;

    v_lines_for_purchase := v_lines_for_purchase || jsonb_build_array(
      jsonb_build_object(
        'variant_id', v_line->>'variant_id',
        'qty', v_qty_to_receive,
        'unit_cost', (v_line->>'unit_cost')::NUMERIC,
        'batch_number', NULLIF(v_line->>'batch_number', ''),
        'expiration_date', NULLIF(v_line->>'expiration_date', ''),
        'physical_location', NULLIF(v_line->>'physical_location', '')
      )
    );
  END LOOP;

  IF jsonb_array_length(v_lines_for_purchase) = 0 THEN
    RAISE EXCEPTION 'No valid lines to receive';
  END IF;

  v_note := COALESCE(p_note, v_po.note);

  v_purchase_id := sp_create_purchase(
    p_tenant,
    v_po.location_id,
    v_po.supplier_id,
    p_created_by,
    v_lines_for_purchase,
    v_note
  );

  SELECT EXISTS (
    SELECT 1
    FROM purchase_order_lines pol
    WHERE pol.purchase_order_id = p_purchase_order_id
      AND pol.tenant_id = p_tenant
      AND pol.qty_received < pol.qty_ordered
  ) INTO v_has_pending;

  UPDATE purchase_orders
  SET status = CASE WHEN v_has_pending THEN 'PARTIAL' ELSE 'RECEIVED' END,
      received_purchase_id = CASE WHEN v_has_pending THEN received_purchase_id ELSE v_purchase_id END,
      received_at = CASE WHEN v_has_pending THEN received_at ELSE NOW() END,
      updated_at = NOW()
  WHERE purchase_order_id = p_purchase_order_id;

  RETURN v_purchase_id;
END;
$$;

GRANT EXECUTE ON FUNCTION sp_receive_purchase_order_partial(UUID, UUID, UUID, JSONB, TEXT) TO authenticated;

-- Mantener compatibilidad con recepcion total: recibe saldo completo
CREATE OR REPLACE FUNCTION sp_receive_purchase_order(
  p_tenant UUID,
  p_purchase_order_id UUID,
  p_created_by UUID,
  p_note TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_lines JSONB;
BEGIN
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'purchase_order_line_id', pol.purchase_order_line_id,
        'variant_id', pol.variant_id,
        'qty_to_receive', (pol.qty_ordered - pol.qty_received),
        'unit_cost', pol.unit_cost,
        'batch_number', pol.batch_number,
        'expiration_date', pol.expiration_date,
        'physical_location', pol.physical_location
      )
    ) FILTER (WHERE (pol.qty_ordered - pol.qty_received) > 0),
    '[]'::jsonb
  )
  INTO v_lines
  FROM purchase_order_lines pol
  WHERE pol.purchase_order_id = p_purchase_order_id
    AND pol.tenant_id = p_tenant;

  IF jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'Purchase order has no pending lines to receive';
  END IF;

  RETURN sp_receive_purchase_order_partial(
    p_tenant,
    p_purchase_order_id,
    p_created_by,
    v_lines,
    p_note
  );
END;
$$;
