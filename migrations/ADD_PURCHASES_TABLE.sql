-- ===================================================================
-- Tabla purchases: cabecera de cada compra
-- Guarda proveedor, total, nota, y el ID real de la compra
-- usado como source_id en inventory_moves.
-- ===================================================================

CREATE TABLE IF NOT EXISTS purchases (
  purchase_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(tenant_id),
  location_id   UUID        REFERENCES locations(location_id),
  supplier_id   UUID        REFERENCES third_parties(third_party_id),
  total         NUMERIC(14,2) NOT NULL DEFAULT 0,
  note          TEXT,
  created_by    UUID        REFERENCES users(user_id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_purchases_tenant    ON purchases(tenant_id);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier  ON purchases(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchases_date      ON purchases(created_at DESC);

-- RLS
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON purchases
  USING (tenant_id = get_current_user_tenant_id());

GRANT SELECT, INSERT, UPDATE ON purchases TO authenticated;

-- ===================================================================
-- Actualizar sp_create_purchase para insertar en purchases
-- ===================================================================
CREATE OR REPLACE FUNCTION sp_create_purchase(
  p_tenant      UUID,
  p_location    UUID,
  p_supplier_id UUID,
  p_created_by  UUID,
  p_lines       JSONB,
  p_note        TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_purchase_id UUID;
  v_total       NUMERIC(14,2) := 0;
  v_line        JSONB;
  v_variant     UUID;
  v_qty         NUMERIC(14,3);
  v_unit_cost   NUMERIC(14,2);
  v_line_total  NUMERIC(14,2);
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Purchase must have at least one line';
  END IF;

  -- Crear cabecera de compra
  INSERT INTO purchases (tenant_id, location_id, supplier_id, note, created_by)
  VALUES (p_tenant, p_location, p_supplier_id, p_note, p_created_by)
  RETURNING purchase_id INTO v_purchase_id;

  -- Procesar líneas
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_variant   := (v_line->>'variant_id')::UUID;
    v_qty       := (v_line->>'qty')::NUMERIC;
    v_unit_cost := (v_line->>'unit_cost')::NUMERIC;

    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid qty for variant %', v_variant;
    END IF;
    IF v_unit_cost < 0 THEN
      RAISE EXCEPTION 'Invalid unit_cost for variant %', v_variant;
    END IF;

    -- Validar variante activa
    PERFORM 1
      FROM product_variants pv
     WHERE pv.tenant_id = p_tenant
       AND pv.variant_id = v_variant
       AND pv.is_active = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variant not found/active: %', v_variant;
    END IF;

    v_line_total := ROUND(v_qty * v_unit_cost, 2);

    -- Lote / vencimiento (opcional)
    IF v_line->>'batch_number' IS NOT NULL OR v_line->>'expiration_date' IS NOT NULL THEN
      PERFORM fn_create_batch(
        p_tenant,
        v_variant,
        p_location,
        COALESCE(v_line->>'batch_number', NULL),
        CASE WHEN v_line->>'expiration_date' IS NOT NULL
             THEN (v_line->>'expiration_date')::DATE ELSE NULL END,
        v_qty,
        v_purchase_id,
        v_line->>'physical_location'
      );
    END IF;

    -- Movimiento de inventario
    INSERT INTO inventory_moves(
      tenant_id, move_type, location_id, variant_id, quantity, unit_cost,
      source, source_id, note, created_at, created_by
    ) VALUES (
      p_tenant, 'PURCHASE_IN', p_location, v_variant, v_qty, v_unit_cost,
      'PURCHASE', v_purchase_id, p_note, NOW(), p_created_by
    );

    -- Actualizar stock
    PERFORM fn_apply_stock_delta(p_tenant, p_location, v_variant, v_qty);

    v_total := v_total + v_line_total;
  END LOOP;

  -- Actualizar total en cabecera
  UPDATE purchases SET total = v_total WHERE purchase_id = v_purchase_id;

  RETURN v_purchase_id;
END;
$$;

-- Permisos
GRANT EXECUTE ON FUNCTION sp_create_purchase(UUID, UUID, UUID, UUID, JSONB, TEXT) TO authenticated;

DO $$ BEGIN
  RAISE NOTICE '✅ Tabla purchases creada y sp_create_purchase actualizado con supplier_id';
END $$;
