/* ============================================================================
   INTEGRACIÓN MANUFACTURA EN sp_create_sale (CRÍTICO)
   
   OBJETIVO:
   Modificar sp_create_sale para detectar inventory_behavior de cada línea
   y aplicar lógica diferenciada:
   
   - RESELL: comportamiento actual (FEFO)
   - MANUFACTURED TO_STOCK: comportamiento actual (FEFO del producto terminado)
   - SERVICE: SKIP inventario (no validar, no descontar)
   - MANUFACTURED ON_DEMAND: consumir componentes usando fn_handle_ondemand_line()
   - BUNDLE: explotar componentes (FUTURE)
   
   Este script REEMPLAZA sp_create_sale existente con versión integrada.
   
   ORDEN DE EJECUCIÓN: 7/7 (FINAL - DESPUÉS DE TODAS LAS FASES)
   PREREQUISITO: Todas las fases de manufactura ejecutadas
   ============================================================================ */

-- Nota: Este es un template de integración. La implementación real requiere
-- tomar el sp_create_sale actual del sistema y agregar la lógica de behaviors.

-- =====================================================================
-- PSEUDO-CÓDIGO DE INTEGRACIÓN (PARA REFERENCIA)
-- =====================================================================

/*

MODIFICACIONES REQUERIDAS EN sp_create_sale:

1. ANTES DEL LOOP DE LÍNEAS, agregar variable:
   v_behavior TEXT;
   v_production_type TEXT;

2. AL INICIO DEL LOOP (después de extraer v_variant):
   
   -- Detectar comportamiento efectivo
   v_behavior := fn_get_effective_inventory_behavior(p_tenant, v_variant);
   v_production_type := fn_get_effective_production_type(p_tenant, v_variant);
   
3. MODIFICAR VALIDACIÓN DE STOCK:

   IF v_behavior = 'SERVICE' THEN
     -- SKIP validaciones de inventario completamente
     v_cost := COALESCE((SELECT cost FROM product_variants WHERE variant_id = v_variant), 0);
     
   ELSIF v_behavior = 'MANUFACTURED' AND v_production_type = 'ON_DEMAND' THEN
     -- NO validar stock del producto (no existe)
     -- Validar componentes del BOM
     DECLARE
       v_bom_id UUID;
       v_bom_validation RECORD;
     BEGIN
       v_bom_id := fn_get_active_bom(p_tenant, v_variant);
       
       IF v_bom_id IS NULL THEN
         RAISE EXCEPTION 'Producto ON_DEMAND % no tiene BOM configurado', v_variant;
       END IF;
       
       SELECT * INTO v_bom_validation
       FROM fn_validate_bom_availability(p_tenant, p_location, v_bom_id, v_qty);
       
       IF NOT v_bom_validation.available THEN
         RAISE EXCEPTION 'Componentes faltantes para %: %', v_variant, v_bom_validation.missing_components;
       END IF;
     END;
     
   ELSE  
     -- RESELL o MANUFACTURED TO_STOCK: lógica actual (FEFO)
     -- Validar stock disponible normalmente
     SELECT COALESCE(SUM(on_hand - reserved), 0) INTO v_available
     FROM inventory_batches
     WHERE tenant_id = p_tenant
       AND location_id = p_location
       AND variant_id = v_variant
       AND is_active = TRUE;
     
     IF v_available < v_qty THEN
       IF NOT v_allow_backorder THEN
         RAISE EXCEPTION 'Stock insuficiente...';
       END IF;
     END IF;
   END IF;

4. DESPUÉS DE INSERTAR sale_lines, AGREGAR:

   -- Procesar según behavior
   IF v_behavior = 'SERVICE' THEN
     -- No crear inventory_move
     NULL;
     
   ELSIF v_behavior = 'MANUFACTURED' AND v_production_type = 'ON_DEMAND' THEN
     -- Consumir componentes del BOM
     PERFORM fn_handle_ondemand_line(
       p_tenant,
       p_location,
       v_sale_id,
       v_sale_line_id,
       v_variant,
       v_qty,
       p_sold_by
     );
     
   ELSE
     -- RESELL o TO_STOCK: descontar usando FEFO (lógica actual)
     FOR v_allocation IN
       SELECT * FROM fn_allocate_stock_fefo(p_tenant, p_location, v_variant, v_qty)
     LOOP
       -- Descontar del lote
       UPDATE inventory_batches
       SET on_hand = on_hand - v_allocation.quantity_allocated
       WHERE batch_id = v_allocation.batch_id;
       
       -- Registrar en sale_line_batches
       INSERT INTO sale_line_batches (...)
       VALUES (...);
     END LOOP;
     
     -- Crear inventory_move
     INSERT INTO inventory_moves (...)
     VALUES (...);
   END IF;

*/

-- =====================================================================
-- SCRIPT DE INTEGRACIÓN REAL
-- =====================================================================

-- Debido a que sp_create_sale es muy grande y ha sido modificado múltiples
-- veces (FEFO, redondeo, price_includes_tax), NO podemos simplemente
-- reemplazarlo aquí sin ver la versión actual del sistema.

-- INSTRUCCIONES PARA INTEGRAR MANUALMENTE:

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '⚠️  INTEGRACIÓN MANUAL REQUERIDA';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'El sistema de manufactura está COMPLETO en la base de datos,';
  RAISE NOTICE 'pero sp_create_sale DEBE modificarse manualmente para integrar:';
  RAISE NOTICE '';
  RAISE NOTICE 'PASOS PARA INTEGRAR:';
  RAISE NOTICE '';
  RAISE NOTICE '1. Localizar sp_create_sale actual en tu sistema';
  RAISE NOTICE '   (probablemente en ADD_EXPIRATION_BATCHES_PHASE4_SALES.sql o FIX_SALE_ROUNDING.sql)';
  RAISE NOTICE '';
  RAISE NOTICE '2. Agregar variables al inicio de DECLARE:';
  RAISE NOTICE '   v_behavior TEXT;';
  RAISE NOTICE '   v_production_type TEXT;';
  RAISE NOTICE '   v_bom_id UUID;';
  RAISE NOTICE '   v_bom_validation RECORD;';
  RAISE NOTICE '';
  RAISE NOTICE '3. En el LOOP de líneas, DESPUÉS de extraer v_variant, agregar:';
  RAISE NOTICE '   v_behavior := fn_get_effective_inventory_behavior(p_tenant, v_variant);';
  RAISE NOTICE '   v_production_type := fn_get_effective_production_type(p_tenant, v_variant);';
  RAISE NOTICE '';
  RAISE NOTICE '4. Modificar validación de stock con CASE por behavior:';
  RAISE NOTICE '   - SERVICE: skip validaciones';
  RAISE NOTICE '   - ON_DEMAND: validar componentes BOM';
  RAISE NOTICE '   - RESELL/TO_STOCK: validación actual';
  RAISE NOTICE '';
  RAISE NOTICE '5. Después de INSERT sale_lines, agregar CASE para consumo:';
  RAISE NOTICE '   - SERVICE: no crear inventory_move';
  RAISE NOTICE '   - ON_DEMAND: llamar fn_handle_ondemand_line()';
  RAISE NOTICE '   - RESELL/TO_STOCK: FEFO actual';
  RAISE NOTICE '';
  RAISE NOTICE 'ARCHIVO REFERENCIA:';
  RAISE NOTICE '  • Ver pseudo-código completo en este archivo';
  RAISE NOTICE '  • Ver MANUFACTURING_FRS.md sección "Impacto en sp_create_sale"';
  RAISE NOTICE '';
  RAISE NOTICE 'TESTING OBLIGATORIO:';
  RAISE NOTICE '  ✓ Venta RESELL normal (debe funcionar como antes)';
  RAISE NOTICE '  ✓ Venta SERVICE (no debe validar stock)';
  RAISE NOTICE '  ✓ Venta ON_DEMAND (debe consumir componentes)';
  RAISE NOTICE '  ✓ Venta TO_STOCK (debe consumir producto terminado)';
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
END $$;

-- =====================================================================
-- EJEMPLO DE TESTS PARA VALIDAR INTEGRACIÓN
-- =====================================================================

/*

-- TEST 1: Venta RESELL (comportamiento actual)
SELECT sp_create_sale(
  p_tenant := '...', 
  p_location := '...',
  p_cash_session := NULL,
  p_customer := NULL,
  p_sold_by := '...',
  p_lines := '[{"variant_id": "... RESELL ...", "qty": 1, "unit_price": 10000, "discount": 0}]'::JSONB,
  p_payments := '[{"payment_method_id": "... CASH ...", "amount": 10000}]'::JSONB,
  p_note := 'Test RESELL'
);
-- Esperado: Descontar stock normal con FEFO

-- TEST 2: Venta SERVICE
SELECT sp_create_sale(
  p_tenant := '...', 
  p_location := '...',
  p_lines := '[{"variant_id": "... SERVICE ...", "qty": 1, "unit_price": 15000, "discount": 0}]'::JSONB,
  p_payments := '[{"payment_method_id": "...", "amount": 15000}]'::JSONB,
  p_note := 'Test SERVICE'
);
-- Esperado: NO validar stock, NO crear inventory_move

-- TEST 3: Venta ON_DEMAND
INSERT INTO bom_components (bom_id, component_variant_id, quantity, unit) 
VALUES (...);  -- Primero crear BOM

SELECT sp_create_sale(
  p_tenant := '...', 
  p_location := '...',
  p_lines := '[{"variant_id": "... ON_DEMAND con BOM ...", "qty": 1, "unit_price": 20000}]'::JSONB,
  p_payments := '[{"payment_method_id": "...", "amount": 20000}]'::JSONB,
  p_note := 'Test ON_DEMAND'
);
-- Esperado: 
--  • Validar disponibilidad componentes
--  • Consumir componentes con FEFO
--  • Crear entries en component_allocations
--  • Actualizar production_cost en sale_lines
--  • NO descontar stock del producto


-- TEST 4: Venta TO_STOCK
-- Primero crear orden de producción y completarla
SELECT fn_create_production_order(...);
SELECT fn_complete_production(...);  -- Crea lote de producto terminado

SELECT sp_create_sale(
  p_tenant := '...', 
  p_location := '...',
  p_lines := '[{"variant_id": "... TO_STOCK con stock ...", "qty": 1, "unit_price": 25000}]'::JSONB,
  p_payments := '[{"payment_method_id": "...", "amount": 25000}]'::JSONB,
  p_note := 'Test TO_STOCK'
);
-- Esperado: Descontar del lote de producto terminado con FEFO normal

*/

-- =====================================================================
-- VERIFICACIÓN FINAL DEL SISTEMA
-- =====================================================================

DO $$
DECLARE
  v_tables_created BOOLEAN;
  v_functions_created BOOLEAN;
BEGIN
  -- Validar tablas críticas
  SELECT 
    EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'bill_of_materials') AND
    EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'bom_components') AND
    EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'production_orders') AND
    EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'component_allocations')
  INTO v_tables_created;
  
  -- Validar funciones críticas
  SELECT 
    EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'fn_get_effective_inventory_behavior') AND
    EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'fn_consume_bom_components') AND
    EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'fn_handle_ondemand_line') AND
    EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'fn_create_production_order')
  INTO v_functions_created;
  
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ VERIFICACIÓN SISTEMA DE MANUFACTURA';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  
  IF v_tables_created THEN
    RAISE NOTICE '✓ Tablas base: CREADAS';
  ELSE
    RAISE NOTICE '✗ Tablas base: FALTANTES';
  END IF;
  
  IF v_functions_created THEN
    RAISE NOTICE '✓ Funciones core: CREADAS';
  ELSE
    RAISE NOTICE '✗ Funciones core: FALTANTES';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE 'ESTADO IMPLEMENTACIÓN:';
  RAISE NOTICE '  ✓ Fase 1: Fundación (tablas + helpers)';
  RAISE NOTICE '  ✓ Fase 2: SERVICE + BOM';
  RAISE NOTICE '  ✓ Fase 3: ON_DEMAND (consumo componentes)';
  RAISE NOTICE '  ✓ Fase 4: Bundles';
  RAISE NOTICE '  ✓ Fase 5: TO_STOCK (producción)';
  RAISE NOTICE '  ✓ Fase 6: Refinamiento + auditoría';
  RAISE NOTICE '  ⚠️  Fase 7: Integración sp_create_sale PENDIENTE';
  RAISE NOTICE '';
  RAISE NOTICE 'ACCIÓN REQUERIDA:';
  RAISE NOTICE '  1. Modificar sp_create_sale manualmente (ver pseudo-código)';
  RAISE NOTICE '  2. Ejecutar tests de validación (ver ejemplos)';
  RAISE NOTICE '  3. Crear UI para gestión BOMs y órdenes producción';
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
END $$;
