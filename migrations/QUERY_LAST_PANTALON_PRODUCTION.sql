/* ============================================================================
   QUERY: Analizar última producción de Pantalón Verde Almirante
   ============================================================================
   
   Muestra el detalle completo de costos de la última producción para
   entender la diferencia entre costo teórico BOM y costo real.
   
   Ejecutar: psql -U postgres -d pos_lite -f "migrations/QUERY_LAST_PANTALON_PRODUCTION.sql"
   ============================================================================ */

-- 1. INFORMACIÓN DE LA ÚLTIMA ORDEN DE PRODUCCIÓN
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '📋 ÚLTIMA PRODUCCIÓN: Pantalón Verde Almirante';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;

SELECT 
  po.order_number,
  po.status,
  po.quantity_planned,
  po.quantity_produced,
  po.actual_cost AS costo_total_real,
  ROUND(po.actual_cost / NULLIF(po.quantity_produced, 0), 2) AS costo_unitario_real,
  po.created_at,
  po.completed_at,
  bom.bom_code,
  bom.bom_name
FROM production_orders po
JOIN bill_of_materials bom ON bom.bom_id = po.bom_id
WHERE po.product_variant_id = (
  SELECT variant_id 
  FROM product_variants 
  WHERE sku = 'PAN-260219-3535'
)
ORDER BY po.created_at DESC
LIMIT 1;

-- 2. COMPONENTES TEÓRICOS DEL BOM (lo que dice el BOM)
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '💡 COMPONENTES BOM (Costo Teórico Actual)';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;

SELECT 
  COALESCE(p.name, 'SIN NOMBRE') AS componente,
  pv.sku,
  bc.quantity_required AS cantidad_requerida,
  pv.cost AS costo_unitario_actual,
  ROUND(bc.quantity_required * pv.cost, 2) AS costo_total_teorico,
  u.code AS unidad
FROM bom_components bc
JOIN product_variants pv ON pv.variant_id = bc.component_variant_id
JOIN products p ON p.product_id = pv.product_id
LEFT JOIN units_of_measure u ON u.unit_id = pv.unit_id
WHERE bc.bom_id = (
  SELECT bom_id 
  FROM bill_of_materials 
  WHERE (product_id = (SELECT product_id FROM product_variants WHERE sku = 'PAN-260219-3535')
         OR variant_id = (SELECT variant_id FROM product_variants WHERE sku = 'PAN-260219-3535'))
    AND is_active = TRUE
  LIMIT 1
)
ORDER BY p.name;

-- 3. COSTO TEÓRICO TOTAL DEL BOM
DO $$
DECLARE
  v_theoretical_cost NUMERIC;
BEGIN
  SELECT SUM(bc.quantity_required * pv.cost)
  INTO v_theoretical_cost
  FROM bom_components bc
  JOIN product_variants pv ON pv.variant_id = bc.component_variant_id
  WHERE bc.bom_id = (
    SELECT bom_id 
    FROM bill_of_materials 
    WHERE (product_id = (SELECT product_id FROM product_variants WHERE sku = 'PAN-260219-3535')
           OR variant_id = (SELECT variant_id FROM product_variants WHERE sku = 'PAN-260219-3535'))
      AND is_active = TRUE
    LIMIT 1
  );
  
  RAISE NOTICE '';
  RAISE NOTICE '💰 COSTO TEÓRICO TOTAL BOM: $%', ROUND(v_theoretical_cost, 2);
  RAISE NOTICE '';
END $$;

-- 4. COMPONENTES REALMENTE CONSUMIDOS (Última Producción Real)
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '🔨 COMPONENTES CONSUMIDOS (Última Producción Real)';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;

SELECT 
  COALESCE(p.name, 'SIN NOMBRE') AS componente,
  pv.sku,
  pol.quantity_consumed AS cantidad_consumida,
  pol.unit_cost AS costo_unitario_consumido,
  ROUND(pol.quantity_consumed * pol.unit_cost, 2) AS costo_total_consumido,
  ib.batch_number AS lote_consumido,
  ib.received_at AS fecha_lote
FROM production_order_lines pol
JOIN product_variants pv ON pv.variant_id = pol.component_variant_id
JOIN products p ON p.product_id = pv.product_id
LEFT JOIN inventory_batches ib ON ib.batch_id = pol.batch_id
WHERE pol.production_order_id = (
  SELECT production_order_id
  FROM production_orders
  WHERE product_variant_id = (
    SELECT variant_id 
    FROM product_variants 
    WHERE sku = 'PAN-260219-3535'
  )
  ORDER BY created_at DESC
  LIMIT 1
)
ORDER BY p.name;

-- 5. RESUMEN COMPARATIVO
DO $$
DECLARE
  v_theoretical_cost NUMERIC;
  v_real_cost NUMERIC;
  v_difference NUMERIC;
  v_percentage NUMERIC;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '📊 RESUMEN COMPARATIVO';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  
  -- Costo teórico
  SELECT SUM(bc.quantity_required * pv.cost)
  INTO v_theoretical_cost
  FROM bom_components bc
  JOIN product_variants pv ON pv.variant_id = bc.component_variant_id
  WHERE bc.bom_id = (
    SELECT bom_id 
    FROM bill_of_materials 
    WHERE (product_id = (SELECT product_id FROM product_variants WHERE sku = 'PAN-260219-3535')
           OR variant_id = (SELECT variant_id FROM product_variants WHERE sku = 'PAN-260219-3535'))
      AND is_active = TRUE
    LIMIT 1
  );
  
  -- Costo real última producción
  SELECT actual_cost
  INTO v_real_cost
  FROM production_orders
  WHERE product_variant_id = (
    SELECT variant_id 
    FROM product_variants 
    WHERE sku = 'PAN-260219-3535'
  )
  ORDER BY created_at DESC
  LIMIT 1;
  
  v_difference := v_theoretical_cost - v_real_cost;
  v_percentage := (v_difference / NULLIF(v_real_cost, 0)) * 100;
  
  RAISE NOTICE '';
  RAISE NOTICE '  💡 Costo Teórico (BOM actual):     $%', ROUND(v_theoretical_cost, 2);
  RAISE NOTICE '  🔨 Costo Real (última producción): $%', ROUND(v_real_cost, 2);
  RAISE NOTICE '  📈 Diferencia:                     $% (%.1f%%)', 
    ROUND(v_difference, 2), ABS(ROUND(v_percentage, 1));
  RAISE NOTICE '';
  
  IF v_difference > 0 THEN
    RAISE NOTICE '  ⚠️  El costo teórico es MAYOR que el real';
    RAISE NOTICE '      Posibles causas:';
    RAISE NOTICE '      • Los costos de los componentes aumentaron desde la última producción';
    RAISE NOTICE '      • Se consumieron lotes antiguos más baratos (FEFO)';
    RAISE NOTICE '      • Hay un error en los costos actuales de los componentes';
  ELSE
    RAISE NOTICE '  ✅ El costo real es MAYOR que el teórico';
    RAISE NOTICE '      Posibles causas:';
    RAISE NOTICE '      • Se consumieron lotes más caros';
    RAISE NOTICE '      • Los costos actuales en el BOM están desactualizados';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;

-- 6. VERIFICAR COSTOS ACTUALES DE COMPONENTES
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '🔍 VERIFICAR: Componentes con costos sospechosos';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;

SELECT 
  COALESCE(p.name, 'SIN NOMBRE') AS componente,
  pv.sku,
  pv.cost AS costo_actual,
  pv.price AS precio_venta,
  CASE 
    WHEN pv.cost > 10000 THEN '⚠️  COSTO MUY ALTO' 
    WHEN pv.cost = 0 THEN '⚠️  COSTO EN CERO'
    ELSE '✅ OK'
  END AS verificacion
FROM bom_components bc
JOIN product_variants pv ON pv.variant_id = bc.component_variant_id
JOIN products p ON p.product_id = pv.product_id
WHERE bc.bom_id = (
  SELECT bom_id 
  FROM bill_of_materials 
  WHERE (product_id = (SELECT product_id FROM product_variants WHERE sku = 'PAN-260219-3535')
         OR variant_id = (SELECT variant_id FROM product_variants WHERE sku = 'PAN-260219-3535'))
    AND is_active = TRUE
  LIMIT 1
)
ORDER BY pv.cost DESC;
