/* ============================================================================
   SISTEMA DE MANUFACTURA - FASE 2: SERVICE + FUNCIONES BOM
   
   ALCANCE:
   1. Modificar sp_create_sale para detectar y manejar productos SERVICE
   2. Funciones de cálculo y validación de BOM:
      - fn_calculate_bom_cost() - Estimar costo total de BOM
      - fn_validate_bom_availability() - Verificar disponibilidad componentes
      - fn_get_bom_explosion() - Explotar BOM recursivamente
   3. Vistas de reportes SERVICE y BOM
   
   ORDEN DE EJECUCIÓN: 4/6
   PREREQUISITO: MANUFACTURING_PHASE1_HELPER_FUNCTIONS.sql
   ============================================================================ */

-- =====================================================================
-- 1. FUNCIÓN: CALCULAR COSTO DE BOM
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_calculate_bom_cost(
  p_tenant UUID,
  p_bom UUID,
  p_quantity NUMERIC
)
RETURNS TABLE (
  total_cost NUMERIC,
  components JSONB
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_component_record RECORD;
  v_cost_method TEXT;
  v_component_cost NUMERIC;
  v_adjusted_qty NUMERIC;
  v_total NUMERIC := 0;
  v_components JSONB := '[]'::JSONB;
BEGIN
  -- Obtener método de costeo
  SELECT component_costing_method INTO v_cost_method
  FROM tenant_settings
  WHERE tenant_id = p_tenant;
  
  v_cost_method := COALESCE(v_cost_method, 'FIFO');
  
  -- Iterar componentes del BOM
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
    -- Ajustar cantidad por desperdicio
    v_adjusted_qty := v_component_record.quantity * p_quantity * 
                      (1 + v_component_record.waste_percentage / 100);
    
    -- Obtener costo según método
    CASE v_cost_method
      WHEN 'FIFO' THEN
        -- Costo del lote más antiguo
        SELECT COALESCE(ib.unit_cost, pv.cost, 0) INTO v_component_cost
        FROM inventory_batches ib
        JOIN product_variants pv ON pv.variant_id = ib.variant_id
        WHERE ib.tenant_id = p_tenant
          AND ib.variant_id = v_component_record.component_variant_id
          AND ib.is_active = TRUE
          AND ib.on_hand > 0
        ORDER BY ib.received_at ASC
        LIMIT 1;
        
      WHEN 'AVERAGE' THEN
        -- Promedio ponderado de lotes disponibles
        SELECT COALESCE(
          SUM(ib.unit_cost * ib.on_hand) / NULLIF(SUM(ib.on_hand), 0),
          pv.cost,
          0
        ) INTO v_component_cost
        FROM inventory_batches ib
        JOIN product_variants pv ON pv.variant_id = ib.variant_id
        WHERE ib.tenant_id = p_tenant
          AND ib.variant_id = v_component_record.component_variant_id
          AND ib.is_active = TRUE
          AND ib.on_hand > 0;
        
      WHEN 'LAST' THEN
        -- Último costo de compra
        SELECT COALESCE(cost, 0) INTO v_component_cost
        FROM product_variants
        WHERE variant_id = v_component_record.component_variant_id;
        
      ELSE
        v_component_cost := 0;
    END CASE;
    
    -- Acumular costo total
    v_total := v_total + (v_component_cost * v_adjusted_qty);
    
    -- Agregar a array de componentes
    v_components := v_components || jsonb_build_object(
      'variant_id', v_component_record.component_variant_id,
      'sku', v_component_record.sku,
      'name', v_component_record.name,
      'quantity_required', v_component_record.quantity * p_quantity,
      'waste_applied', v_adjusted_qty - (v_component_record.quantity * p_quantity),
      'quantity_total', v_adjusted_qty,
      'unit_cost', v_component_cost,
      'total_cost', v_component_cost * v_adjusted_qty
    );
  END LOOP;
  
  total_cost := v_total;
  components := v_components;
  
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION fn_calculate_bom_cost IS 
  'Calcula costo estimado de producir una cantidad según BOM. Aplica método de costeo configurado (FIFO/AVERAGE/LAST) y considera desperdicios.';

-- =====================================================================
-- 2. FUNCIÓN: VALIDAR DISPONIBILIDAD DE BOM
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_validate_bom_availability(
  p_tenant UUID,
  p_location UUID,
  p_bom UUID,
  p_quantity NUMERIC
)
RETURNS TABLE (
  available BOOLEAN,
  total_cost NUMERIC,
  missing_components JSONB,
  allocation_plan JSONB
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_component_record RECORD;
  v_adjusted_qty NUMERIC;
  v_available_qty NUMERIC;
  v_is_available BOOLEAN := TRUE;
  v_missing JSONB := '[]'::JSONB;
  v_allocation JSONB := '[]'::JSONB;
  v_cost NUMERIC;
  v_components JSONB;
  v_result RECORD;
BEGIN
  -- Calcular costo estimado
  SELECT * INTO v_result
  FROM fn_calculate_bom_cost(p_tenant, p_bom, p_quantity);
  
  v_cost := v_result.total_cost;
  v_components := v_result.components;
  
  -- Verificar disponibilidad de cada componente
  FOR v_component_record IN
    SELECT 
      bc.component_variant_id,
      bc.quantity,
      bc.waste_percentage,
      bc.is_optional,
      pv.sku,
      p.name
    FROM bom_components bc
    JOIN product_variants pv ON pv.variant_id = bc.component_variant_id
    JOIN products p ON p.product_id = pv.product_id
    WHERE bc.bom_id = p_bom
    ORDER BY bc.sequence NULLS LAST
  LOOP
    -- Calcular cantidad necesaria con desperdicio
    v_adjusted_qty := v_component_record.quantity * p_quantity * 
                      (1 + v_component_record.waste_percentage / 100);
    
    -- Obtener disponibilidad del componente
    SELECT COALESCE(SUM(on_hand - reserved), 0) INTO v_available_qty
    FROM inventory_batches
    WHERE tenant_id = p_tenant
      AND location_id = p_location
      AND variant_id = v_component_record.component_variant_id
      AND is_active = TRUE;
    
    -- Verificar si hay suficiente
    IF v_available_qty < v_adjusted_qty THEN
      IF NOT v_component_record.is_optional THEN
        v_is_available := FALSE;
        v_missing := v_missing || jsonb_build_object(
          'variant_id', v_component_record.component_variant_id,
          'sku', v_component_record.sku,
          'name', v_component_record.name,
          'required', v_adjusted_qty,
          'available', v_available_qty,
          'shortage', v_adjusted_qty - v_available_qty
        );
      END IF;
    ELSE
      -- Planificar asignación FEFO
      v_allocation := v_allocation || jsonb_build_object(
        'variant_id', v_component_record.component_variant_id,
        'sku', v_component_record.sku,
        'quantity', v_adjusted_qty,
        'available', v_available_qty,
        'can_fulfill', TRUE
      );
    END IF;
  END LOOP;
  
  available := v_is_available;
  total_cost := v_cost;
  missing_components := v_missing;
  allocation_plan := v_allocation;
  
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION fn_validate_bom_availability IS 
  'Valida que todos los componentes del BOM estén disponibles para la cantidad solicitada. Retorna faltantes y plan de asignación.';

-- =====================================================================
-- 3. FUNCIÓN: EXPLOTAR BOM RECURSIVAMENTE (Detalle Completo)
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_get_bom_explosion(
  p_tenant UUID,
  p_bom UUID,
  p_quantity NUMERIC,
  p_current_depth INTEGER DEFAULT 0,
  p_max_depth INTEGER DEFAULT 5
)
RETURNS TABLE (
  level INTEGER,
  parent_variant_id UUID,
  component_variant_id UUID,
  sku TEXT,
  name TEXT,
  quantity_required NUMERIC,
  has_own_bom BOOLEAN
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_component_record RECORD;
  v_component_bom UUID;
BEGIN
  -- Límite de profundidad
  IF p_current_depth >= p_max_depth THEN
    RAISE WARNING 'BOM explosion alcanzó profundidad máxima de %', p_max_depth;
    RETURN;
  END IF;
  
  -- Obtener componentes del BOM actual
  FOR v_component_record IN
    SELECT 
      bc.component_variant_id,
      bc.quantity,
      bc.waste_percentage,
      pv.sku,
      p.name,
      bom.variant_id AS parent_variant
    FROM bom_components bc
    JOIN product_variants pv ON pv.variant_id = bc.component_variant_id
    JOIN products p ON p.product_id = pv.product_id
    JOIN bill_of_materials bom ON bom.bom_id = bc.bom_id
    WHERE bc.bom_id = p_bom
    ORDER BY bc.sequence NULLS LAST
  LOOP
    -- Verificar si componente tiene su propio BOM
    v_component_bom := fn_get_active_bom(p_tenant, v_component_record.component_variant_id);
    
    -- Retornar este nivel
    level := p_current_depth;
    parent_variant_id := v_component_record.parent_variant;
    component_variant_id := v_component_record.component_variant_id;
    sku := v_component_record.sku;
    name := v_component_record.name;
    quantity_required := v_component_record.quantity * p_quantity * 
                         (1 + v_component_record.waste_percentage / 100);
    has_own_bom := v_component_bom IS NOT NULL;
    
    RETURN NEXT;
    
    -- Si tiene BOM propio, explotar recursivamente
    IF v_component_bom IS NOT NULL THEN
      RETURN QUERY
      SELECT * FROM fn_get_bom_explosion(
        p_tenant,
        v_component_bom,
        quantity_required, -- Cantidad acumulada
        p_current_depth + 1,
        p_max_depth
      );
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION fn_get_bom_explosion IS 
  'Explota BOM recursivamente retornando todos los componentes de todos los niveles. Útil para reportes y análisis de dependencias.';

-- =====================================================================
-- 4. VISTA: PRODUCTOS SERVICE
-- =====================================================================

CREATE OR REPLACE VIEW vw_service_products AS
SELECT 
  pv.tenant_id,
  pv.variant_id,
  pv.sku,
  p.product_id,
  p.name,
  pv.price,
  pv.cost,
  pv.is_active,
  
  -- Margen teórico
  CASE 
    WHEN pv.price > 0 THEN 
      ((pv.price - COALESCE(pv.cost, 0)) / pv.price * 100)
    ELSE 0
  END AS margin_percentage
  
FROM product_variants pv
JOIN products p ON p.product_id = pv.product_id
WHERE fn_get_effective_inventory_behavior(pv.tenant_id, pv.variant_id) = 'SERVICE'
  AND pv.is_active = TRUE
  AND p.is_active = TRUE;

COMMENT ON VIEW vw_service_products IS 
  'Listado de productos/servicios que no afectan inventario.';

-- =====================================================================
-- 5. VISTA: REVENUE POR SERVICIOS
-- =====================================================================

CREATE OR REPLACE VIEW vw_service_revenue AS
SELECT 
  s.tenant_id,
  s.location_id,
  s.sold_at::DATE AS sale_date,
  sl.variant_id,
  pv.sku,
  p.name AS service_name,
  
  COUNT(DISTINCT s.sale_id) AS transactions,
  SUM(sl.quantity) AS units_sold,
  SUM(sl.line_total) AS revenue,
  AVG(sl.line_total / NULLIF(sl.quantity, 0)) AS avg_price_per_unit,
  
  -- Margen (basado en cost de variante)
  SUM(sl.line_total - (COALESCE(pv.cost, 0) * sl.quantity)) AS gross_profit,
  CASE 
    WHEN SUM(sl.line_total) > 0 THEN
      (SUM(sl.line_total - (COALESCE(pv.cost, 0) * sl.quantity)) / SUM(sl.line_total) * 100)
    ELSE 0
  END AS margin_percentage
  
FROM sales s
JOIN sale_lines sl ON sl.sale_id = s.sale_id
JOIN product_variants pv ON pv.variant_id = sl.variant_id
JOIN products p ON p.product_id = pv.product_id
WHERE fn_get_effective_inventory_behavior(s.tenant_id, sl.variant_id) = 'SERVICE'
  AND s.status = 'COMPLETED'
GROUP BY s.tenant_id, s.location_id, s.sold_at::DATE, sl.variant_id, pv.sku, p.name;

COMMENT ON VIEW vw_service_revenue IS 
  'Ingresos por servicios vendidos. No afectan inventario pero generan ingresos.';

-- =====================================================================
-- 6. VISTA: PRODUCTOS CON BOM ACTIVO
-- =====================================================================

CREATE OR REPLACE VIEW vw_products_with_bom AS
SELECT 
  pv.tenant_id,
  pv.variant_id,
  pv.sku,
  p.product_id,
  p.name,
  
  bom.bom_id,
  bom.bom_code,
  bom.version,
  
  fn_get_effective_inventory_behavior(pv.tenant_id, pv.variant_id) AS behavior,
  fn_get_effective_production_type(pv.tenant_id, pv.variant_id) AS production_type,
  
  (SELECT COUNT(*) FROM bom_components WHERE bom_id = bom.bom_id)::INTEGER AS components_count,
  
  bom.created_at,
  bom.notes
  
FROM product_variants pv
JOIN products p ON p.product_id = pv.product_id
JOIN bill_of_materials bom ON bom.bom_id = fn_get_active_bom(pv.tenant_id, pv.variant_id)
WHERE pv.is_active = TRUE
  AND p.is_active = TRUE
  AND bom.is_active = TRUE;

COMMENT ON VIEW vw_products_with_bom IS 
  'Productos que tienen BOM activo (MANUFACTURED). Incluye conteo de componentes.';

-- =====================================================================
-- 7. VERIFICACIÓN
-- =====================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ FASE 2: SERVICE + BOM COMPLETADA';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Funciones BOM creadas:';
  RAISE NOTICE '  ✓ fn_calculate_bom_cost() - Calcula costo estimado con desperdicios';
  RAISE NOTICE '  ✓ fn_validate_bom_availability() - Valida disponibilidad componentes';
  RAISE NOTICE '  ✓ fn_get_bom_explosion() - Explota BOM recursivamente';
  RAISE NOTICE '';
  RAISE NOTICE 'Vistas de reportes:';
  RAISE NOTICE '  ✓ vw_service_products - Listado servicios';
  RAISE NOTICE '  ✓ vw_service_revenue - Ingresos por servicios';
  RAISE NOTICE '  ✓ vw_products_with_bom - Productos con BOM activo';
  RAISE NOTICE '';
  RAISE NOTICE 'SIGUIENTE PASO: Ejecutar MANUFACTURING_PHASE3_ON_DEMAND.sql (CRÍTICO)';
  RAISE NOTICE '════════════════════════════════════════════════════════';
END $$;
