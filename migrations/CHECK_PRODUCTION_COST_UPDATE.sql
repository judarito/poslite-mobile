/* ============================================================================
   DIAGNÓSTICO: Verificar si fn_complete_production actualiza cost/price
   ============================================================================
   
   Verifica si la función fn_complete_production incluye la lógica para
   actualizar automáticamente cost y price de product_variants al completar
   una orden de producción.
   
   Ejecutar: psql -U postgres -d pos_lite -f "migrations/CHECK_PRODUCTION_COST_UPDATE.sql"
   ============================================================================ */

DO $$
DECLARE
  v_function_exists BOOLEAN;
  v_function_source TEXT;
  v_has_cost_update BOOLEAN := FALSE;
  v_has_price_update BOOLEAN := FALSE;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '🔍 Verificando función fn_complete_production';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  
  -- Verificar si existe la función
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_complete_production'
  ) INTO v_function_exists;
  
  IF NOT v_function_exists THEN
    RAISE NOTICE '❌ La función fn_complete_production NO EXISTE';
    RAISE NOTICE '   → Ejecutar: migrations/MANUFACTURING_PHASE456_FINAL.sql';
    RETURN;
  END IF;
  
  RAISE NOTICE '✅ La función fn_complete_production existe';
  RAISE NOTICE '';
  
  -- Obtener código fuente de la función
  SELECT pg_get_functiondef(p.oid)
  INTO v_function_source
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'fn_complete_production';
  
  -- Verificar si actualiza cost
  v_has_cost_update := v_function_source LIKE '%UPDATE product_variants%SET%cost%=%v_unit_cost%';
  
  -- Verificar si actualiza price
  v_has_price_update := v_function_source LIKE '%price%=%v_new_price%' OR
                        v_function_source LIKE '%price%=%fn_calculate_price%';
  
  RAISE NOTICE '🔍 ANÁLISIS DE LA FUNCIÓN:';
  RAISE NOTICE '';
  
  IF v_has_cost_update THEN
    RAISE NOTICE '  ✅ Actualiza COST de product_variants';
  ELSE
    RAISE NOTICE '  ❌ NO actualiza COST de product_variants';
  END IF;
  
  IF v_has_price_update THEN
    RAISE NOTICE '  ✅ Actualiza PRICE de product_variants';
  ELSE
    RAISE NOTICE '  ❌ NO actualiza PRICE de product_variants';
  END IF;
  
  RAISE NOTICE '';
  
  IF NOT v_has_cost_update OR NOT v_has_price_update THEN
    RAISE NOTICE '════════════════════════════════════════════════════════';
    RAISE NOTICE '⚠️  ACCIÓN REQUERIDA:';
    RAISE NOTICE '════════════════════════════════════════════════════════';
    RAISE NOTICE '';
    RAISE NOTICE '  La función fn_complete_production NO está actualizada.';
    RAISE NOTICE '  Ejecutar el siguiente comando para corregir:';
    RAISE NOTICE '';
    RAISE NOTICE '  psql -U postgres -d pos_lite -f "migrations/FIX_MANUFACTURED_COST_PRICE_AUTO_UPDATE.sql"';
    RAISE NOTICE '';
  ELSE
    RAISE NOTICE '════════════════════════════════════════════════════════';
    RAISE NOTICE '✅ La función está actualizada correctamente';
    RAISE NOTICE '════════════════════════════════════════════════════════';
  END IF;
  
  RAISE NOTICE '';
END $$;

-- Mostrar un ejemplo de producto manufacturado con sus costos actuales
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '📊 Ejemplo: Productos manufacturados y sus costos actuales';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;

SELECT 
  pv.sku,
  p.name AS producto,
  pv.variant_name,
  pv.cost AS costo_actual,
  pv.price AS precio_actual,
  (SELECT COUNT(*) 
   FROM production_orders po 
   WHERE po.product_variant_id = pv.variant_id 
     AND po.status = 'COMPLETED'
  ) AS producciones_completadas,
  (SELECT ROUND(AVG(unit_cost), 2)
   FROM production_outputs pout
   JOIN production_orders po ON po.production_order_id = pout.production_order_id
   WHERE po.product_variant_id = pv.variant_id
  ) AS costo_promedio_produccion
FROM product_variants pv
JOIN products p ON p.product_id = pv.product_id
WHERE p.inventory_behavior = 'MANUFACTURED'
  AND pv.is_active = TRUE
ORDER BY p.name, pv.variant_name
LIMIT 10;
