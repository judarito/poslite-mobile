/* ============================================================================
   INTEGRACIÓN DE LOTES CON COMPRAS
   
   Este script modifica sp_create_purchase para crear lotes automáticamente
   cuando se registran compras de productos que requieren vencimiento.
   
   Autor: Sistema
   Fecha: Febrero 2026
   ============================================================================ */

-- =====================================================================
-- MODIFICAR PROCEDIMIENTO DE COMPRAS PARA CREAR LOTES AUTOMÁTICAMENTE
-- =====================================================================

CREATE OR REPLACE FUNCTION sp_create_purchase(
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
  v_purchase_id UUID;
  v_total NUMERIC(14,2) := 0;

  v_line JSONB;
  v_variant UUID;
  v_qty NUMERIC(14,3);
  v_unit_cost NUMERIC(14,2);
  v_line_total NUMERIC(14,2);
  
  -- Variables para lotes
  v_requires_expiration BOOLEAN;
  v_batch_number TEXT;
  v_expiration_date DATE;
  v_physical_location TEXT;
  v_batch_id UUID;
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Purchase must have at least one line';
  END IF;

  -- Crear ID de compra
  v_purchase_id := gen_random_uuid();

  -- Procesar líneas
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

    -- Validar que la variante existe y obtener requires_expiration
    SELECT 
      fn_variant_requires_expiration(p_tenant, pv.variant_id)
    INTO v_requires_expiration
    FROM product_variants pv
    WHERE pv.tenant_id = p_tenant 
      AND pv.variant_id = v_variant 
      AND pv.is_active = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variant not found/active: %', v_variant;
    END IF;

    v_line_total := ROUND(v_qty * v_unit_cost, 2);

    -- Extraer datos de lote del JSON si existen
    v_batch_number := v_line->>'batch_number';
    v_expiration_date := (v_line->>'expiration_date')::DATE;
    v_physical_location := v_line->>'physical_location';

    -- Si el producto requiere vencimiento, crear/actualizar lote
    IF v_requires_expiration THEN
      -- Validar que se proporcionó fecha de vencimiento
      IF v_expiration_date IS NULL THEN
        RAISE EXCEPTION 'Expiration date required for variant % (product requires expiration control)', v_variant;
      END IF;

      -- Generar número de lote si no se proporcionó
      IF v_batch_number IS NULL OR TRIM(v_batch_number) = '' THEN
        v_batch_number := fn_generate_batch_number(p_tenant, v_variant);
      END IF;

      -- Verificar si ya existe un lote activo con ese número para esta variante en esta sede
      SELECT batch_id INTO v_batch_id
      FROM inventory_batches
      WHERE tenant_id = p_tenant
        AND location_id = p_location
        AND variant_id = v_variant
        AND batch_number = v_batch_number
        AND is_active = TRUE;

      IF v_batch_id IS NOT NULL THEN
        -- Lote existe, actualizar stock
        UPDATE inventory_batches
        SET 
          on_hand = on_hand + v_qty,
          unit_cost = v_unit_cost, -- Actualizar costo (último costo de compra)
          physical_location = COALESCE(v_physical_location, physical_location),
          updated_at = NOW()
        WHERE batch_id = v_batch_id;
      ELSE
        -- Crear nuevo lote
        INSERT INTO inventory_batches(
          tenant_id,
          location_id,
          variant_id,
          batch_number,
          expiration_date,
          on_hand,
          reserved,
          unit_cost,
          physical_location,
          notes,
          is_active,
          received_at,
          created_by,
          updated_at
        )
        VALUES(
          p_tenant,
          p_location,
          v_variant,
          v_batch_number,
          v_expiration_date,
          v_qty,
          0, -- reserved
          v_unit_cost,
          v_physical_location,
          'Creado desde compra: ' || COALESCE(p_note, ''),
          TRUE,
          NOW(),
          p_created_by,
          NOW()
        )
        RETURNING batch_id INTO v_batch_id;
      END IF;

      -- Refrescar vista materializada de stock
      PERFORM fn_refresh_stock_balances();
    ELSE
      -- Producto sin control de vencimiento: crear lote genérico sin fecha
      -- O simplemente no crear lote (sistema híbrido)
      -- Por ahora, creamos lote genérico para mantener trazabilidad
      
      -- Generar número de lote genérico
      IF v_batch_number IS NULL OR TRIM(v_batch_number) = '' THEN
        v_batch_number := fn_generate_batch_number(p_tenant, v_variant);
      END IF;

      -- Crear lote sin vencimiento
      INSERT INTO inventory_batches(
        tenant_id,
        location_id,
        variant_id,
        batch_number,
        expiration_date, -- NULL para productos sin vencimiento
        on_hand,
        reserved,
        unit_cost,
        physical_location,
        notes,
        is_active,
        received_at,
        created_by,
        updated_at
      )
      VALUES(
        p_tenant,
        p_location,
        v_variant,
        v_batch_number,
        NULL, -- Sin fecha de vencimiento
        v_qty,
        0,
        v_unit_cost,
        v_physical_location,
        'Compra sin vencimiento: ' || COALESCE(p_note, ''),
        TRUE,
        NOW(),
        p_created_by,
        NOW()
      );

      -- Refrescar vista materializada
      PERFORM fn_refresh_stock_balances();
    END IF;

    -- Registrar movimiento de inventario
    INSERT INTO inventory_moves(
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
    )
    VALUES(
      p_tenant, 
      'PURCHASE_IN', 
      p_location, 
      v_variant, 
      v_qty, 
      v_unit_cost,
      'PURCHASE', 
      v_purchase_id, 
      p_note, 
      NOW(), 
      p_created_by
    );

    v_total := v_total + v_line_total;
  END LOOP;

  RETURN v_purchase_id;
END;
$$;

COMMENT ON FUNCTION sp_create_purchase IS 
'Crea una compra y automáticamente crea/actualiza lotes para productos con control de vencimiento. 
Formato de p_lines (JSONB array): 
[{
  "variant_id": "uuid",
  "qty": number,
  "unit_cost": number,
  "batch_number": "string" (opcional, se genera si no existe),
  "expiration_date": "YYYY-MM-DD" (requerido si el producto requiere vencimiento),
  "physical_location": "string" (opcional)
}]';

-- =====================================================================
-- VERIFICACIÓN
-- =====================================================================

DO $$
BEGIN
  RAISE NOTICE '✓ sp_create_purchase modificado exitosamente';
  RAISE NOTICE 'El procedimiento ahora crea lotes automáticamente al registrar compras';
  RAISE NOTICE '';
  RAISE NOTICE 'IMPORTANTE:';
  RAISE NOTICE '- Productos con requires_expiration=true DEBEN incluir expiration_date';
  RAISE NOTICE '- batch_number es opcional (se genera automáticamente)';
  RAISE NOTICE '- physical_location es opcional';
  RAISE NOTICE '- Si un lote ya existe, se actualiza su cantidad';
END;
$$;
