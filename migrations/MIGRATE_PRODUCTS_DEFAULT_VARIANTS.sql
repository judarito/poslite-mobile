-- ============================================================================
-- MIGRACIÓN: Crear variantes predeterminadas para productos existentes
-- ============================================================================
-- Descripción: Script de migración para productos creados antes del sistema
--              de auto-generación de variantes predeterminadas
-- Autor: Sistema POS Lite
-- Fecha: 2026-02-18
--
-- IMPORTANTE: 
--   - Este script es IDEMPOTENTE (se puede ejecutar múltiples veces)
--   - Solo crea variantes para productos SIN variantes
--   - NO modifica productos que ya tienen variantes
-- ============================================================================

-- ============================================================================
-- 1. VERIFICACIÓN PREVIA
-- ============================================================================

DO $$
DECLARE
  v_products_without_variants INTEGER;
  v_total_products INTEGER;
BEGIN
  -- Contar productos sin variantes
  SELECT COUNT(*) INTO v_products_without_variants
  FROM products p
  WHERE NOT EXISTS (
    SELECT 1 FROM product_variants pv 
    WHERE pv.product_id = p.product_id AND pv.tenant_id = p.tenant_id
  );
  
  -- Contar productos totales
  SELECT COUNT(*) INTO v_total_products FROM products;
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'MIGRACIÓN: VARIANTES PREDETERMINADAS';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE '📊 Análisis previo:';
  RAISE NOTICE '  • Total productos: %', v_total_products;
  RAISE NOTICE '  • Productos SIN variantes: %', v_products_without_variants;
  RAISE NOTICE '  • Productos CON variantes: %', v_total_products - v_products_without_variants;
  RAISE NOTICE '';
  
  IF v_products_without_variants = 0 THEN
    RAISE NOTICE '✅ No hay productos sin variantes. Migración no necesaria.';
  ELSE
    RAISE NOTICE '⚠️  Se crearán % variantes predeterminadas...', v_products_without_variants;
  END IF;
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- 2. MIGRACIÓN: Crear variantes predeterminadas
-- ============================================================================

DO $$
DECLARE
  v_product RECORD;
  v_variant_id UUID;
  v_sku TEXT;
  v_counter INTEGER;
  v_created_count INTEGER := 0;
  v_error_count INTEGER := 0;
BEGIN
  -- Iterar sobre productos sin variantes
  FOR v_product IN 
    SELECT 
      p.product_id, 
      p.tenant_id, 
      p.name, 
      p.unit_id, 
      p.requires_expiration, 
      p.is_active,
      p.track_inventory
    FROM products p
    WHERE NOT EXISTS (
      SELECT 1 FROM product_variants pv 
      WHERE pv.product_id = p.product_id AND pv.tenant_id = p.tenant_id
    )
    ORDER BY p.created_at ASC
  LOOP
    BEGIN
      -- Generar SKU único usando la función del sistema
      v_sku := fn_generate_unique_sku(v_product.tenant_id, v_product.name);
      
      -- Crear variante predeterminada
      v_variant_id := fn_create_default_variant(
        p_tenant_id := v_product.tenant_id,
        p_product_id := v_product.product_id,
        p_product_name := v_product.name,
        p_base_cost := 0,  -- Costo inicial 0 (usuario debe actualizar)
        p_base_price := 0, -- Precio inicial 0 (usuario debe actualizar)
        p_unit_id := v_product.unit_id,
        p_track_inventory := v_product.track_inventory,
        p_requires_expiration := v_product.requires_expiration,
        p_is_active := v_product.is_active
      );
      
      v_created_count := v_created_count + 1;
      
      -- Log cada 10 productos
      IF v_created_count % 10 = 0 THEN
        RAISE NOTICE '  ⏳ Progreso: % variantes creadas...', v_created_count;
      END IF;
      
    EXCEPTION
      WHEN OTHERS THEN
        v_error_count := v_error_count + 1;
        RAISE WARNING '  ❌ Error al crear variante para producto "%": %', v_product.name, SQLERRM;
    END;
  END LOOP;
  
  -- Reporte final
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ MIGRACIÓN COMPLETADA';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE '📊 Resultados:';
  RAISE NOTICE '  • Variantes creadas exitosamente: %', v_created_count;
  RAISE NOTICE '  • Errores encontrados: %', v_error_count;
  RAISE NOTICE '';
  
  IF v_error_count > 0 THEN
    RAISE NOTICE '⚠️  Revisa los warnings anteriores para detalles de errores.';
    RAISE NOTICE '';
  END IF;
  
  RAISE NOTICE '🔧 Próximos pasos:';
  RAISE NOTICE '  1. Revisar productos migrados y actualizar precios/costos';
  RAISE NOTICE '  2. Verificar que las variantes aparecen correctamente en el frontend';
  RAISE NOTICE '  3. Probar crear nueva venta con producto migrado';
  RAISE NOTICE '';
  RAISE NOTICE '📝 Consultas útiles:';
  RAISE NOTICE '  -- Ver variantes creadas recientemente:';
  RAISE NOTICE '  SELECT p.name, pv.sku, pv.cost, pv.price, pv.created_at';
  RAISE NOTICE '  FROM product_variants pv';
  RAISE NOTICE '  JOIN products p ON p.product_id = pv.product_id';
  RAISE NOTICE '  WHERE pv.variant_name = ''Predeterminado''';
  RAISE NOTICE '  ORDER BY pv.created_at DESC LIMIT 20;';
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- 3. VERIFICACIÓN POST-MIGRACIÓN
-- ============================================================================

DO $$
DECLARE
  v_products_without_variants INTEGER;
  v_default_variants INTEGER;
BEGIN
  -- Contar productos que aún no tienen variantes (no debería haber ninguno)
  SELECT COUNT(*) INTO v_products_without_variants
  FROM products p
  WHERE NOT EXISTS (
    SELECT 1 FROM product_variants pv 
    WHERE pv.product_id = p.product_id AND pv.tenant_id = p.tenant_id
  );
  
  -- Contar variantes predeterminadas creadas
  SELECT COUNT(*) INTO v_default_variants
  FROM product_variants
  WHERE variant_name = 'Predeterminado';
  
  RAISE NOTICE '========================================';
  RAISE NOTICE '🔍 VERIFICACIÓN POST-MIGRACIÓN';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE '  • Productos sin variantes: %', v_products_without_variants;
  RAISE NOTICE '  • Total variantes "Predeterminado": %', v_default_variants;
  RAISE NOTICE '';
  
  IF v_products_without_variants = 0 THEN
    RAISE NOTICE '✅ Todos los productos tienen al menos una variante.';
  ELSE
    RAISE WARNING '⚠️  Aún hay % productos sin variantes. Revisa los errores anteriores.', v_products_without_variants;
  END IF;
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- 4. OPCIONAL: Actualizar productos con cost/price en base_cost/base_price
-- ============================================================================
-- Si tienes productos con campos cost/price a nivel producto (poco común),
-- este bloque los migra a la variante predeterminada

-- NOTA: Descomenta solo si tu tabla products tiene columnas cost/price legacy
/*
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'products' AND column_name IN ('cost', 'price')
  ) THEN
    
    UPDATE product_variants pv
    SET 
      cost = COALESCE(p.cost, pv.cost),
      price = COALESCE(p.price, pv.price)
    FROM products p
    WHERE pv.product_id = p.product_id
    AND pv.tenant_id = p.tenant_id
    AND pv.variant_name = 'Predeterminado'
    AND (p.cost > 0 OR p.price > 0);
    
    RAISE NOTICE '✓ Precios/costos legacy migrados a variantes predeterminadas';
    
  END IF;
END $$;
*/
