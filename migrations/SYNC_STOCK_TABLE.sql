/* ============================================================================
   SINCRONIZAR stock_balances (TABLA o VISTA)
   
   Este script funciona tanto si stock_balances es TABLA o VISTA MATERIALIZADA
   y sincroniza el stock con los lotes sin importar qué tipo sea.
   ============================================================================ */

-- =====================================================================
-- 1. DETECTAR TIPO DE stock_balances
-- =====================================================================

DO $$
DECLARE
  v_is_table BOOLEAN;
  v_is_materialized BOOLEAN;
  v_is_view BOOLEAN;
  v_variant UUID := '8ff32b8f-aa82-4f5f-8ce6-e96f65945a8e';
  v_lotes_total NUMERIC := 0;
  v_stock_reportado NUMERIC := 0;
BEGIN
  -- Detectar tipo
  SELECT 
    EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='stock_balances'),
    EXISTS(SELECT 1 FROM pg_matviews WHERE schemaname='public' AND matviewname='stock_balances'),
    EXISTS(SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='stock_balances')
  INTO v_is_table, v_is_materialized, v_is_view;

  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE 'DIAGNÓSTICO: stock_balances';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  
  IF v_is_table THEN
    RAISE NOTICE '✓ stock_balances es una TABLA';
  ELSIF v_is_materialized THEN
    RAISE NOTICE '✓ stock_balances es una VISTA MATERIALIZADA';
  ELSIF v_is_view THEN
    RAISE NOTICE '✓ stock_balances es una VISTA';
  ELSE
    RAISE NOTICE '❌ stock_balances NO EXISTE';
    RETURN;
  END IF;
  
  -- Verificar stock en lotes
  SELECT COALESCE(SUM(on_hand), 0) INTO v_lotes_total
  FROM inventory_batches
  WHERE variant_id = v_variant AND is_active = TRUE;
  
  -- Verificar stock reportado
  SELECT COALESCE(on_hand, 0) INTO v_stock_reportado
  FROM stock_balances
  WHERE variant_id = v_variant
  LIMIT 1;
  
  RAISE NOTICE '';
  RAISE NOTICE 'Variante problemática: %', v_variant;
  RAISE NOTICE 'Stock en lotes: %', v_lotes_total;
  RAISE NOTICE 'Stock reportado: %', v_stock_reportado;
  RAISE NOTICE '';
  
  IF v_lotes_total != v_stock_reportado THEN
    RAISE NOTICE '❌ DESINCRONIZADO - Aplicando fix...';
    RAISE NOTICE '';
  ELSE
    RAISE NOTICE '✓ Sincronizado correctamente';
    RAISE NOTICE '';
    RETURN;
  END IF;

  -- ============================================================
  -- APLICAR FIX SEGÚN TIPO
  -- ============================================================
  
  IF v_is_materialized THEN
    -- Es vista materializada: hacer REFRESH
    RAISE NOTICE '⏳ Ejecutando REFRESH MATERIALIZED VIEW...';
    REFRESH MATERIALIZED VIEW stock_balances;
    RAISE NOTICE '✓ Vista materializada refrescada';
    
  ELSIF v_is_table THEN
    -- Es tabla: sincronizar manualmente
    RAISE NOTICE '⏳ Sincronizando tabla stock_balances...';
    RAISE NOTICE '';
    
    -- Eliminar registros obsoletos (variantes que ya no tienen lotes)
    DELETE FROM stock_balances sb
    WHERE NOT EXISTS(
      SELECT 1 FROM inventory_batches ib
      WHERE ib.tenant_id = sb.tenant_id
        AND ib.location_id = sb.location_id
        AND ib.variant_id = sb.variant_id
        AND ib.is_active = TRUE
    );
    
    -- Insertar o actualizar desde inventory_batches
    INSERT INTO stock_balances (tenant_id, location_id, variant_id, on_hand, reserved, updated_at)
    SELECT 
      ib.tenant_id,
      ib.location_id,
      ib.variant_id,
      SUM(ib.on_hand) AS on_hand,
      SUM(ib.reserved) AS reserved,
      MAX(ib.updated_at) AS updated_at
    FROM inventory_batches ib
    WHERE ib.is_active = TRUE
    GROUP BY ib.tenant_id, ib.location_id, ib.variant_id
    ON CONFLICT (tenant_id, location_id, variant_id) 
    DO UPDATE SET
      on_hand = EXCLUDED.on_hand,
      reserved = EXCLUDED.reserved,
      updated_at = EXCLUDED.updated_at;
    
    RAISE NOTICE '✓ Tabla stock_balances sincronizada';
    
  ELSIF v_is_view THEN
    RAISE NOTICE '✓ Es vista normal - se auto-actualiza';
  END IF;
  
  RAISE NOTICE '';
  
  -- ============================================================
  -- VERIFICACIÓN FINAL
  -- ============================================================
  
  SELECT COALESCE(on_hand, 0) INTO v_stock_reportado
  FROM stock_balances
  WHERE variant_id = v_variant
  LIMIT 1;
  
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE 'VERIFICACIÓN FINAL';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Stock en lotes: %', v_lotes_total;
  RAISE NOTICE 'Stock reportado: %', v_stock_reportado;
  RAISE NOTICE '';
  
  IF v_lotes_total = v_stock_reportado THEN
    RAISE NOTICE '✅ PROBLEMA RESUELTO';
    RAISE NOTICE 'Ahora puedes realizar ventas normalmente';
  ELSE
    RAISE NOTICE '❌ PROBLEMA PERSISTE';
    RAISE NOTICE 'Puede que los lotes estén en otra sede';
    RAISE NOTICE 'o haya un problema con la estructura de la BD';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  
END;
$$ LANGUAGE plpgsql;
