/* ============================================================================
   DIAGNÓSTICO DE LOTES Y COMPRAS
   
   Script para diagnosticar problemas con la integración de lotes en compras
   
   Autor: Sistema
   Fecha: Febrero 2026
   ============================================================================ */

-- =====================================================================
-- 1. VERIFICAR SI EXISTEN LOTES EN LA TABLA
-- =====================================================================

DO $$
DECLARE
  v_total_batches INTEGER;
  v_batches_with_purchases INTEGER;
BEGIN
  -- Contar lotes totales
  SELECT COUNT(*) INTO v_total_batches FROM inventory_batches;
  
  RAISE NOTICE '═══════════════════════════════════════════════';
  RAISE NOTICE '1. VERIFICACIÓN DE LOTES EN inventory_batches';
  RAISE NOTICE '═══════════════════════════════════════════════';
  RAISE NOTICE 'Total de lotes registrados: %', v_total_batches;
  
  -- Mostrar últimos 5 lotes creados
  RAISE NOTICE '';
  RAISE NOTICE 'Últimos 5 lotes creados:';
  
  FOR v_record IN 
    SELECT 
      batch_number,
      expiration_date,
      on_hand,
      received_at,
      notes
    FROM inventory_batches
    ORDER BY received_at DESC
    LIMIT 5
  LOOP
    RAISE NOTICE '  - Lote: % | Vence: % | Stock: % | Creado: % | Nota: %', 
      v_record.batch_number,
      COALESCE(v_record.expiration_date::TEXT, 'Sin vencimiento'),
      v_record.on_hand,
      v_record.received_at,
      COALESCE(v_record.notes, 'Sin nota');
  END LOOP;
  
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 2. VERIFICAR COMPRAS RECIENTES
-- =====================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════';
  RAISE NOTICE '2. VERIFICACIÓN DE COMPRAS RECIENTES';
  RAISE NOTICE '═══════════════════════════════════════════════';
  
  FOR v_record IN 
    SELECT 
      im.inventory_move_id,
      im.source_id AS purchase_id,
      im.created_at,
      im.quantity,
      pv.sku,
      p.name AS product_name,
      im.note
    FROM inventory_moves im
    JOIN product_variants pv ON pv.variant_id = im.variant_id
    JOIN products p ON p.product_id = pv.product_id
    WHERE im.move_type = 'PURCHASE_IN'
    ORDER BY im.created_at DESC
    LIMIT 5
  LOOP
    RAISE NOTICE 'Compra: % | Fecha: % | Producto: % (%) | Cant: % | Nota: %',
      v_record.purchase_id,
      v_record.created_at,
      v_record.product_name,
      v_record.sku,
      v_record.quantity,
      COALESCE(v_record.note, 'Sin nota');
  END LOOP;
  
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 3. VERIFICAR SI stock_balances ESTÁ ACTUALIZADO
-- =====================================================================

DO $$
DECLARE
  v_is_materialized BOOLEAN;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════';
  RAISE NOTICE '3. VERIFICACIÓN DE stock_balances';
  RAISE NOTICE '═══════════════════════════════════════════════';
  
  -- Verificar si es vista materializada o tabla
  SELECT EXISTS(
    SELECT 1 
    FROM pg_matviews 
    WHERE schemaname = 'public' 
      AND matviewname = 'stock_balances'
  ) INTO v_is_materialized;
  
  IF v_is_materialized THEN
    RAISE NOTICE 'stock_balances es una VISTA MATERIALIZADA';
    RAISE NOTICE 'Refrescando vista materializada...';
    REFRESH MATERIALIZED VIEW stock_balances;
    RAISE NOTICE '✓ Vista materializada refrescada';
  ELSE
    RAISE NOTICE 'stock_balances es una TABLA o VISTA normal';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE 'Registros en stock_balances:';
  FOR v_record IN 
    SELECT 
      sb.variant_id,
      sb.on_hand,
      pv.sku,
      p.name AS product_name
    FROM stock_balances sb
    JOIN product_variants pv ON pv.variant_id = sb.variant_id
    JOIN products p ON p.product_id = pv.product_id
    WHERE sb.on_hand > 0
    ORDER BY sb.updated_at DESC
    LIMIT 5
  LOOP
    RAISE NOTICE '  - SKU: % | Producto: % | Stock: %',
      v_record.sku,
      v_record.product_name,
      v_record.on_hand;
  END LOOP;
  
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 4. VERIFICAR FUNCIÓN fn_refresh_stock_balances
-- =====================================================================

DO $$
DECLARE
  v_function_exists BOOLEAN;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════';
  RAISE NOTICE '4. VERIFICACIÓN DE FUNCIONES';
  RAISE NOTICE '═══════════════════════════════════════════════';
  
  -- Verificar si existe fn_refresh_stock_balances
  SELECT EXISTS(
    SELECT 1 
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_refresh_stock_balances'
  ) INTO v_function_exists;
  
  IF v_function_exists THEN
    RAISE NOTICE '✓ fn_refresh_stock_balances existe';
  ELSE
    RAISE NOTICE '✗ fn_refresh_stock_balances NO EXISTE';
  END IF;
  
  -- Verificar si existe fn_generate_batch_number
  SELECT EXISTS(
    SELECT 1 
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_generate_batch_number'
  ) INTO v_function_exists;
  
  IF v_function_exists THEN
    RAISE NOTICE '✓ fn_generate_batch_number existe';
  ELSE
    RAISE NOTICE '✗ fn_generate_batch_number NO EXISTE';
  END IF;
  
  -- Verificar si existe fn_variant_requires_expiration
  SELECT EXISTS(
    SELECT 1 
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_variant_requires_expiration'
  ) INTO v_function_exists;
  
  IF v_function_exists THEN
    RAISE NOTICE '✓ fn_variant_requires_expiration existe';
  ELSE
    RAISE NOTICE '✗ fn_variant_requires_expiration NO EXISTE';
  END IF;
  
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 5. VERIFICAR PROCEDIMIENTO sp_create_purchase
-- =====================================================================

DO $$
DECLARE
  v_procedure_exists BOOLEAN;
  v_procedure_source TEXT;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════';
  RAISE NOTICE '5. VERIFICACIÓN DE sp_create_purchase';
  RAISE NOTICE '═══════════════════════════════════════════════';
  
  SELECT EXISTS(
    SELECT 1 
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'sp_create_purchase'
  ) INTO v_procedure_exists;
  
  IF v_procedure_exists THEN
    RAISE NOTICE '✓ sp_create_purchase existe';
    
    -- Ver si contiene lógica de lotes
    SELECT pg_get_functiondef(p.oid) INTO v_procedure_source
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'sp_create_purchase';
    
    IF v_procedure_source LIKE '%inventory_batches%' THEN
      RAISE NOTICE '✓ sp_create_purchase incluye lógica de lotes';
    ELSE
      RAISE NOTICE '✗ sp_create_purchase NO incluye lógica de lotes (debe actualizarse)';
    END IF;
    
    IF v_procedure_source LIKE '%batch_number%' THEN
      RAISE NOTICE '✓ sp_create_purchase maneja batch_number';
    ELSE
      RAISE NOTICE '✗ sp_create_purchase NO maneja batch_number';
    END IF;
    
    IF v_procedure_source LIKE '%expiration_date%' THEN
      RAISE NOTICE '✓ sp_create_purchase maneja expiration_date';
    ELSE
      RAISE NOTICE '✗ sp_create_purchase NO maneja expiration_date';
    END IF;
    
  ELSE
    RAISE NOTICE '✗ sp_create_purchase NO EXISTE';
  END IF;
  
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 6. CORRELACIÓN COMPRAS vs LOTES
-- =====================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════';
  RAISE NOTICE '6. CORRELACIÓN COMPRAS vs LOTES';
  RAISE NOTICE '═══════════════════════════════════════════════';
  
  -- Buscar compras que deberían tener lotes pero no los tienen
  FOR v_record IN 
    WITH recent_purchases AS (
      SELECT DISTINCT
        im.source_id AS purchase_id,
        im.variant_id,
        im.created_at,
        pv.sku,
        p.name AS product_name,
        COALESCE(p.requires_expiration, FALSE) AS requires_expiration
      FROM inventory_moves im
      JOIN product_variants pv ON pv.variant_id = im.variant_id
      JOIN products p ON p.product_id = pv.product_id
      WHERE im.move_type = 'PURCHASE_IN'
        AND im.created_at >= CURRENT_DATE - INTERVAL '7 days'
    )
    SELECT 
      rp.*,
      COUNT(ib.batch_id) AS num_batches
    FROM recent_purchases rp
    LEFT JOIN inventory_batches ib ON ib.variant_id = rp.variant_id
      AND ib.received_at >= rp.created_at - INTERVAL '1 minute'
      AND ib.received_at <= rp.created_at + INTERVAL '1 minute'
    GROUP BY rp.purchase_id, rp.variant_id, rp.created_at, rp.sku, rp.product_name, rp.requires_expiration
    ORDER BY rp.created_at DESC
    LIMIT 10
  LOOP
    IF v_record.num_batches = 0 THEN
      RAISE NOTICE '⚠ Compra sin lote: % | Producto: % (%) | Requiere venc: % | Fecha: %',
        v_record.purchase_id,
        v_record.product_name,
        v_record.sku,
        v_record.requires_expiration,
        v_record.created_at;
    ELSE
      RAISE NOTICE '✓ Compra con lote: % | Producto: % (%) | Lotes: % | Fecha: %',
        v_record.purchase_id,
        v_record.product_name,
        v_record.sku,
        v_record.num_batches,
        v_record.created_at;
    END IF;
  END LOOP;
  
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- RESUMEN Y RECOMENDACIONES
-- =====================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════';
  RAISE NOTICE 'RESUMEN Y RECOMENDACIONES';
  RAISE NOTICE '═══════════════════════════════════════════════';
  RAISE NOTICE 'Si no ves lotes en el módulo BatchManagement:';
  RAISE NOTICE '';
  RAISE NOTICE '1. Verifica que sp_create_purchase incluya lógica de lotes';
  RAISE NOTICE '   → Ejecuta INTEGRATE_BATCHES_WITH_PURCHASES.sql';
  RAISE NOTICE '';
  RAISE NOTICE '2. Verifica que el producto tenga requires_expiration=true';
  RAISE NOTICE '   → Edita el producto y activa "Requiere control de vencimiento"';
  RAISE NOTICE '';
  RAISE NOTICE '3. Asegúrate de completar el campo fecha de vencimiento';
  RAISE NOTICE '   → Al registrar la compra, llena la fecha de vencimiento';
  RAISE NOTICE '';
  RAISE NOTICE '4. Refresca stock_balances si es vista materializada:';
  RAISE NOTICE '   → REFRESH MATERIALIZED VIEW stock_balances;';
  RAISE NOTICE '';
END;
$$ LANGUAGE plpgsql;
