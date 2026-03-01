/* ============================================================================
   FIX: Corregir costos de lotes incorrectos
   ============================================================================
   
   PROBLEMA: Los lotes se crearon con unit_cost incorrecto (generalmente el doble)
   
   CAUSAS IDENTIFICADAS:
   - Mano de obra: $47,000 (debería ser $2,350) - 20x más alto
   - Tela Drill: $4,000 (debería ser $2,000) - 2x más alto
   - Hilo: $1,200 (debería ser $600) - 2x más alto
   - Cierre: $1,300 (debería ser $650) - 2x más alto
   - Botones: $200 (debería ser $100) - 2x más alto
   
   SOLUCIÓN: Actualizar inventory_batches con costos correctos de product_variants
   
   ============================================================================ */

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '🔧 CORRIGIENDO COSTOS DE LOTES';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- 1. MOSTRAR LOTES CON COSTOS INCORRECTOS
-- ============================================================================

DO $$
DECLARE
  v_count INT;
BEGIN
  RAISE NOTICE '📋 Lotes con costos incorrectos:';
  RAISE NOTICE '';
  
  SELECT COUNT(*) INTO v_count
  FROM inventory_batches ib
  JOIN product_variants pv ON pv.variant_id = ib.variant_id
  WHERE ib.unit_cost != pv.cost AND ib.is_active = TRUE;
  
  RAISE NOTICE 'Total de lotes a corregir: %', v_count;
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- 2. ACTUALIZAR LOTES CON COSTO DE PRODUCT_VARIANTS
-- ============================================================================

DO $$
DECLARE
  v_updated INT := 0;
BEGIN
  RAISE NOTICE '🔄 Actualizando costos de lotes...';
  RAISE NOTICE '';
  
  -- Actualizar lotes con el costo correcto de product_variants
  WITH updates AS (
    UPDATE inventory_batches ib
    SET unit_cost = pv.cost
    FROM product_variants pv
    WHERE ib.variant_id = pv.variant_id
      AND ib.unit_cost != pv.cost
      AND ib.is_active = TRUE
    RETURNING 
      ib.batch_id,
      ib.batch_number,
      pv.sku,
      ib.unit_cost AS old_cost,
      pv.cost AS new_cost
  )
  SELECT COUNT(*) INTO v_updated FROM updates;
  
  RAISE NOTICE '✅ Actualizados % lotes', v_updated;
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- 3. ACTUALIZAR PRODUCT_VARIANTS CON COSTOS CORRECTOS
-- ============================================================================

-- Mano de obra: Corregir de $23,500 a $2,350
UPDATE product_variants
SET cost = 2350.00
WHERE sku = 'MAN-260218-4473'
  AND cost != 2350.00;

-- Actualizar lotes de mano de obra
UPDATE inventory_batches ib
SET unit_cost = 2350.00
FROM product_variants pv
WHERE pv.sku = 'MAN-260218-4473'
  AND ib.variant_id = pv.variant_id
  AND ib.is_active = TRUE;

-- Tela Drill: Corregir si está en $4,000 (debería ser $2,000)
UPDATE product_variants
SET cost = 2000.00
WHERE sku = 'TEL-260218-5514'
  AND cost = 4000.00;

UPDATE inventory_batches ib
SET unit_cost = 2000.00
FROM product_variants pv
WHERE pv.sku = 'TEL-260218-5514'
  AND ib.variant_id = pv.variant_id
  AND ib.unit_cost = 4000.00
  AND ib.is_active = TRUE;

-- Hilo Verde: Corregir
UPDATE product_variants
SET cost = 600.00
WHERE sku = 'HIL-260218-6023'
  AND cost = 1200.00;

UPDATE inventory_batches ib
SET unit_cost = 600.00
FROM product_variants pv
WHERE pv.sku = 'HIL-260218-6023'
  AND ib.variant_id = pv.variant_id
  AND ib.unit_cost = 1200.00
  AND ib.is_active = TRUE;

-- Cierre verde: Corregir
UPDATE product_variants
SET cost = 650.00
WHERE sku = 'CIE-260218-1480'
  AND cost = 1300.00;

UPDATE inventory_batches ib
SET unit_cost = 650.00
FROM product_variants pv
WHERE pv.sku = 'CIE-260218-1480'
  AND ib.variant_id = pv.variant_id
  AND ib.unit_cost = 1300.00
  AND ib.is_active = TRUE;

-- Botones: Corregir
UPDATE product_variants
SET cost = 100.00
WHERE sku = 'BOT-260218-1775'
  AND cost = 200.00;

UPDATE inventory_batches ib
SET unit_cost = 100.00
FROM product_variants pv
WHERE pv.sku = 'BOT-260218-1775'
  AND ib.variant_id = pv.variant_id
  AND ib.unit_cost = 200.00
  AND ib.is_active = TRUE;

-- ============================================================================
-- 4. ACTUALIZAR INVENTORY_MOVES DE COMPRAS CON COSTOS CORRECTOS
-- ============================================================================

UPDATE inventory_moves
SET unit_cost = 2350.00
WHERE variant_id IN (SELECT variant_id FROM product_variants WHERE sku = 'MAN-260218-4473')
  AND move_type = 'PURCHASE_IN'
  AND unit_cost = 47000.00;

UPDATE inventory_moves
SET unit_cost = 2000.00
WHERE variant_id IN (SELECT variant_id FROM product_variants WHERE sku = 'TEL-260218-5514')
  AND move_type = 'PURCHASE_IN'
  AND unit_cost = 4000.00;

UPDATE inventory_moves
SET unit_cost = 600.00
WHERE variant_id IN (SELECT variant_id FROM product_variants WHERE sku = 'HIL-260218-6023')
  AND move_type = 'PURCHASE_IN'
  AND unit_cost = 1200.00;

UPDATE inventory_moves
SET unit_cost = 650.00
WHERE variant_id IN (SELECT variant_id FROM product_variants WHERE sku = 'CIE-260218-1480')
  AND move_type = 'PURCHASE_IN'
  AND unit_cost = 1300.00;

UPDATE inventory_moves
SET unit_cost = 100.00
WHERE variant_id IN (SELECT variant_id FROM product_variants WHERE sku = 'BOT-260218-1775')
  AND move_type = 'PURCHASE_IN'
  AND unit_cost = 200.00;

-- ============================================================================
-- 5. RECALCULAR COSTO DEL PANTALÓN
-- ============================================================================

DO $$
DECLARE
  v_bom_cost NUMERIC;
  v_new_price NUMERIC;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '📊 Recalculando costo del Pantalón Verde...';
  
  -- Calcular costo teórico del BOM con costos corregidos
  SELECT SUM(bc.quantity_required * pv.cost) INTO v_bom_cost
  FROM bill_of_materials bom
  JOIN bom_components bc ON bc.bom_id = bom.bom_id
  JOIN product_variants pv ON pv.variant_id = bc.component_variant_id
  WHERE bom.bom_code = 'Pantalon Verde Militar'
    AND bom.is_active = TRUE;
  
  RAISE NOTICE 'Costo BOM corregido: $%', v_bom_cost;
  
  -- Calcular precio con markup (20%)
  v_new_price := v_bom_cost * 1.20;
  
  -- Actualizar producto final
  UPDATE product_variants
  SET cost = v_bom_cost,
      price = v_new_price
  WHERE sku = 'PAN-260219-0424';
  
  RAISE NOTICE '✅ Producto actualizado:';
  RAISE NOTICE '   - Costo: $%', v_bom_cost;
  RAISE NOTICE '   - Precio: $%', v_new_price;
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- 6. ACTUALIZAR LOTE DEL PANTALÓN PRODUCIDO
-- ============================================================================

UPDATE inventory_batches ib
SET unit_cost = (
  SELECT SUM(bc.quantity_required * pv.cost)
  FROM bill_of_materials bom
  JOIN bom_components bc ON bc.bom_id = bom.bom_id
  JOIN product_variants pv ON pv.variant_id = bc.component_variant_id
  WHERE bom.bom_code = 'Pantalon Verde Militar'
)
WHERE ib.batch_number LIKE '%PO-2026-00010%'
  AND ib.is_active = TRUE;

-- ============================================================================
-- 7. ACTUALIZAR PRODUCTION_ORDERS CON COSTO CORRECTO
-- ============================================================================

UPDATE production_orders
SET actual_cost = (
  SELECT SUM(bc.quantity_required * pv.cost)
  FROM bill_of_materials bom
  JOIN bom_components bc ON bc.bom_id = bom.bom_id
  JOIN product_variants pv ON pv.variant_id = bc.component_variant_id
  WHERE bom.bom_code = 'Pantalon Verde Militar'
)
WHERE order_number = 'PO-2026-00010';

-- ============================================================================
-- 8. VERIFICACIÓN FINAL
-- ============================================================================

DO $$
DECLARE
  v_bom_cost NUMERIC;
  v_order_cost NUMERIC;
  v_variant_cost NUMERIC;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ CORRECCIONES APLICADAS';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  
  -- Verificar BOM
  SELECT SUM(bc.quantity_required * pv.cost) INTO v_bom_cost
  FROM bill_of_materials bom
  JOIN bom_components bc ON bc.bom_id = bom.bom_id
  JOIN product_variants pv ON pv.variant_id = bc.component_variant_id
  WHERE bom.bom_code = 'Pantalon Verde Militar';
  
  -- Verificar orden
  SELECT actual_cost INTO v_order_cost
  FROM production_orders
  WHERE order_number = 'PO-2026-00010';
  
  -- Verificar variante
  SELECT cost INTO v_variant_cost
  FROM product_variants
  WHERE sku = 'PAN-260219-0424';
  
  RAISE NOTICE '📊 Verificación:';
  RAISE NOTICE '   - Costo BOM: $%', v_bom_cost;
  RAISE NOTICE '   - Costo orden PO-2026-00010: $%', v_order_cost;
  RAISE NOTICE '   - Costo variante pantalón: $%', v_variant_cost;
  RAISE NOTICE '';
  
  IF v_bom_cost = v_order_cost AND v_bom_cost = v_variant_cost THEN
    RAISE NOTICE '✅ Todos los costos están sincronizados correctamente';
  ELSE
    RAISE WARNING '⚠️ Los costos no coinciden completamente';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE 'Próximo paso: Crear nueva orden de producción para validar';
  RAISE NOTICE '════════════════════════════════════════════════════════';
END $$;
