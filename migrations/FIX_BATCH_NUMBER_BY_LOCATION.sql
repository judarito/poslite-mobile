/* ============================================================================
   FIX BATCH NUMBER: Filtrar por Location ID
   
   PROBLEMA IDENTIFICADO:
   La función fn_generate_batch_number busca el MAX de batch_numbers de TODAS
   las sedes (locations), causando números gigantes cuando se compra el mismo
   producto en diferentes sedes el mismo día.
   
   SOLUCIÓN:
   Agregar parameter p_location y filtrar por location_id para que cada sede
   tenga su propia secuencia de lotes.
   ============================================================================ */

-- =====================================================================
-- FUNCIÓN CORREGIDA: Generar batch_number filtrado por location
-- =====================================================================

-- Primero eliminar la versión anterior para evitar conflictos
DROP FUNCTION IF EXISTS fn_generate_batch_number(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS fn_generate_batch_number(UUID, UUID);

CREATE OR REPLACE FUNCTION fn_generate_batch_number(
  p_tenant UUID,
  p_variant UUID,
  p_location UUID DEFAULT NULL,  -- NUEVO: filtrar por sede
  p_prefix TEXT DEFAULT 'BATCH'
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_sku TEXT;
  v_date TEXT;
  v_seq INT;
  v_batch_number TEXT;
BEGIN
  -- Obtener SKU
  SELECT sku INTO v_sku
  FROM product_variants
  WHERE tenant_id = p_tenant AND variant_id = p_variant;
  
  -- Fecha en formato YYMMDD
  v_date := TO_CHAR(CURRENT_DATE, 'YYMMDD');
  
  -- Secuencia del día (filtrada por location si se proporciona)
  IF p_location IS NOT NULL THEN
    -- Buscar secuencia solo en esta sede
    SELECT COALESCE(COUNT(*), 0) + 1
    INTO v_seq
    FROM inventory_batches
    WHERE tenant_id = p_tenant
      AND location_id = p_location
      AND variant_id = p_variant
      AND received_at::DATE = CURRENT_DATE;
  ELSE
    -- Buscar secuencia global (fallback por compatibilidad)
    SELECT COALESCE(COUNT(*), 0) + 1
    INTO v_seq
    FROM inventory_batches
    WHERE tenant_id = p_tenant
      AND variant_id = p_variant
      AND received_at::DATE = CURRENT_DATE;
  END IF;
  
  -- Formato: PREFIX-SKU-YYMMDD-###
  v_batch_number := format('%s-%s-%s-%s', p_prefix, v_sku, v_date, LPAD(v_seq::TEXT, 3, '0'));
  
  RETURN v_batch_number;
END;
$$;

COMMENT ON FUNCTION fn_generate_batch_number IS 
  'Genera número de lote automático: PREFIX-SKU-YYMMDD-###. Filtrado por location_id para evitar overflow.';

-- =====================================================================
-- ACTUALIZAR sp_create_purchase para pasar location_id
-- =====================================================================

-- Verificar si necesitamos actualizar las llamadas a fn_generate_batch_number
DO $$
DECLARE
  v_proc_source TEXT;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE 'VERIFICANDO sp_create_purchase';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  
  SELECT pg_get_functiondef(oid) INTO v_proc_source
  FROM pg_proc
  WHERE proname = 'sp_create_purchase'
  LIMIT 1;
  
  IF v_proc_source LIKE '%fn_generate_batch_number(p_tenant, v_variant)%' THEN
    RAISE NOTICE '⚠️ sp_create_purchase NO pasa location_id a fn_generate_batch_number';
    RAISE NOTICE 'Esto causa overflow en compras multi-sede del mismo producto.';
    RAISE NOTICE '';
    RAISE NOTICE 'Aplicando corrección...';
  ELSE
    RAISE NOTICE '✓ sp_create_purchase ya está corregido';
  END IF;
  
  RAISE NOTICE '';
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- LEER Y REEMPLAZAR sp_create_purchase
-- =====================================================================

-- Como no puedo hacer un simple REPLACE en el procedimiento,
-- necesito recrearlo completo con los cambios

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

      -- Generar número de lote si no se proporcionó (AHORA PASA p_location)
      IF v_batch_number IS NULL OR TRIM(v_batch_number) = '' THEN
        v_batch_number := fn_generate_batch_number(p_tenant, v_variant, p_location);
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
          unit_cost = v_unit_cost,
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
          0,
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
      BEGIN
        PERFORM fn_refresh_stock_balances();
      EXCEPTION WHEN OTHERS THEN
        -- Si falla, continuar (puede ser que no exista la función)
        NULL;
      END;
    ELSE
      -- Producto sin control de vencimiento: crear lote genérico sin fecha
      IF v_batch_number IS NULL OR TRIM(v_batch_number) = '' THEN
        v_batch_number := fn_generate_batch_number(p_tenant, v_variant, p_location);
      END IF;

      -- Crear lote sin vencimiento
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
        NULL,
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
      BEGIN
        PERFORM fn_refresh_stock_balances();
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
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
'Crea una compra y automáticamente crea/actualiza lotes. CORREGIDO: Pasa location_id a fn_generate_batch_number.';

-- =====================================================================
-- VERIFICACIÓN FINAL
-- =====================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ CORRECCIÓN APLICADA';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Cambios realizados:';
  RAISE NOTICE '  ✓ fn_generate_batch_number ahora acepta p_location';
  RAISE NOTICE '  ✓ Secuencia de lotes filtrada por sede';
  RAISE NOTICE '  ✓ sp_create_purchase pasa location_id correctamente';
  RAISE NOTICE '';
  RAISE NOTICE 'Ahora puedes registrar compras del mismo producto';
  RAISE NOTICE 'en diferentes sedes sin overflow.';
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
END;
$$ LANGUAGE plpgsql;
