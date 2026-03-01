/* ============================================================================
   VERIFICACIÓN: Tablas del sistema de manufactura
   ============================================================================ */

-- Verificar existencia de tablas
SELECT 
  CASE 
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bill_of_materials')
    THEN '✅ Existe' 
    ELSE '❌ NO EXISTE' 
  END as bill_of_materials,
  
  CASE 
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bom_components')
    THEN '✅ Existe' 
    ELSE '❌ NO EXISTE' 
  END as bom_components,
  
  CASE 
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'production_orders')
    THEN '✅ Existe' 
    ELSE '❌ NO EXISTE' 
  END as production_orders,
  
  CASE 
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'production_outputs')
    THEN '✅ Existe' 
    ELSE '❌ NO EXISTE' 
  END as production_outputs,
  
  CASE 
    WHEN EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventory_batches')
    THEN '✅ Existe' 
    ELSE '❌ NO EXISTE' 
  END as inventory_batches;

-- Si bill_of_materials existe, contar registros
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bill_of_materials') THEN
    RAISE NOTICE '';
    RAISE NOTICE '📊 ESTADÍSTICAS DE MANUFACTURA:';
    RAISE NOTICE '';
    RAISE NOTICE 'BOMs totales: %', (SELECT COUNT(*) FROM bill_of_materials);
    RAISE NOTICE 'BOMs activos: %', (SELECT COUNT(*) FROM bill_of_materials WHERE is_active = TRUE);
    RAISE NOTICE 'Componentes totales: %', (SELECT COUNT(*) FROM bom_components);
    RAISE NOTICE 'Órdenes de producción: %', (SELECT COUNT(*) FROM production_orders);
    RAISE NOTICE 'Lotes de producción: %', (SELECT COUNT(*) FROM production_outputs);
    RAISE NOTICE '';
    
    -- Mostrar BOMs si existen
    IF (SELECT COUNT(*) FROM bill_of_materials) > 0 THEN
      RAISE NOTICE '📋 LISTA DE BOMs:';
      RAISE NOTICE '';
      
      DECLARE
        v_bom RECORD;
      BEGIN
        FOR v_bom IN 
          SELECT 
            bom.bom_id,
            bom.bom_code,
            bom.version,
            bom.is_active,
            bom.product_id,
            bom.variant_id,
            (SELECT COUNT(*) FROM bom_components WHERE bom_id = bom.bom_id) as components_count
          FROM bill_of_materials bom
          ORDER BY bom.is_active DESC, bom.bom_code
        LOOP
          RAISE NOTICE '  • BOM: % (v%) - % componentes - %',
            v_bom.bom_code,
            v_bom.version,
            v_bom.components_count,
            CASE WHEN v_bom.is_active THEN 'ACTIVO' ELSE 'INACTIVO' END;
          RAISE NOTICE '    ID: %', v_bom.bom_id;
          RAISE NOTICE '    Product ID: %', COALESCE(v_bom.product_id::TEXT, 'NULL');
          RAISE NOTICE '    Variant ID: %', COALESCE(v_bom.variant_id::TEXT, 'NULL');
          RAISE NOTICE '';
        END LOOP;
      END;
    ELSE
      RAISE NOTICE '⚠️  No hay BOMs registrados.';
      RAISE NOTICE '';
      RAISE NOTICE '💡 Para crear un BOM, ejecuta las migraciones de manufactura:';
      RAISE NOTICE '   1. MANUFACTURING_PHASE1_BASE_TABLES.sql';
      RAISE NOTICE '   2. MANUFACTURING_PHASE1_ALTER_TABLES.sql';
      RAISE NOTICE '   3. MANUFACTURING_PHASE2_SERVICE_BOM.sql';
      RAISE NOTICE '';
    END IF;
  ELSE
    RAISE NOTICE '';
    RAISE NOTICE '❌ La tabla bill_of_materials NO EXISTE';
    RAISE NOTICE '';
    RAISE NOTICE '💡 Necesitas ejecutar las migraciones de manufactura primero:';
    RAISE NOTICE '   psql -U postgres -d pos_lite -f "migrations/MANUFACTURING_PHASE1_BASE_TABLES.sql"';
    RAISE NOTICE '';
  END IF;
END $$;
