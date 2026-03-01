/* ============================================================================
   FIX: Corregir fn_consume_bom_components - Error reference_type
   ============================================================================
   
   PROBLEMA: La función usaba reference_type/reference_id pero inventory_moves
   tiene source/source_id
   
   SOLUCIÓN: Recrear la función con los nombres de columna correctos
   
   Ejecutar: psql -U postgres -d pos_lite -f "migrations/FIX_CONSUME_BOM_REFERENCE_TYPE.sql"
   ============================================================================ */

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '🔧 Corrigiendo fn_consume_bom_components';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;

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
    
    -- Crear inventory_move para el componente (✅ CORREGIDO: source/source_id)
    INSERT INTO inventory_moves (
      tenant_id, location_id, variant_id,
      move_type, quantity, source, source_id, created_by
    ) VALUES (
      p_tenant, p_location, v_component_record.component_variant_id,
      'COMPONENT_CONSUMPTION', v_adjusted_qty, p_source_type, p_source_id, p_created_by
    );
    
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
  'v1.1: Consume componentes de BOM aplicando FEFO. Corregido para usar source/source_id en lugar de reference_type/reference_id.';

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Función fn_consume_bom_components actualizada correctamente';
  RAISE NOTICE '';
  RAISE NOTICE '💡 Ahora puedes completar órdenes de producción sin error';
  RAISE NOTICE '';
END $$;
