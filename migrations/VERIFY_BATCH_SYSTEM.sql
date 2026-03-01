/* ============================================================================
   VERIFICACIÓN DEL SISTEMA DE LOTES
   Ejecuta este script para verificar que todo se instaló correctamente
   ============================================================================ */

-- =========================
-- 1) VERIFICAR TABLAS
-- =========================
DO $$
BEGIN
  RAISE NOTICE '============================================';
  RAISE NOTICE '1. VERIFICANDO TABLAS';
  RAISE NOTICE '============================================';
  
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'inventory_batches') THEN
    RAISE NOTICE '✓ inventory_batches - OK';
  ELSE
    RAISE WARNING '✗ inventory_batches - NO EXISTE';
  END IF;
  
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'sale_line_batches') THEN
    RAISE NOTICE '✓ sale_line_batches - OK';
  ELSE
    RAISE WARNING '✗ sale_line_batches - NO EXISTE';
  END IF;
  
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'sale_warnings') THEN
    RAISE NOTICE '✓ sale_warnings - OK';
  ELSE
    RAISE WARNING '✗ sale_warnings - NO EXISTE';
  END IF;
  
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'stock_balances_backup') THEN
    RAISE NOTICE '✓ stock_balances_backup - OK';
  ELSE
    RAISE WARNING '✗ stock_balances_backup - NO EXISTE';
  END IF;
END;
$$;

-- =========================
-- 2) VERIFICAR VISTAS MATERIALIZADAS
-- =========================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================';
  RAISE NOTICE '2. VERIFICANDO VISTAS MATERIALIZADAS';
  RAISE NOTICE '============================================';
  
  IF EXISTS (SELECT 1 FROM pg_matviews WHERE matviewname = 'stock_balances') THEN
    RAISE NOTICE '✓ stock_balances (materializada) - OK';
  ELSE
    RAISE WARNING '✗ stock_balances NO es vista materializada';
  END IF;
END;
$$;

-- =========================
-- 3) VERIFICAR VISTAS
-- =========================
DO $$
DECLARE
  v_count INT;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================';
  RAISE NOTICE '3. VERIFICANDO VISTAS';
  RAISE NOTICE '============================================';
  
  SELECT COUNT(*) INTO v_count
  FROM pg_views 
  WHERE viewname IN (
    'vw_expiring_products',
    'vw_expiring_by_variant',
    'vw_expiration_dashboard',
    'vw_batch_rotation',
    'vw_stock_for_cashier',
    'vw_batch_traceability',
    'vw_products_expiration_config',
    'vw_stock_with_batches'
  );
  
  RAISE NOTICE 'Vistas encontradas: %/8', v_count;
  
  IF v_count = 8 THEN
    RAISE NOTICE '✓ Todas las vistas creadas correctamente';
  ELSE
    RAISE WARNING '⚠ Faltan % vistas', (8 - v_count);
  END IF;
END;
$$;

-- =========================
-- 4) VERIFICAR FUNCIONES
-- =========================
DO $$
DECLARE
  v_count INT;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================';
  RAISE NOTICE '4. VERIFICANDO FUNCIONES';
  RAISE NOTICE '============================================';
  
  SELECT COUNT(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'fn_variant_requires_expiration',
      'fn_get_expiration_config',
      'fn_generate_batch_number',
      'fn_allocate_stock_fefo',
      'fn_reserve_batch_stock',
      'fn_release_batch_reservation',
      'fn_consume_batch_stock',
      'fn_refresh_stock_balances',
      'fn_get_sale_warnings',
      'fn_expiration_report',
      'fn_top_at_risk_products'
    );
  
  RAISE NOTICE 'Funciones encontradas: %/11', v_count;
  
  IF v_count >= 10 THEN
    RAISE NOTICE '✓ Funciones principales creadas';
  ELSE
    RAISE WARNING '⚠ Faltan % funciones', (11 - v_count);
  END IF;
END;
$$;

-- =========================
-- 5) VERIFICAR COLUMNAS NUEVAS
-- =========================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================';
  RAISE NOTICE '5. VERIFICANDO COLUMNAS NUEVAS';
  RAISE NOTICE '============================================';
  
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'products' AND column_name = 'requires_expiration'
  ) THEN
    RAISE NOTICE '✓ products.requires_expiration - OK';
  ELSE
    RAISE WARNING '✗ products.requires_expiration - NO EXISTE';
  END IF;
  
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'product_variants' AND column_name = 'requires_expiration'
  ) THEN
    RAISE NOTICE '✓ product_variants.requires_expiration - OK';
  ELSE
    RAISE WARNING '✗ product_variants.requires_expiration - NO EXISTE';
  END IF;
  
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'tenant_settings' AND column_name = 'expiration_config'
  ) THEN
    RAISE NOTICE '✓ tenant_settings.expiration_config - OK';
  ELSE
    RAISE WARNING '✗ tenant_settings.expiration_config - NO EXISTE';
  END IF;
END;
$$;

-- =========================
-- 6) VERIFICAR MIGRACIÓN DE DATOS
-- =========================
DO $$
DECLARE
  v_backup_total NUMERIC;
  v_batch_total NUMERIC;
  v_migrated_count INT;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================';
  RAISE NOTICE '6. VERIFICANDO MIGRACIÓN DE DATOS';
  RAISE NOTICE '============================================';
  
  -- Total en backup
  SELECT COALESCE(SUM(on_hand), 0) INTO v_backup_total 
  FROM stock_balances_backup;
  
  -- Total en lotes
  SELECT COALESCE(SUM(on_hand), 0) INTO v_batch_total 
  FROM inventory_batches WHERE is_active = TRUE;
  
  -- Lotes migrados
  SELECT COUNT(*) INTO v_migrated_count 
  FROM inventory_batches 
  WHERE batch_number LIKE 'MIGRATION-%';
  
  RAISE NOTICE 'Stock backup: %', v_backup_total;
  RAISE NOTICE 'Stock lotes: %', v_batch_total;
  RAISE NOTICE 'Lotes migrados: %', v_migrated_count;
  
  IF v_backup_total = v_batch_total THEN
    RAISE NOTICE '✓ Migración de datos: CORRECTA';
  ELSE
    RAISE WARNING '⚠ Diferencia en totales: %', (v_backup_total - v_batch_total);
  END IF;
END;
$$;

-- =========================
-- 7) VERIFICAR ÍNDICES
-- =========================
DO $$
DECLARE
  v_count INT;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================';
  RAISE NOTICE '7. VERIFICANDO ÍNDICES';
  RAISE NOTICE '============================================';
  
  SELECT COUNT(*) INTO v_count
  FROM pg_indexes
  WHERE tablename = 'inventory_batches'
    AND indexname LIKE 'idx_batches%';
  
  RAISE NOTICE 'Índices en inventory_batches: %', v_count;
  
  IF v_count >= 3 THEN
    RAISE NOTICE '✓ Índices principales creados';
  ELSE
    RAISE WARNING '⚠ Faltan índices en inventory_batches';
  END IF;
END;
$$;

-- =========================
-- 8) TEST FUNCIONAL BÁSICO
-- =========================
DO $$
DECLARE
  v_test_tenant UUID;
  v_test_variant UUID;
  v_requires_exp BOOLEAN;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================';
  RAISE NOTICE '8. TEST FUNCIONAL BÁSICO';
  RAISE NOTICE '============================================';
  
  -- Obtener un tenant y variante de prueba
  SELECT tenant_id INTO v_test_tenant FROM tenants LIMIT 1;
  SELECT variant_id INTO v_test_variant 
  FROM product_variants 
  WHERE tenant_id = v_test_tenant 
  LIMIT 1;
  
  IF v_test_tenant IS NOT NULL AND v_test_variant IS NOT NULL THEN
    -- Test función de configuración
    BEGIN
      v_requires_exp := fn_variant_requires_expiration(v_test_tenant, v_test_variant);
      RAISE NOTICE '✓ fn_variant_requires_expiration: OK (retorna %)', v_requires_exp;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '✗ fn_variant_requires_expiration: ERROR - %', SQLERRM;
    END;
    
    -- Test vista de configuración
    BEGIN
      PERFORM 1 FROM vw_products_expiration_config 
      WHERE tenant_id = v_test_tenant LIMIT 1;
      RAISE NOTICE '✓ vw_products_expiration_config: OK';
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '✗ vw_products_expiration_config: ERROR - %', SQLERRM;
    END;
    
  ELSE
    RAISE NOTICE '⚠ No hay datos para test funcional';
  END IF;
END;
$$;

-- =========================
-- RESUMEN FINAL
-- =========================
DO $$
DECLARE
  v_batch_count INT;
  v_expiring_count INT;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '============================================';
  RAISE NOTICE 'RESUMEN FINAL';
  RAISE NOTICE '============================================';
  
  SELECT COUNT(*) INTO v_batch_count FROM inventory_batches;
  RAISE NOTICE 'Total de lotes: %', v_batch_count;
  
  SELECT COUNT(*) INTO v_expiring_count FROM vw_expiring_products;
  RAISE NOTICE 'Productos con vencimiento: %', v_expiring_count;
  
  RAISE NOTICE '';
  RAISE NOTICE '✓ VERIFICACIÓN COMPLETADA';
  RAISE NOTICE '';
  RAISE NOTICE 'PRÓXIMOS PASOS:';
  RAISE NOTICE '1. Configurar productos que requieren vencimiento';
  RAISE NOTICE '2. Ingresar lotes con fecha de vencimiento';
  RAISE NOTICE '3. Probar venta con FEFO';
  RAISE NOTICE '4. Consultar reportes de vencimiento';
  RAISE NOTICE '============================================';
END;
$$;
