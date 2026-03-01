/* ============================================================================
   DIAGNÓSTICO: Diferencia entre Costo Teórico BOM vs Costo Real Producción
   
   Muestra para cada BOM:
   - Costo teórico (usando product_variants.cost actual)
   - Costo real promedio de lotes en stock (inventory_batches.unit_cost)
   - Diferencia entre ambos
   
   Esto explica por qué el costo de producción puede ser menor al esperado
   si los lotes consumidos tienen costos antiguos más bajos.
   ============================================================================ */

DO $$
DECLARE
  v_bom RECORD;
  v_component RECORD;
  v_theoretical_cost NUMERIC;
  v_real_avg_cost NUMERIC;
  v_bom_count INT;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════════════════';
  RAISE NOTICE '📊 ANÁLISIS: Costo Teórico BOM vs Costo Real de Lotes en Stock';
  RAISE NOTICE '════════════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  
  -- Verificar cuántos BOMs hay
  SELECT COUNT(*) INTO v_bom_count
  FROM bill_of_materials
  WHERE is_active = TRUE;
  
  RAISE NOTICE 'BOMs activos encontrados: %', v_bom_count;
  
  IF v_bom_count = 0 THEN
    SELECT COUNT(*) INTO v_bom_count FROM bill_of_materials;
    RAISE NOTICE 'Total BOMs (incluyendo inactivos): %', v_bom_count;
    
    IF v_bom_count = 0 THEN
      RAISE NOTICE '⚠️  No hay BOMs registrados en la base de datos.';
      RAISE NOTICE 'Crea al menos un BOM para ver el análisis de costos.';
      RETURN;
    ELSE
      RAISE NOTICE '⚠️  Hay BOMs pero ninguno está activo (is_active=TRUE).';
      RAISE NOTICE 'Activando BOMs para análisis...';
      RAISE NOTICE '';
    END IF;
  END IF;
  
  RAISE NOTICE '';
  
  -- Iterar cada BOM (activo o no)
  FOR v_bom IN
    SELECT 
      bom.bom_id,
      bom.bom_code,
      bom.version,
      bom.is_active,
      COALESCE(p.name, pv2.variant_name, 'Producto sin nombre') AS product_name,
      COALESCE(pv1.sku, pv2.sku, 'N/A') AS sku
    FROM bill_of_materials bom
    LEFT JOIN products p ON p.product_id = bom.product_id
    LEFT JOIN product_variants pv1 ON pv1.product_id = bom.product_id AND pv1.variant_id IS NULL
    LEFT JOIN product_variants pv2 ON pv2.variant_id = bom.variant_id
    ORDER BY bom.is_active DESC, p.name, bom.bom_code
  LOOP
    RAISE NOTICE '';
    RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
    RAISE NOTICE 'BOM: % v% - % %', 
      v_bom.bom_code, 
      v_bom.version, 
      v_bom.product_name,
      CASE WHEN v_bom.is_active THEN '✅' ELSE '❌ INACTIVO' END;
    RAISE NOTICE 'SKU: %', v_bom.sku;
    RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
    RAISE NOTICE '';
    
    v_theoretical_cost := 0;
    v_real_avg_cost := 0;
    
    -- Contar componentes del BOM
    DECLARE
      v_component_count INT;
    BEGIN
      SELECT COUNT(*) INTO v_component_count
      FROM bom_components
      WHERE bom_id = v_bom.bom_id AND is_optional = FALSE;
      
      RAISE NOTICE 'Componentes: %', v_component_count;
      RAISE NOTICE '';
      
      IF v_component_count = 0 THEN
        RAISE NOTICE '⚠️  Este BOM no tiene componentes registrados.';
        RAISE NOTICE '';
        CONTINUE;
      END IF;
    END;
    
    -- Analizar cada componente del BOM
    FOR v_component IN
      SELECT 
        bc.quantity,
        bc.waste_percentage,
        p.name AS component_name,
        pv.sku AS component_sku,
        pv.cost AS current_cost,  -- Costo actual registrado
        
        -- Costo promedio ponderado de lotes en stock
        (SELECT 
          CASE 
            WHEN SUM(ib.on_hand) > 0 
            THEN SUM(ib.on_hand * ib.unit_cost) / SUM(ib.on_hand)
            ELSE 0 
          END
         FROM inventory_batches ib
         WHERE ib.variant_id = bc.component_variant_id
           AND ib.is_active = TRUE
           AND ib.on_hand > 0
        ) AS avg_batch_cost,
        
        -- Stock total disponible
        (SELECT COALESCE(SUM(ib.on_hand - ib.reserved), 0)
         FROM inventory_batches ib
         WHERE ib.variant_id = bc.component_variant_id
           AND ib.is_active = TRUE
        ) AS stock_available
        
      FROM bom_components bc
      JOIN product_variants pv ON pv.variant_id = bc.component_variant_id
      JOIN products p ON p.product_id = pv.product_id
      WHERE bc.bom_id = v_bom.bom_id
        AND bc.is_optional = FALSE
      ORDER BY bc.sequence NULLS LAST
    LOOP
      DECLARE
        v_qty_with_waste NUMERIC;
        v_theoretical_line NUMERIC;
        v_real_line NUMERIC;
      BEGIN
        -- Cantidad ajustada por waste
        v_qty_with_waste := v_component.quantity * (1 + v_component.waste_percentage / 100);
        
        -- Costo teórico (usando cost actual de variante)
        v_theoretical_line := v_qty_with_waste * v_component.current_cost;
        v_theoretical_cost := v_theoretical_cost + v_theoretical_line;
        
        -- Costo real (usando promedio de lotes en stock)
        v_real_line := v_qty_with_waste * COALESCE(v_component.avg_batch_cost, v_component.current_cost);
        v_real_avg_cost := v_real_avg_cost + v_real_line;
        
        -- Mostrar componente
        RAISE NOTICE '  • % (%)', v_component.component_name, v_component.component_sku;
        RAISE NOTICE '    Cantidad: % (+ % waste = %)', 
          v_component.quantity, 
          v_component.waste_percentage, 
          ROUND(v_qty_with_waste, 3);
        RAISE NOTICE '    Cost registrado: $%', ROUND(v_component.current_cost, 2);
        RAISE NOTICE '    Cost promedio lotes: $%', ROUND(COALESCE(v_component.avg_batch_cost, 0), 2);
        RAISE NOTICE '    Stock disponible: % uds', ROUND(v_component.stock_available, 2);
        RAISE NOTICE '    Subtotal teórico: $%', ROUND(v_theoretical_line, 2);
        RAISE NOTICE '    Subtotal real: $%', ROUND(v_real_line, 2);
        
        IF COALESCE(v_component.avg_batch_cost, 0) != v_component.current_cost THEN
          RAISE NOTICE '    ⚠️  DIFERENCIA: $%', 
            ROUND(ABS(v_theoretical_line - v_real_line), 2);
        END IF;
        
        RAISE NOTICE '';
      END;
    END LOOP;
    
    -- Resumen del BOM
    RAISE NOTICE '─────────────────────────────────────────────────────────────────';
    RAISE NOTICE 'COSTO TEÓRICO (usando cost actual): $%', ROUND(v_theoretical_cost, 2);
    RAISE NOTICE 'COSTO REAL (usando lotes stock):    $%', ROUND(v_real_avg_cost, 2);
    RAISE NOTICE '─────────────────────────────────────────────────────────────────';
    
    IF v_theoretical_cost != v_real_avg_cost THEN
      RAISE NOTICE '⚠️  DIFERENCIA: $% (%)',
        ROUND(ABS(v_theoretical_cost - v_real_avg_cost), 2),
        CASE 
          WHEN v_theoretical_cost > 0 
          THEN ROUND((v_theoretical_cost - v_real_avg_cost) / v_theoretical_cost * 100, 1) || '%'
          ELSE 'N/A'
        END;
    END IF;
  END LOOP;
  
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════════════════';
  RAISE NOTICE '💡 EXPLICACIÓN:';
  RAISE NOTICE '';
  RAISE NOTICE 'El costo TEÓRICO usa product_variants.cost (costo actual registrado).';
  RAISE NOTICE 'El costo REAL usa inventory_batches.unit_cost (costo de lotes en stock).';
  RAISE NOTICE '';
  RAISE NOTICE 'Si los lotes en stock son antiguos con costos más bajos, el costo real';
  RAISE NOTICE 'de producción será menor al teórico.';
  RAISE NOTICE '';
  RAISE NOTICE '✅ Esto es CORRECTO contablemente (método FEFO/FIFO).';
  RAISE NOTICE '';
  RAISE NOTICE '🔍 CONSULTAS ÚTILES:';
  RAISE NOTICE '';
  RAISE NOTICE '  -- Ver todos los BOMs:';
  RAISE NOTICE '  SELECT bom_id, bom_code, version, is_active, product_id, variant_id';
  RAISE NOTICE '  FROM bill_of_materials;';
  RAISE NOTICE '';
  RAISE NOTICE '  -- Ver componentes de un BOM específico:';
  RAISE NOTICE '  SELECT bc.*, pv.sku, p.name';
  RAISE NOTICE '  FROM bom_components bc';
  RAISE NOTICE '  JOIN product_variants pv ON pv.variant_id = bc.component_variant_id';
  RAISE NOTICE '  JOIN products p ON p.product_id = pv.product_id';
  RAISE NOTICE '  WHERE bc.bom_id = ''<tu-bom-id>'';';
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;
