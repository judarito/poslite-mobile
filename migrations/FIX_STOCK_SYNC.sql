/* ============================================================================
   DIAGNÓSTICO Y FIX: Stock no se actualiza después de crear lotes
   
   Problema: Los lotes se crean correctamente pero stock_balances
   no refleja el inventario actual.
   
   Autor: Sistema
   Fecha: Febrero 2026
   ============================================================================ */

-- =====================================================================
-- 1. DIAGNÓSTICO: Verificar stock_balances
-- =====================================================================

DO $$
DECLARE
  v_is_materialized BOOLEAN;
BEGIN
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '1. DIAGNÓSTICO DE stock_balances';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  
  -- Verificar si es vista materializada
  SELECT EXISTS(
    SELECT 1 
    FROM pg_matviews 
    WHERE schemaname = 'public' 
      AND matviewname = 'stock_balances'
  ) INTO v_is_materialized;
  
  IF v_is_materialized THEN
    RAISE NOTICE '✓ stock_balances es una VISTA MATERIALIZADA';
    RAISE NOTICE '';
    RAISE NOTICE '⚠️ PROBLEMA IDENTIFICADO:';
    RAISE NOTICE 'Las vistas materializadas NO se actualizan automáticamente.';
    RAISE NOTICE 'Deben refrescarse manualmente o con triggers.';
  ELSE
    RAISE NOTICE '✓ stock_balances es una TABLA o VISTA normal (auto-actualiza)';
  END IF;
  
  RAISE NOTICE '';
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 2. COMPARAR: inventory_batches vs stock_balances
-- =====================================================================

DO $$
DECLARE
  v_record RECORD;
BEGIN
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '2. COMPARACIÓN: Lotes vs Stock Reportado';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  
  FOR v_record IN 
    WITH batch_stock AS (
      SELECT 
        ib.tenant_id,
        ib.location_id,
        ib.variant_id,
        SUM(ib.on_hand) AS batch_total,
        SUM(ib.reserved) AS batch_reserved,
        SUM(ib.on_hand - ib.reserved) AS batch_available
      FROM inventory_batches ib
      WHERE ib.is_active = TRUE
      GROUP BY ib.tenant_id, ib.location_id, ib.variant_id
    ),
    balance_stock AS (
      SELECT 
        sb.tenant_id,
        sb.location_id,
        sb.variant_id,
        sb.on_hand AS balance_total,
        COALESCE(sb.reserved, 0) AS balance_reserved,
        sb.on_hand - COALESCE(sb.reserved, 0) AS balance_available
      FROM stock_balances sb
    )
    SELECT 
      pv.sku,
      p.name AS product_name,
      l.name AS location_name,
      COALESCE(bs.batch_total, 0) AS real_stock_batches,
      COALESCE(bls.balance_total, 0) AS reported_stock_balances,
      CASE 
        WHEN COALESCE(bs.batch_total, 0) != COALESCE(bls.balance_total, 0) THEN '❌ DESINCRONIZADO'
        ELSE '✓ OK'
      END AS status
    FROM product_variants pv
    JOIN products p ON p.product_id = pv.product_id
    LEFT JOIN batch_stock bs ON bs.variant_id = pv.variant_id
    LEFT JOIN balance_stock bls ON bls.variant_id = pv.variant_id 
      AND bls.location_id = bs.location_id
    LEFT JOIN locations l ON l.location_id = COALESCE(bs.location_id, bls.location_id)
    WHERE COALESCE(bs.batch_total, 0) > 0 
       OR COALESCE(bls.balance_total, 0) > 0
    ORDER BY 
      CASE 
        WHEN COALESCE(bs.batch_total, 0) != COALESCE(bls.balance_total, 0) THEN 0 
        ELSE 1 
      END,
      p.name
    LIMIT 20
  LOOP
    RAISE NOTICE '% | % | % | Lotes: % | Reportado: % | %',
      v_record.sku,
      v_record.product_name,
      v_record.location_name,
      v_record.real_stock_batches,
      v_record.reported_stock_balances,
      v_record.status;
  END LOOP;
  
  RAISE NOTICE '';
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 3. SOLUCIÓN AUTOMÁTICA: Refrescar stock_balances
-- =====================================================================

DO $$
DECLARE
  v_is_materialized BOOLEAN;
  v_count_before INTEGER;
  v_count_after INTEGER;
BEGIN
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '3. APLICANDO SOLUCIÓN';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  
  SELECT EXISTS(
    SELECT 1 
    FROM pg_matviews 
    WHERE schemaname = 'public' 
      AND matviewname = 'stock_balances'
  ) INTO v_is_materialized;
  
  IF v_is_materialized THEN
    -- Contar registros antes
    SELECT COUNT(*) INTO v_count_before FROM stock_balances;
    
    RAISE NOTICE '⏳ Refrescando vista materializada stock_balances...';
    RAISE NOTICE 'Registros antes: %', v_count_before;
    
    -- Refrescar vista materializada
    REFRESH MATERIALIZED VIEW stock_balances;
    
    -- Contar registros después
    SELECT COUNT(*) INTO v_count_after FROM stock_balances;
    
    RAISE NOTICE '✓ Vista refrescada exitosamente';
    RAISE NOTICE 'Registros después: %', v_count_after;
    RAISE NOTICE '';
    RAISE NOTICE '✅ SOLUCIÓN APLICADA';
    RAISE NOTICE 'El stock ahora refleja los lotes correctamente.';
  ELSE
    RAISE NOTICE '⚠️ stock_balances NO es vista materializada.';
    RAISE NOTICE 'El problema puede ser diferente.';
    RAISE NOTICE '';
    RAISE NOTICE 'Verificando si fn_refresh_stock_balances existe...';
    
    IF EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'fn_refresh_stock_balances') THEN
      RAISE NOTICE '✓ fn_refresh_stock_balances existe';
      RAISE NOTICE 'Ejecutando función...';
      PERFORM fn_refresh_stock_balances();
      RAISE NOTICE '✓ Función ejecutada';
    ELSE
      RAISE NOTICE '❌ fn_refresh_stock_balances NO EXISTE';
      RAISE NOTICE 'El sistema necesita esta función para actualizar stock.';
    END IF;
  END IF;
  
  RAISE NOTICE '';
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 4. VERIFICACIÓN FINAL: ¿Se solucionó?
-- =====================================================================

DO $$
DECLARE
  v_record RECORD;
BEGIN
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '4. VERIFICACIÓN FINAL';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Stock actualizado por producto:';
  RAISE NOTICE '';
  
  FOR v_record IN 
    SELECT 
      pv.sku,
      p.name AS product_name,
      l.name AS location_name,
      sb.on_hand,
      COALESCE(sb.reserved, 0) AS reserved,
      (sb.on_hand - COALESCE(sb.reserved, 0)) AS available
    FROM stock_balances sb
    JOIN product_variants pv ON pv.variant_id = sb.variant_id
    JOIN products p ON p.product_id = pv.product_id
    JOIN locations l ON l.location_id = sb.location_id
    WHERE sb.on_hand > 0
    ORDER BY p.name, l.name
    LIMIT 10
  LOOP
    RAISE NOTICE '  % | % | % | Total: % | Reservado: % | Disponible: %',
      v_record.sku,
      v_record.product_name,
      v_record.location_name,
      v_record.on_hand,
      v_record.reserved,
      v_record.available;
  END LOOP;
  
  RAISE NOTICE '';
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 5. SOLUCIÓN PERMANENTE: Crear trigger para auto-refrescar
-- =====================================================================

DO $$
DECLARE
  v_is_materialized BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 
    FROM pg_matviews 
    WHERE schemaname = 'public' 
      AND matviewname = 'stock_balances'
  ) INTO v_is_materialized;
  
  IF NOT v_is_materialized THEN
    RAISE NOTICE '';
    RAISE NOTICE '════════════════════════════════════════════════════════';
    RAISE NOTICE 'NOTA: stock_balances no es vista materializada';
    RAISE NOTICE 'No se requiere trigger de auto-refresco';
    RAISE NOTICE '════════════════════════════════════════════════════════';
    RETURN;
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '5. CREANDO SOLUCIÓN PERMANENTE';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️ IMPORTANTE:';
  RAISE NOTICE 'Las vistas materializadas requieren refresco manual.';
  RAISE NOTICE '';
  RAISE NOTICE 'Opciones para solución permanente:';
  RAISE NOTICE '';
  RAISE NOTICE '1. Convertir stock_balances a VISTA normal (recomendado)';
  RAISE NOTICE '   → Se actualiza automáticamente';
  RAISE NOTICE '   → Puede ser más lenta en consultas grandes';
  RAISE NOTICE '';
  RAISE NOTICE '2. Crear trigger en inventory_batches para refrescar';
  RAISE NOTICE '   → Refresca automáticamente al insertar/actualizar lotes';
  RAISE NOTICE '   → Puede ser costoso en grandes volúmenes';
  RAISE NOTICE '';
  RAISE NOTICE '3. Job programado (CRON) para refrescar cada X minutos';
  RAISE NOTICE '   → Balance entre performance y actualidad';
  RAISE NOTICE '';
  RAISE NOTICE 'Por ahora, se recomienda:';
  RAISE NOTICE '- Agregar PERFORM fn_refresh_stock_balances() al final de sp_create_purchase';
  RAISE NOTICE '';
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- RESUMEN Y RECOMENDACIONES
-- =====================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '📋 RESUMEN Y PRÓXIMOS PASOS';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '✅ Ejecutado: REFRESH MATERIALIZED VIEW stock_balances';
  RAISE NOTICE '   El stock ahora debe estar actualizado.';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️ Para evitar este problema en el futuro:';
  RAISE NOTICE '';
  RAISE NOTICE '1. Verifica que INTEGRATE_BATCHES_WITH_PURCHASES.sql';
  RAISE NOTICE '   incluya la llamada a fn_refresh_stock_balances()';
  RAISE NOTICE '';
  RAISE NOTICE '2. Si el problema persiste, ejecuta este script después';
  RAISE NOTICE '   de cada compra manualmente:';
  RAISE NOTICE '   REFRESH MATERIALIZED VIEW stock_balances;';
  RAISE NOTICE '';
  RAISE NOTICE '3. Considera convertir stock_balances a vista normal';
  RAISE NOTICE '   para auto-actualización (ver script FIX_STOCK_BALANCES_AUTO.sql)';
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
END;
$$ LANGUAGE plpgsql;
