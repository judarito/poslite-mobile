/* ============================================================================
   DIAGNÓSTICO COMPLETO - Variante 8ff32b8f-aa82-4f5f-8ce6-e96f65945a8e
   
   Verifica exactamente por qué no se encuentra stock disponible
   ============================================================================ */

-- =====================================================================
-- 1. LOTES EXISTENTES PARA ESTA VARIANTE
-- =====================================================================

SELECT 
  '1. LOTES EXISTENTES' AS seccion,
  ib.batch_id,
  ib.batch_number,
  ib.tenant_id,
  ib.location_id,
  l.name AS location_name,
  ib.variant_id,
  ib.on_hand,
  ib.reserved,
  (ib.on_hand - ib.reserved) AS disponible,
  ib.is_active,
  ib.expiration_date,
  ib.physical_location,
  ib.received_at,
  ib.created_by
FROM inventory_batches ib
LEFT JOIN locations l ON l.location_id = ib.location_id
WHERE ib.variant_id = '8ff32b8f-aa82-4f5f-8ce6-e96f65945a8e'
ORDER BY ib.received_at DESC;

-- =====================================================================
-- 2. STOCK EN stock_balances
-- =====================================================================

SELECT 
  '2. STOCK_BALANCES' AS seccion,
  sb.tenant_id,
  sb.location_id,
  l.name AS location_name,
  sb.variant_id,
  sb.on_hand,
  COALESCE(sb.reserved, 0) AS reserved,
  (sb.on_hand - COALESCE(sb.reserved, 0)) AS disponible,
  sb.updated_at
FROM stock_balances sb
LEFT JOIN locations l ON l.location_id = sb.location_id
WHERE sb.variant_id = '8ff32b8f-aa82-4f5f-8ce6-e96f65945a8e';

-- =====================================================================
-- 3. INFORMACIÓN DE LA VARIANTE
-- =====================================================================

SELECT 
  '3. INFO VARIANTE' AS seccion,
  pv.variant_id,
  pv.sku,
  pv.variant_name,
  p.name AS product_name,
  pv.tenant_id,
  pv.is_active AS variant_activa,
  p.is_active AS product_activo,
  p.requires_expiration,
  pv.allow_backorder
FROM product_variants pv
JOIN products p ON p.product_id = pv.product_id
WHERE pv.variant_id = '8ff32b8f-aa82-4f5f-8ce6-e96f65945a8e';

-- =====================================================================
-- 4. TODAS LAS SEDES (LOCATIONS)
-- =====================================================================

SELECT 
  '4. SEDES DISPONIBLES' AS seccion,
  l.location_id,
  l.tenant_id,
  l.name,
  l.is_active
FROM locations l
ORDER BY l.name;

-- =====================================================================
-- 5. COMPARACIÓN: ¿Dónde están los lotes vs dónde se busca?
-- =====================================================================

SELECT 
  '5. COMPARACIÓN SEDES' AS seccion,
  '⚠️ Los lotes pueden estar EN UNA SEDE pero estás vendiendo DESDE OTRA SEDE' AS nota,
  '' AS separador;

-- Sedes con lotes de esta variante
SELECT 
  'Sedes CON lotes:' AS tipo,
  l.location_id,
  l.name,
  SUM(ib.on_hand) AS total_stock
FROM inventory_batches ib
JOIN locations l ON l.location_id = ib.location_id
WHERE ib.variant_id = '8ff32b8f-aa82-4f5f-8ce6-e96f65945a8e'
  AND ib.is_active = TRUE
GROUP BY l.location_id, l.name;

-- =====================================================================
-- 6. ÚLTIMA COMPRA REGISTRADA
-- =====================================================================

SELECT 
  '6. ÚLTIMA COMPRA' AS seccion,
  im.inventory_move_id,
  im.move_type,
  im.location_id,
  l.name AS location_name,
  im.tenant_id,
  im.quantity,
  im.unit_cost,
  im.source,
  im.source_id,
  im.created_at,
  im.created_by
FROM inventory_moves im
LEFT JOIN locations l ON l.location_id = im.location_id
WHERE im.variant_id = '8ff32b8f-aa82-4f5f-8ce6-e96f65945a8e'
  AND im.move_type = 'PURCHASE_IN'
ORDER BY im.created_at DESC
LIMIT 5;

-- =====================================================================
-- 7. PRUEBA DE ASIGNACIÓN FEFO
-- =====================================================================

-- Probar para cada sede con stock
DO $$
DECLARE
  v_record RECORD;
  v_allocation RECORD;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '7. PRUEBA fn_allocate_stock_fefo';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  
  FOR v_record IN
    SELECT DISTINCT
      ib.tenant_id,
      ib.location_id,
      l.name AS location_name,
      SUM(ib.on_hand - ib.reserved) AS disponible
    FROM inventory_batches ib
    JOIN locations l ON l.location_id = ib.location_id
    WHERE ib.variant_id = '8ff32b8f-aa82-4f5f-8ce6-e96f65945a8e'
      AND ib.is_active = TRUE
    GROUP BY ib.tenant_id, ib.location_id, l.name
  LOOP
    RAISE NOTICE 'Probando en sede: % (Location ID: %)', v_record.location_name, v_record.location_id;
    RAISE NOTICE '  Stock disponible en lotes: %', v_record.disponible;
    
    BEGIN
      SELECT * INTO v_allocation
      FROM fn_allocate_stock_fefo(
        v_record.tenant_id,
        v_record.location_id,
        '8ff32b8f-aa82-4f5f-8ce6-e96f65945a8e'::UUID,
        1.0
      );
      
      RAISE NOTICE '  Resultado FEFO:';
      RAISE NOTICE '    - Total asignado: %', v_allocation.total_allocated;
      RAISE NOTICE '    - ¿Suficiente?: %', v_allocation.has_sufficient_stock;
      RAISE NOTICE '    - Detalles: %', v_allocation.allocation_details;
      IF v_allocation.warnings IS NOT NULL AND v_allocation.warnings::TEXT != '[]' THEN
        RAISE NOTICE '    - Advertencias: %', v_allocation.warnings;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '  ❌ ERROR al ejecutar FEFO: %', SQLERRM;
    END;
    
    RAISE NOTICE '';
  END LOOP;
  
  IF NOT FOUND THEN
    RAISE NOTICE '❌ No hay lotes activos para esta variante';
  END IF;
  
  RAISE NOTICE '════════════════════════════════════════════════════════';
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- RESUMEN
-- =====================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '📋 INSTRUCCIONES';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Revisa los resultados arriba:';
  RAISE NOTICE '';
  RAISE NOTICE '1. Verifica que los lotes existen (Sección 1)';
  RAISE NOTICE '2. Verifica que is_active = TRUE';
  RAISE NOTICE '3. Compara tenant_id de lotes vs tenant actual';
  RAISE NOTICE '4. Compara location_id de lotes vs sede desde donde vendes';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️ PROBLEMA COMÚN:';
  RAISE NOTICE 'Los lotes están en SEDE A pero intentas vender desde SEDE B';
  RAISE NOTICE '';
  RAISE NOTICE 'SOLUCIÓN:';
  RAISE NOTICE '- Abre caja en la MISMA SEDE donde registraste la compra';
  RAISE NOTICE '- O realiza una transferencia entre sedes';
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
END;
$$ LANGUAGE plpgsql;
