/* ============================================================================
   SISTEMA DE MANUFACTURA - FASE 3: ON_DEMAND (PRODUCCIÓN BAJO DEMANDA)
   
   ALCANCE: **LA MÁS CRÍTICA DEL SISTEMA**
   1. fn_consume_bom_components() - Consumir componentes con FEFO
   2. fn_allocate_fefo_for_component() - Asignar lotes por componente
   3. Modificar sp_create_sale() para detectar ON_DEMAND y llamar fn_consume_bom_components()
   4. Vistas de reportes de costos reales ON_DEMAND
   
   COMPORTAMIENTO ON_DEMAND:
   - Al vender producto ON_DEMAND, el sistema consume componentes inmediatamente
   - Aplica FEFO a cada componente con track_expiry
   - Crea snapshot del BOM usado
   - Calcula costo = suma(costo_componente × cantidad)
   - NO crea stock del producto terminado
   
   ORDEN DE EJECUCIÓN: 5/6
   PREREQUISITO: MANUFACTURING_PHASE2_SERVICE_BOM.sql
   ============================================================================ */

-- =====================================================================
-- 1. FUNCIÓN: ASIGNAR FEFO PARA UN COMPONENTE INDIVIDUAL
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_allocate_fefo_for_component(
  p_tenant UUID,
  p_location UUID,
  p_variant UUID,
  p_quantity NUMERIC
)
RETURNS TABLE (
  batch_id UUID,
  batch_number TEXT,
  expiration_date DATE,
  quantity_allocated NUMERIC,
  unit_cost NUMERIC
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_remaining NUMERIC := p_quantity;
  v_batch_record RECORD;
  v_allocated NUMERIC;
BEGIN
  -- Obtener lotes con FEFO (próximos a vencer primero)
  FOR v_batch_record IN
    SELECT 
      ib.batch_id,
      ib.batch_number,
      ib.expiration_date,
      ib.on_hand - ib.reserved AS available,
      ib.unit_cost
    FROM inventory_batches ib
    WHERE ib.tenant_id = p_tenant
      AND ib.location_id = p_location
      AND ib.variant_id = p_variant
      AND ib.is_active = TRUE
      AND (ib.on_hand - ib.reserved) > 0
    ORDER BY 
      CASE WHEN ib.expiration_date IS NULL THEN 1 ELSE 0 END,
      ib.expiration_date ASC NULLS LAST,
      ib.received_at ASC
  LOOP
    IF v_remaining <= 0 THEN
      EXIT;
    END IF;
    
    -- Calcular cuánto asignar de este lote
    v_allocated := LEAST(v_batch_record.available, v_remaining);
    
    -- Retornar asignación
    batch_id := v_batch_record.batch_id;
    batch_number := v_batch_record.batch_number;
    expiration_date := v_batch_record.expiration_date;
    quantity_allocated := v_allocated;
    unit_cost := v_batch_record.unit_cost;
    
    RETURN NEXT;
    
    v_remaining := v_remaining - v_allocated;
  END LOOP;
  
  -- Si falta cantidad, error
  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Stock insuficiente para componente %. Faltaron % unidades.', 
      p_variant, v_remaining;
  END IF;
END;
$$;

COMMENT ON FUNCTION fn_allocate_fefo_for_component IS 
  'Asigna lotes específicos para consumir un componente aplicando FEFO. Retorna lista de batch_id y cantidades.';

-- =====================================================================
-- 2. FUNCIÓN: CONSUMIR COMPONENTES DE BOM (CORE ON_DEMAND)
-- =====================================================================

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
      bc.quantity,
      bc.waste_percentage,
      pv.sku,
      p.name
    FROM bom_components bc
    JOIN product_variants pv ON pv.variant_id = bc.component_variant_id
    JOIN products p ON p.product_id = pv.product_id
    WHERE bc.bom_id = p_bom
      AND bc.is_optional = FALSE
    ORDER BY bc.sequence NULLS LAST
  LOOP
    -- Calcular cantidad ajustada por desperdicio
    v_adjusted_qty := v_component_record.quantity * p_quantity * 
                      (1 + v_component_record.waste_percentage / 100);
    
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
    
    -- Crear inventory_move para el componente (cantidad positiva, tipo indica salida)
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
      'quantity_required', v_component_record.quantity * p_quantity,
      'waste_applied', v_adjusted_qty - (v_component_record.quantity * p_quantity),
      'quantity_consumed', v_adjusted_qty,
      'unit_cost', v_component_cost / v_adjusted_qty,
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
  'CORE ON_DEMAND: Consume componentes de BOM aplicando FEFO, registra trazabilidad, crea inventory_moves, retorna costo real y snapshot.';

-- =====================================================================
-- 3. MODIFICAR sp_create_sale PARA ON_DEMAND
-- =====================================================================
-- Nota: Como sp_create_sale es muy grande, solo agregamos la lógica ON_DEMAND
-- Esto se debe insertar ANTES de las validaciones de stock finales

CREATE OR REPLACE FUNCTION fn_handle_ondemand_line(
  p_tenant UUID,
  p_location UUID,
  p_sale_id UUID,
  p_line_id UUID,
  p_variant UUID,
  p_quantity NUMERIC,
  p_created_by UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_behavior TEXT;
  v_production_type TEXT;
  v_bom_id UUID;
  v_consumption_result RECORD;
BEGIN
  -- Obtener configuración efectiva
  v_behavior := fn_get_effective_inventory_behavior(p_tenant, p_variant);
  v_production_type := fn_get_effective_production_type(p_tenant, p_variant);
  
  -- Solo procesar si es MANUFACTURED ON_DEMAND
  IF v_behavior = 'MANUFACTURED' AND v_production_type = 'ON_DEMAND' THEN
    -- Obtener BOM activo
    v_bom_id := fn_get_active_bom(p_tenant, p_variant);
    
    IF v_bom_id IS NULL THEN
      RAISE EXCEPTION 'Producto MANUFACTURED ON_DEMAND % no tiene BOM activo configurado', p_variant;
    END IF;
    
    -- Consumir componentes
    SELECT * INTO v_consumption_result
    FROM fn_consume_bom_components(
      p_tenant,
      p_location,
      v_bom_id,
      p_quantity,
      'SALE',
      p_sale_id,
      p_created_by
    );
    
    -- Actualizar sale_line con snapshot y costo
    UPDATE sale_lines
    SET 
      bom_snapshot = v_consumption_result.bom_snapshot,
      production_cost = v_consumption_result.total_cost,
      components_consumed = v_consumption_result.components_consumed
    WHERE sale_line_id = p_line_id;
    
    -- NO crear inventory_move del producto (no tiene stock)
    -- NO descontar stock_balances (no existe)
    
    RAISE NOTICE 'ON_DEMAND: Producto % fabricado. Costo: %', p_variant, v_consumption_result.total_cost;
  END IF;
END;
$$;

COMMENT ON FUNCTION fn_handle_ondemand_line IS 
  'Procesa línea de venta ON_DEMAND: valida BOM, consume componentes, actualiza costs. Llamar desde sp_create_sale.';

-- =====================================================================
-- 4. VISTA: MARGEN REAL POR PRODUCTO ON_DEMAND
-- =====================================================================

CREATE OR REPLACE VIEW vw_ondemand_margin_analysis AS
SELECT 
  s.tenant_id,
  s.location_id,
  s.sold_at::DATE AS sale_date,
  s.sale_id,
  s.sale_number,
  
  sl.sale_line_id,
  sl.variant_id,
  pv.sku,
  p.name AS product_name,
  
  sl.quantity,
  sl.line_total AS revenue,
  sl.production_cost AS actual_cost,
  
  (sl.line_total - COALESCE(sl.production_cost, 0)) AS gross_profit,
  
  CASE 
    WHEN sl.line_total > 0 THEN
      ((sl.line_total - COALESCE(sl.production_cost, 0)) / sl.line_total * 100)
    ELSE 0
  END AS margin_percentage,
  
  (sl.line_total / NULLIF(sl.quantity, 0)) AS price_per_unit,
  (COALESCE(sl.production_cost, 0) / NULLIF(sl.quantity, 0)) AS cost_per_unit,
  
  jsonb_array_length(COALESCE(sl.components_consumed, '[]'::JSONB)) AS components_count
  
FROM sales s
JOIN sale_lines sl ON sl.sale_id = s.sale_id
JOIN product_variants pv ON pv.variant_id = sl.variant_id
JOIN products p ON p.product_id = pv.product_id
WHERE fn_get_effective_inventory_behavior(s.tenant_id, sl.variant_id) = 'MANUFACTURED'
  AND fn_get_effective_production_type(s.tenant_id, sl.variant_id) = 'ON_DEMAND'
  AND s.status = 'COMPLETED'
  AND sl.production_cost IS NOT NULL;

COMMENT ON VIEW vw_ondemand_margin_analysis IS 
  'Análisis de margen real de productos ON_DEMAND. Compara precio venta vs costo real de componentes consumidos.';

-- =====================================================================
-- 5. VISTA: ANÁLISIS DE COMPONENTES CONSUMIDOS
-- =====================================================================

CREATE OR REPLACE VIEW vw_component_consumption_detail AS
SELECT 
  ca.tenant_id,
  s.sold_at::DATE AS consumption_date,
  ca.sale_id,
  s.sale_number,
  
  ca.component_variant_id,
  pv.sku,
  p.name AS component_name,
  
  SUM(ca.quantity) AS total_quantity_consumed,
  AVG(ca.unit_cost) AS avg_unit_cost,
  SUM(ca.total_cost) AS total_cost,
  
  COUNT(DISTINCT ca.batch_id) AS batches_used,
  COUNT(DISTINCT ca.sale_id) AS sales_count
  
FROM component_allocations ca
JOIN sales s ON s.sale_id = ca.sale_id
JOIN product_variants pv ON pv.variant_id = ca.component_variant_id
JOIN products p ON p.product_id = pv.product_id
WHERE ca.source_type = 'SALE_ON_DEMAND'
GROUP BY 
  ca.tenant_id,
  s.sold_at::DATE,
  ca.sale_id,
  s.sale_number,
  ca.component_variant_id,
  pv.sku,
  p.name;

COMMENT ON VIEW vw_component_consumption_detail IS 
  'Detalle de componentes consumidos en ventas ON_DEMAND. Útil para análisis de consumo y costos.';

-- =====================================================================
-- 6. VISTA: TOP PRODUCTOS ON_DEMAND MÁS VENDIDOS
-- =====================================================================

CREATE OR REPLACE VIEW vw_ondemand_top_products AS
SELECT 
  s.tenant_id,
  sl.variant_id,
  pv.sku,
  p.name,
  
  COUNT(DISTINCT s.sale_id) AS transactions,
  SUM(sl.quantity) AS total_quantity_sold,
  SUM(sl.line_total) AS total_revenue,
  SUM(COALESCE(sl.production_cost, 0)) AS total_cost,
  
  SUM(sl.line_total - COALESCE(sl.production_cost, 0)) AS total_profit,
  
  AVG(
    CASE 
      WHEN sl.line_total > 0 THEN
        ((sl.line_total - COALESCE(sl.production_cost, 0)) / sl.line_total * 100)
      ELSE 0
    END
  ) AS avg_margin_percentage,
  
  MAX(s.sold_at) AS last_sale_date
  
FROM sales s
JOIN sale_lines sl ON sl.sale_id = s.sale_id
JOIN product_variants pv ON pv.variant_id = sl.variant_id
JOIN products p ON p.product_id = pv.product_id
WHERE fn_get_effective_inventory_behavior(s.tenant_id, sl.variant_id) = 'MANUFACTURED'
  AND fn_get_effective_production_type(s.tenant_id, sl.variant_id) = 'ON_DEMAND'
  AND s.status = 'COMPLETED'
GROUP BY s.tenant_id, sl.variant_id, pv.sku, p.name
ORDER BY total_revenue DESC;

COMMENT ON VIEW vw_ondemand_top_products IS 
  'Ranking de productos ON_DEMAND más vendidos con análisis de rentabilidad.';

-- =====================================================================
-- 7. VERIFICACIÓN
-- =====================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ FASE 3: ON_DEMAND COMPLETADA (LA MÁS CRÍTICA)';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Funciones CORE creadas:';
  RAISE NOTICE '  ✓ fn_allocate_fefo_for_component() - Asigna lotes FEFO por componente';
  RAISE NOTICE '  ✓ fn_consume_bom_components() - Consume componentes + snapshot + costos';
  RAISE NOTICE '  ✓ fn_handle_ondemand_line() - Handler para sp_create_sale';
  RAISE NOTICE '';
  RAISE NOTICE 'Vistas de análisis:';
  RAISE NOTICE '  ✓ vw_ondemand_margin_analysis - Margen real vs precio venta';
  RAISE NOTICE '  ✓ vw_component_consumption_detail - Detalle de consumo componentes';
  RAISE NOTICE '  ✓ vw_ondemand_top_products - Ranking productos más vendidos';
  RAISE NOTICE '';
  RAISE NOTICE 'ACCIÓN REQUERIDA:';
  RAISE NOTICE '  ⚠️  Modificar sp_create_sale() para llamar fn_handle_ondemand_line()';
  RAISE NOTICE '  ⚠️  Agregar detección de behavior ANTES de validar stock';
  RAISE NOTICE '';
  RAISE NOTICE 'SIGUIENTE PASO: Ejecutar MANUFACTURING_PHASE4_BUNDLES.sql';
  RAISE NOTICE '════════════════════════════════════════════════════════';
END $$;
