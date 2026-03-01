/* ============================================================================
   DIAGNÓSTICO ESPECÍFICO: Variante 8ff32b8f-aa82-4f5f-8ce6-e96f65945a8e
   
   Verifica por qué esta variante reporta stock 0 cuando debería tener 20
   ============================================================================ */

-- =====================================================================
-- 1. VERIFICAR LOTES DE ESTA VARIANTE
-- =====================================================================

DO $$
DECLARE
  v_variant UUID := '8ff32b8f-aa82-4f5f-8ce6-e96f65945a8e';
  v_record RECORD;
  v_total_batches NUMERIC := 0;
BEGIN
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '1. LOTES EN inventory_batches';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  
  FOR v_record IN
    SELECT 
      ib.batch_id,
      ib.batch_number,
      ib.on_hand,
      ib.reserved,
      (ib.on_hand - ib.reserved) AS available,
      ib.is_active,
      l.name AS location_name,
      ib.created_at
    FROM inventory_batches ib
    LEFT JOIN locations l ON l.location_id = ib.location_id
    WHERE ib.variant_id = v_variant
    ORDER BY ib.created_at DESC
  LOOP
    RAISE NOTICE 'Lote: % | Stock: % | Reservado: % | Disponible: % | Activo: % | Sede: % | Fecha: %',
      v_record.batch_number,
      v_record.on_hand,
      v_record.reserved,
      v_record.available,
      v_record.is_active,
      v_record.location_name,
      v_record.created_at;
    
    IF v_record.is_active THEN
      v_total_batches := v_total_batches + v_record.on_hand;
    END IF;
  END LOOP;
  
  RAISE NOTICE '';
  RAISE NOTICE 'TOTAL EN LOTES ACTIVOS: %', v_total_batches;
  RAISE NOTICE '';
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 2. VERIFICAR stock_balances
-- =====================================================================

DO $$
DECLARE
  v_variant UUID := '8ff32b8f-aa82-4f5f-8ce6-e96f65945a8e';
  v_record RECORD;
  v_found BOOLEAN := FALSE;
BEGIN
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '2. STOCK EN stock_balances';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  
  FOR v_record IN
    SELECT 
      sb.on_hand,
      COALESCE(sb.reserved, 0) AS reserved,
      (sb.on_hand - COALESCE(sb.reserved, 0)) AS available,
      l.name AS location_name
    FROM stock_balances sb
    LEFT JOIN locations l ON l.location_id = sb.location_id
    WHERE sb.variant_id = v_variant
  LOOP
    v_found := TRUE;
    RAISE NOTICE 'Stock: % | Reservado: % | Disponible: % | Sede: %',
      v_record.on_hand,
      v_record.reserved,
      v_record.available,
      v_record.location_name;
  END LOOP;
  
  IF NOT v_found THEN
    RAISE NOTICE '❌ NO SE ENCONTRÓ ESTA VARIANTE EN stock_balances';
  END IF;
  
  RAISE NOTICE '';
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 3. VERIFICAR TIPO DE stock_balances
-- =====================================================================

DO $$
DECLARE
  v_is_materialized BOOLEAN;
  v_is_view BOOLEAN;
  v_is_table BOOLEAN;
BEGIN
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '3. TIPO DE stock_balances';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  
  -- Verificar si es vista materializada
  SELECT EXISTS(
    SELECT 1 FROM pg_matviews 
    WHERE schemaname = 'public' AND matviewname = 'stock_balances'
  ) INTO v_is_materialized;
  
  -- Verificar si es vista normal
  SELECT EXISTS(
    SELECT 1 FROM pg_views 
    WHERE schemaname = 'public' AND viewname = 'stock_balances'
  ) INTO v_is_view;
  
  -- Verificar si es tabla
  SELECT EXISTS(
    SELECT 1 FROM pg_tables 
    WHERE schemaname = 'public' AND tablename = 'stock_balances'
  ) INTO v_is_table;
  
  IF v_is_materialized THEN
    RAISE NOTICE '✓ stock_balances es una VISTA MATERIALIZADA';
    RAISE NOTICE '  → Requiere REFRESH MATERIALIZED VIEW para actualizar';
  ELSIF v_is_view THEN
    RAISE NOTICE '✓ stock_balances es una VISTA normal';
    RAISE NOTICE '  → Se actualiza automáticamente';
  ELSIF v_is_table THEN
    RAISE NOTICE '✓ stock_balances es una TABLA';
    RAISE NOTICE '  → Se actualiza con INSERT/UPDATE';
  ELSE
    RAISE NOTICE '❌ stock_balances NO EXISTE';
  END IF;
  
  RAISE NOTICE '';
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 4. VERIFICAR FUNCIÓN fn_refresh_stock_balances
-- =====================================================================

DO $$
DECLARE
  v_exists BOOLEAN;
BEGIN
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '4. FUNCIÓN fn_refresh_stock_balances';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  
  SELECT EXISTS(
    SELECT 1 FROM pg_proc 
    WHERE proname = 'fn_refresh_stock_balances'
  ) INTO v_exists;
  
  IF v_exists THEN
    RAISE NOTICE '✓ fn_refresh_stock_balances EXISTE';
  ELSE
    RAISE NOTICE '❌ fn_refresh_stock_balances NO EXISTE';
    RAISE NOTICE '  → El sistema no puede refrescar stock_balances automáticamente';
  END IF;
  
  RAISE NOTICE '';
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 5. FIX INMEDIATO: Refrescar stock_balances
-- =====================================================================

DO $$
DECLARE
  v_is_materialized BOOLEAN;
BEGIN
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '5. APLICANDO FIX';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  
  SELECT EXISTS(
    SELECT 1 FROM pg_matviews 
    WHERE schemaname = 'public' AND matviewname = 'stock_balances'
  ) INTO v_is_materialized;
  
  IF v_is_materialized THEN
    RAISE NOTICE '⏳ Ejecutando REFRESH MATERIALIZED VIEW stock_balances...';
    REFRESH MATERIALIZED VIEW stock_balances;
    RAISE NOTICE '✓ Vista materializada refrescada';
  ELSE
    RAISE NOTICE '⚠️ stock_balances no es vista materializada';
    RAISE NOTICE '  Intentando ejecutar fn_refresh_stock_balances...';
    
    BEGIN
      PERFORM fn_refresh_stock_balances();
      RAISE NOTICE '✓ Función ejecutada';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '❌ Error al ejecutar fn_refresh_stock_balances: %', SQLERRM;
    END;
  END IF;
  
  RAISE NOTICE '';
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 6. VERIFICACIÓN FINAL: ¿Se corrigió?
-- =====================================================================

DO $$
DECLARE
  v_variant UUID := '8ff32b8f-aa82-4f5f-8ce6-e96f65945a8e';
  v_record RECORD;
  v_found BOOLEAN := FALSE;
BEGIN
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '6. VERIFICACIÓN FINAL';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  
  FOR v_record IN
    SELECT 
      sb.on_hand,
      COALESCE(sb.reserved, 0) AS reserved,
      (sb.on_hand - COALESCE(sb.reserved, 0)) AS available,
      l.name AS location_name
    FROM stock_balances sb
    LEFT JOIN locations l ON l.location_id = sb.location_id
    WHERE sb.variant_id = v_variant
  LOOP
    v_found := TRUE;
    RAISE NOTICE '✓ Stock actualizado:';
    RAISE NOTICE '  Stock Total: %', v_record.on_hand;
    RAISE NOTICE '  Reservado: %', v_record.reserved;
    RAISE NOTICE '  Disponible: %', v_record.available;
    RAISE NOTICE '  Sede: %', v_record.location_name;
    
    IF v_record.available > 0 THEN
      RAISE NOTICE '';
      RAISE NOTICE '✅ PROBLEMA RESUELTO - Stock disponible: %', v_record.available;
    ELSE
      RAISE NOTICE '';
      RAISE NOTICE '❌ PROBLEMA PERSISTE - Stock sigue en 0';
    END IF;
  END LOOP;
  
  IF NOT v_found THEN
    RAISE NOTICE '❌ VARIANTE AÚN NO APARECE EN stock_balances';
    RAISE NOTICE '  Hay un problema más profundo con la sincronización';
  END IF;
  
  RAISE NOTICE '';
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- RESUMEN
-- =====================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '📋 RESUMEN';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Este script diagnosticó el problema específico de la variante:';
  RAISE NOTICE '8ff32b8f-aa82-4f5f-8ce6-e96f65945a8e';
  RAISE NOTICE '';
  RAISE NOTICE 'Si el problema persiste después de este script:';
  RAISE NOTICE '';
  RAISE NOTICE '1. Los lotes pueden estar en otra sede diferente';
  RAISE NOTICE '2. La función fn_refresh_stock_balances no existe';
  RAISE NOTICE '3. stock_balances puede tener un problema de definición';
  RAISE NOTICE '';
END;
$$ LANGUAGE plpgsql;
