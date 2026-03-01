-- ===================================================================
-- Core Inventario v1: Traslados en transito con recepcion en destino
-- ===================================================================

CREATE TABLE IF NOT EXISTS transfer_requests (
  transfer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id),
  from_location_id UUID NOT NULL REFERENCES locations(location_id),
  to_location_id UUID NOT NULL REFERENCES locations(location_id),
  variant_id UUID NOT NULL REFERENCES product_variants(variant_id),
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  status TEXT NOT NULL DEFAULT 'IN_TRANSIT' CHECK (status IN ('IN_TRANSIT', 'RECEIVED', 'CANCELLED')),
  note TEXT,
  created_by UUID REFERENCES users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_by UUID REFERENCES users(user_id),
  received_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_transfer_requests_tenant ON transfer_requests(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfer_requests_status ON transfer_requests(tenant_id, status, to_location_id);
CREATE INDEX IF NOT EXISTS idx_transfer_requests_variant ON transfer_requests(tenant_id, variant_id, status);

ALTER TABLE transfer_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'transfer_requests'
      AND policyname = 'tenant_isolation_transfer_requests'
  ) THEN
    CREATE POLICY tenant_isolation_transfer_requests ON transfer_requests
      USING (tenant_id = get_current_user_tenant_id());
  END IF;
END
$$;

GRANT SELECT, INSERT, UPDATE ON transfer_requests TO authenticated;

CREATE OR REPLACE FUNCTION sp_create_transfer_request(
  p_tenant UUID,
  p_from_location UUID,
  p_to_location UUID,
  p_variant UUID,
  p_quantity NUMERIC,
  p_unit_cost NUMERIC,
  p_created_by UUID,
  p_note TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_transfer_id UUID;
  v_stock NUMERIC(14,3);
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than 0';
  END IF;

  IF p_from_location = p_to_location THEN
    RAISE EXCEPTION 'Source and destination locations must be different';
  END IF;

  SELECT COALESCE(on_hand, 0)
  INTO v_stock
  FROM stock_balances
  WHERE tenant_id = p_tenant
    AND location_id = p_from_location
    AND variant_id = p_variant;

  IF COALESCE(v_stock, 0) < p_quantity THEN
    RAISE EXCEPTION 'Insufficient stock at source. Available: %, requested: %', COALESCE(v_stock, 0), p_quantity;
  END IF;

  INSERT INTO transfer_requests (
    tenant_id,
    from_location_id,
    to_location_id,
    variant_id,
    quantity,
    unit_cost,
    note,
    created_by
  ) VALUES (
    p_tenant,
    p_from_location,
    p_to_location,
    p_variant,
    p_quantity,
    COALESCE(p_unit_cost, 0),
    p_note,
    p_created_by
  )
  RETURNING transfer_id INTO v_transfer_id;

  INSERT INTO inventory_moves (
    tenant_id,
    move_type,
    location_id,
    to_location_id,
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
    'TRANSFER_OUT',
    p_from_location,
    p_to_location,
    p_variant,
    p_quantity,
    COALESCE(p_unit_cost, 0),
    'TRANSFER_REQUEST',
    v_transfer_id,
    COALESCE(p_note, 'Traslado en transito'),
    NOW(),
    p_created_by
  );

  PERFORM fn_apply_stock_delta(p_tenant, p_from_location, p_variant, -p_quantity);

  RETURN v_transfer_id;
END;
$$;

CREATE OR REPLACE FUNCTION sp_receive_transfer_request(
  p_tenant UUID,
  p_transfer_id UUID,
  p_received_by UUID,
  p_note TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_transfer transfer_requests%ROWTYPE;
BEGIN
  SELECT *
  INTO v_transfer
  FROM transfer_requests tr
  WHERE tr.tenant_id = p_tenant
    AND tr.transfer_id = p_transfer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer request not found';
  END IF;

  IF v_transfer.status <> 'IN_TRANSIT' THEN
    RAISE EXCEPTION 'Transfer request status must be IN_TRANSIT. Current: %', v_transfer.status;
  END IF;

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
    'TRANSFER_IN',
    v_transfer.to_location_id,
    v_transfer.variant_id,
    v_transfer.quantity,
    v_transfer.unit_cost,
    'TRANSFER_REQUEST',
    v_transfer.transfer_id,
    COALESCE(p_note, v_transfer.note),
    NOW(),
    p_received_by
  );

  PERFORM fn_apply_stock_delta(p_tenant, v_transfer.to_location_id, v_transfer.variant_id, v_transfer.quantity);

  UPDATE transfer_requests
  SET status = 'RECEIVED',
      received_by = p_received_by,
      received_at = NOW(),
      note = COALESCE(p_note, note)
  WHERE transfer_id = p_transfer_id;

  RETURN p_transfer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION sp_create_transfer_request(UUID, UUID, UUID, UUID, NUMERIC, NUMERIC, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION sp_receive_transfer_request(UUID, UUID, UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
