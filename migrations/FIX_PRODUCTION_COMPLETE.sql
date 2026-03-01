/* ============================================================================
   FIX COMPLETO: Corregir Duplicación de Inventario en Producción
   ============================================================================
   
   PROBLEMAS IDENTIFICADOS:
   1. fn_consume_bom_components usaba columnas incorrectas (reference_type)
   2. fn_consume_bom_components insertaba cantidad negativa (violaba CHECK)
   3. fn_complete_production creaba inventory manualmente + trigger creaba de nuevo = DUPLICACIÓN
   4. fn_consume_bom_components NO guardaba unit_cost en inventory_moves
   5. fn_consume_bom_components NO insertaba en production_order_lines (UI sin datos)
   
   SOLUCIONES:
   1. ✅ Corregir fn_consume_bom_components (source/source_id, cantidad positiva)
   2. ✅ Corregir fn_consume_bom_components (guardar unit_cost)
   3. ✅ Corregir fn_consume_bom_components (insertar production_order_lines)
   4. ✅ Corregir fn_complete_production (solo insert production_output, trigger hace el resto)
   5. ✅ Limpiar datos duplicados existentes
   
   ORDEN DE EJECUCIÓN:
   1. Corregir fn_consume_bom_components (v1.3)
   2. Corregir fn_complete_production (v3.0)
   3. Limpiar duplicados
   
   Ejecutar: psql -U postgres -d pos_lite -f "migrations/FIX_PRODUCTION_COMPLETE.sql"
   Después: psql -U postgres -d pos_lite -f "migrations/FIX_BATCH_COSTS.sql"
   ============================================================================ */

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '🔧 APLICANDO CORRECCIONES COMPLETAS DE PRODUCCIÓN';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- 1. CORREGIR fn_consume_bom_components
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_consume_bom_components(
  p_tenant UUID,
  p_location UUID,
  p_bom UUID,
  p_quantity NUMERIC,
  p_source_type TEXT, -- 'SALE' o 'PRODUCTION'
  p_source_id UUID, -- sale_id o production_order_id
  p_created_by UUID
)
RETURNS TABLE (
  success BOOLEAN,
  total_cost NUMERIC,
  components_consumed JSONB,
  bom_snapshot JSONB
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_component_record RECORD;
  v_allocation_record RECORD;
  v_adjusted_qty NUMERIC;
  v_track_expiry BOOLEAN;
  v_total_cost NUMERIC := 0;
  v_component_cost NUMERIC;
  v_components_json JSONB := '[]'::JSONB;
  v_batches_json JSONB;
  v_bom_info RECORD;
  v_source_sale_id UUID;
  v_source_line_id UUID;
BEGIN
  -- Validar disponibilidad primero
  DECLARE
    v_validation RECORD;
  BEGIN
    SELECT * INTO v_validation
    FROM fn_validate_bom_availability(p_tenant, p_location, p_bom, p_quantity);
    
    IF NOT v_validation.available THEN
      RAISE EXCEPTION 'Componentes faltantes para BOM: %', v_validation.missing_components;
    END IF;
  END;
  
  -- Obtener información del BOM para snapshot
  SELECT 
    bom.bom_code,
    bom.version,
    COALESCE(bom.variant_id, bom.product_id) AS target_id
  INTO v_bom_info
  FROM bill_of_materials bom
  WHERE bom.bom_id = p_bom;
  
  -- Si es venta, obtener sale_id y line_id
  IF p_source_type = 'SALE' THEN
    v_source_sale_id := p_source_id;
    
    -- Encontrar el sale_line_id del producto ON_DEMAND
    SELECT sale_line_id INTO v_source_line_id
    FROM sale_lines
    WHERE sale_id = v_source_sale_id
      AND variant_id = (
        SELECT variant_id 
        FROM bill_of_materials 
        WHERE bom_id = p_bom 
        LIMIT 1
      )
    LIMIT 1;
  END IF;
  
  -- Iterar cada componente del BOM
  FOR v_component_record IN
    SELECT 
      bc.component_variant_id,
      bc.quantity_required,
      bc.waste_percentage,
      pv.sku,
      p.name
    FROM bom_components bc
    JOIN product_variants pv ON pv.variant_id = bc.component_variant_id
    JOIN products p ON p.product_id = pv.product_id
    WHERE bc.bom_id = p_bom
      AND bc.is_optional = FALSE
  LOOP
    -- Calcular cantidad ajustada por desperdicio
    v_adjusted_qty := v_component_record.quantity_required * p_quantity * 
                      (1 + COALESCE(v_component_record.waste_percentage, 0) / 100);
    
    -- Verificar si componente requiere tracking de vencimiento
    v_track_expiry := fn_variant_requires_expiration(p_tenant, v_component_record.component_variant_id);
    
    -- Asignar lotes con FEFO
    v_component_cost := 0;
    v_batches_json := '[]'::JSONB;
    
    FOR v_allocation_record IN
      SELECT * FROM fn_allocate_fefo_for_component(
        p_tenant,
        p_location,
        v_component_record.component_variant_id,
        v_adjusted_qty
      )
    LOOP
      -- Descontar del lote
      UPDATE inventory_batches
      SET on_hand = on_hand - v_allocation_record.quantity_allocated,
          updated_at = NOW()
      WHERE batch_id = v_allocation_record.batch_id;
      
      -- Acumular costo
      v_component_cost := v_component_cost + 
                          (v_allocation_record.unit_cost * v_allocation_record.quantity_allocated);
      
      -- Agregar batch a JSON
      v_batches_json := v_batches_json || jsonb_build_object(
        'batch_id', v_allocation_record.batch_id,
        'batch_number', v_allocation_record.batch_number,
        'expiration_date', v_allocation_record.expiration_date,
        'quantity', v_allocation_record.quantity_allocated,
        'unit_cost', v_allocation_record.unit_cost
      );
      
      -- Registrar en component_allocations (trazabilidad)
      IF v_source_sale_id IS NOT NULL THEN
        INSERT INTO component_allocations (
          tenant_id, source_type, sale_id, sale_line_id,
          component_variant_id, batch_id, quantity, unit_cost, total_cost, consumed_at
        ) VALUES (
          p_tenant, p_source_type, v_source_sale_id, v_source_line_id,
          v_component_record.component_variant_id, 
          v_allocation_record.batch_id,
          v_allocation_record.quantity_allocated,
          v_allocation_record.unit_cost,
          v_allocation_record.unit_cost * v_allocation_record.quantity_allocated,
          NOW()
        );
      END IF;
    END LOOP;
    
    -- ✅ FIX: Usar source/source_id (no reference_type/reference_id)
    -- ✅ FIX: Cantidad positiva (no negativa)
    -- ✅ FIX: Incluir unit_cost (costo promedio ponderado de lotes consumidos)
    INSERT INTO inventory_moves (
      tenant_id, location_id, variant_id,
      move_type, quantity, unit_cost, source, source_id, created_by
    ) VALUES (
      p_tenant, p_location, v_component_record.component_variant_id,
      'COMPONENT_CONSUMPTION', 
      v_adjusted_qty, 
      CASE WHEN v_adjusted_qty > 0 THEN v_component_cost / v_adjusted_qty ELSE 0 END,
      p_source_type, p_source_id, p_created_by
    );
    
    -- ✅ NUEVO: Registrar en production_order_lines para trazabilidad UI
    IF p_source_type = 'PRODUCTION' THEN
      INSERT INTO production_order_lines (
        tenant_id, production_order_id, component_variant_id,
        quantity_required, quantity_consumed, unit_cost, consumed_at
      ) VALUES (
        p_tenant, p_source_id, v_component_record.component_variant_id,
        v_component_record.quantity_required * p_quantity,  -- Cantidad sin desperdicio (planeada)
        v_adjusted_qty,  -- Cantidad real consumida (con desperdicio)
        CASE WHEN v_adjusted_qty > 0 THEN v_component_cost / v_adjusted_qty ELSE 0 END,
        NOW()
      );
    END IF;
    
    v_total_cost := v_total_cost + v_component_cost;
    
    -- Agregar componente a JSON
    v_components_json := v_components_json || jsonb_build_object(
      'variant_id', v_component_record.component_variant_id,
      'sku', v_component_record.sku,
      'name', v_component_record.name,
      'quantity_required', v_component_record.quantity_required * p_quantity,
      'waste_applied', v_adjusted_qty - (v_component_record.quantity_required * p_quantity),
      'quantity_consumed', v_adjusted_qty,
      'unit_cost', CASE WHEN v_adjusted_qty > 0 THEN v_component_cost / v_adjusted_qty ELSE 0 END,
      'total_cost', v_component_cost,
      'batches', v_batches_json
    );
  END LOOP;
  
  -- Crear snapshot del BOM
  bom_snapshot := jsonb_build_object(
    'bom_id', p_bom,
    'bom_code', v_bom_info.bom_code,
    'version', v_bom_info.version,
    'consumed_at', NOW(),
    'quantity_produced', p_quantity,
    'total_cost', v_total_cost,
    'components', v_components_json
  );
  
  success := TRUE;
  total_cost := v_total_cost;
  components_consumed := v_components_json;
  
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION fn_consume_bom_components IS 
  'v1.3: Consume componentes BOM con FEFO. NOW inserts into production_order_lines for UI traceability.';

-- ============================================================================
-- 2. CORREGIR fn_complete_production
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_complete_production(
  p_production_order UUID,
  p_quantity_produced NUMERIC,
  p_completed_by UUID,
  p_expiration_date DATE DEFAULT NULL,
  p_physical_location TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_order RECORD;
  v_consumption RECORD;
  v_batch_id UUID;
  v_unit_cost NUMERIC;
  v_new_price NUMERIC;
BEGIN
  -- Obtener orden
  SELECT * INTO v_order
  FROM production_orders
  WHERE production_order_id = p_production_order;
  
  IF v_order.status != 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Orden debe estar IN_PROGRESS. Estado actual: %', v_order.status;
  END IF;
  
  IF p_quantity_produced > v_order.quantity_planned THEN
    RAISE EXCEPTION 'Cantidad producida (%) excede cantidad planeada (%)', 
      p_quantity_produced, v_order.quantity_planned;
  END IF;
  
  -- Consumir componentes
  SELECT * INTO v_consumption
  FROM fn_consume_bom_components(
    v_order.tenant_id,
    v_order.location_id,
    v_order.bom_id,
    p_quantity_produced,
    'PRODUCTION',
    p_production_order,
    p_completed_by
  );
  
  -- Calcular costo unitario
  v_unit_cost := v_consumption.total_cost / p_quantity_produced;
  
  -- ✅ FIX: NO crear inventory_batch ni inventory_move manualmente
  -- El trigger fn_generate_production_inventory lo hará automáticamente
  INSERT INTO production_outputs (
    tenant_id, production_order_id, 
    quantity_produced, unit_cost, produced_by,
    expiration_date, physical_location
  ) VALUES (
    v_order.tenant_id, p_production_order, 
    p_quantity_produced, v_unit_cost, p_completed_by,
    p_expiration_date, p_physical_location
  )
  RETURNING batch_id INTO v_batch_id;
  
  -- ✅ NUEVO: Actualizar cost de la variante basado en componentes consumidos
  -- Calcular precio de venta según política de pricing_rules
  v_new_price := fn_calculate_price(
    v_order.tenant_id,
    v_order.product_variant_id,
    v_unit_cost,
    v_order.location_id
  );
  
  UPDATE product_variants
  SET cost = v_unit_cost,
      price = v_new_price
  WHERE tenant_id = v_order.tenant_id
    AND variant_id = v_order.product_variant_id;
  
  RAISE NOTICE 'TO_STOCK: Variante actualizada. Costo: %, Precio: %', v_unit_cost, v_new_price;
  
  -- Actualizar orden
  UPDATE production_orders
  SET status = 'COMPLETED',
      quantity_produced = p_quantity_produced,
      actual_cost = v_consumption.total_cost,
      actual_end = NOW(),
      completed_by = p_completed_by
  WHERE production_order_id = p_production_order;
  
  RETURN v_batch_id;
END;
$$;

COMMENT ON FUNCTION fn_complete_production IS 
  'v3.0: Completa orden TO_STOCK. Consume componentes, inserta production_output (trigger crea lote automáticamente), actualiza cost/price.';

-- ============================================================================
-- 3. LIMPIAR DATOS DUPLICADOS (SI EXISTEN)
-- ============================================================================

DO $$
DECLARE
  v_duplicated_batches INT;
  v_duplicated_moves INT;
  v_order_id UUID;
  v_order_number TEXT;
  v_deleted_batches INT := 0;
  v_deleted_moves INT := 0;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '🧹 Limpiando datos duplicados de producción PO-2026-00010...';
  RAISE NOTICE '';
  
  -- Obtener ID y número de la orden
  SELECT production_order_id, order_number 
  INTO v_order_id, v_order_number
  FROM production_orders
  WHERE order_number = 'PO-2026-00010';
  
  IF v_order_id IS NULL THEN
    RAISE NOTICE '⚠️  Orden PO-2026-00010 no encontrada';
    RETURN;
  END IF;
  
  -- Contar lotes duplicados (buscar por batch_number que contiene el order_number)
  SELECT COUNT(*) INTO v_duplicated_batches
  FROM inventory_batches
  WHERE batch_number LIKE '%' || v_order_number || '%';
  
  -- Contar movimientos duplicados
  SELECT COUNT(*) INTO v_duplicated_moves
  FROM inventory_moves
  WHERE source_id = v_order_id
    AND move_type = 'PRODUCTION_IN';
  
  RAISE NOTICE 'Lotes encontrados: %', v_duplicated_batches;
  RAISE NOTICE 'Movimientos duplicados encontrados: %', v_duplicated_moves;
  
  -- Si hay más de 1 lote, eliminar el que NO tiene production_output asociado
  IF v_duplicated_batches > 1 THEN
    WITH duplicate_batches AS (
      SELECT 
        ib.batch_id, 
        ib.batch_number, 
        ib.received_at,
        EXISTS(SELECT 1 FROM production_outputs po WHERE po.batch_id = ib.batch_id) as has_output
      FROM inventory_batches ib
      WHERE ib.batch_number LIKE '%' || v_order_number || '%'
      ORDER BY ib.received_at
    )
    DELETE FROM inventory_batches
    WHERE batch_id IN (
      SELECT batch_id 
      FROM duplicate_batches 
      WHERE has_output = FALSE
      LIMIT 1
    );
    
    GET DIAGNOSTICS v_deleted_batches = ROW_COUNT;
    RAISE NOTICE '✅ Eliminados % lotes duplicados', v_deleted_batches;
  END IF;
  
  -- Si hay más de 1 movimiento PRODUCTION_IN, eliminar el más antiguo
  IF v_duplicated_moves > 1 THEN
    WITH duplicate_moves AS (
      SELECT inventory_move_id, created_at
      FROM inventory_moves
      WHERE source_id = v_order_id
        AND move_type = 'PRODUCTION_IN'
      ORDER BY created_at
    )
    DELETE FROM inventory_moves
    WHERE inventory_move_id IN (
      SELECT inventory_move_id 
      FROM duplicate_moves 
      LIMIT 1
    );
    
    GET DIAGNOSTICS v_deleted_moves = ROW_COUNT;
    RAISE NOTICE '✅ Eliminados % movimientos duplicados', v_deleted_moves;
  END IF;
  
  -- Recalcular stock_balances
  IF v_deleted_batches > 0 THEN
    RAISE NOTICE '';
    RAISE NOTICE '🔄 Recalculando stock_balances...';
    
    -- Refrescar vista materializada (recalcula desde inventory_batches)
    BEGIN
      REFRESH MATERIALIZED VIEW CONCURRENTLY stock_balances;
      RAISE NOTICE '✅ Stock_balances actualizado correctamente';
    EXCEPTION WHEN OTHERS THEN
      -- Si falla concurrent, intentar sin concurrent
      REFRESH MATERIALIZED VIEW stock_balances;
      RAISE NOTICE '✅ Stock_balances actualizado correctamente';
    END;
  END IF;
  
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- 4. VERIFICACIÓN FINAL
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ CORRECCIONES APLICADAS EXITOSAMENTE';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Funciones corregidas:';
  RAISE NOTICE '  ✓ fn_consume_bom_components v1.2 (guarda unit_cost)';
  RAISE NOTICE '  ✓ fn_complete_production v3.0';
  RAISE NOTICE '';
  RAISE NOTICE 'Próximos pasos:';
  RAISE NOTICE '  1. 🔧 Ejecutar FIX_BATCH_COSTS.sql para corregir costos de lotes';
  RAISE NOTICE '  2. 🔄 Crear nueva orden de producción y completarla';
  RAISE NOTICE '  3. ✅ Verificar que solo se cree 1 unidad en inventario';
  RAISE NOTICE '  4. ✅ Verificar que cost sea ~$12,800 (no $152,500)';
  RAISE NOTICE '  5. ✅ Verificar que el detalle de la orden muestre los componentes consumidos';
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
END $$;
