/* ============================================================================
   FIX: Actualización automática de Cost/Price en productos manufacturados
   
   PROBLEMA:
   Los productos manufacturados tienen entrada al inventario pero no tienen
   precio de venta ni costo actualizado basado en:
   - Costo: Calculado desde la lista de materiales (BOM)
   - Precio: Calculado según política de pricing_rules (markup)
   
   SOLUCIÓN:
   1. Modificar fn_complete_production() para actualizar cost/price al completar TO_STOCK
   2. Modificar sp_create_sale() para actualizar cost/price en ventas ON_DEMAND
   3. Recalcular cost/price de productos manufacturados existentes
   
   Dependencias: 
   - PricingRules.sql (fn_calculate_price)
   - MANUFACTURING_PHASE456_FINAL.sql (fn_complete_production)
   - MANUFACTURING_SP_CREATE_SALE_INTEGRATED.sql (sp_create_sale)
   
   Autor: Sistema POS Lite
   Fecha: 2026-02-18
   ============================================================================ */

-- ============================================================================
-- 1. MODIFICAR fn_complete_production PARA TO_STOCK
-- ============================================================================

-- Esta función ya fue modificada en MANUFACTURING_PHASE456_FINAL.sql
-- Agregamos la lógica de actualización después del INSERT en production_outputs:

CREATE OR REPLACE FUNCTION fn_complete_production(
  p_production_order UUID,
  p_quantity_produced NUMERIC,
  p_completed_by UUID,
  p_expiration_date DATE DEFAULT NULL,
  p_physical_location TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_order RECORD;
  v_consumption RECORD;
  v_batch_id UUID;
  v_unit_cost NUMERIC;
  v_new_price NUMERIC;
BEGIN
  -- Obtener orden
  SELECT * INTO v_order
  FROM production_orders
  WHERE production_order_id = p_production_order;
  
  IF v_order.status != 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Orden debe estar IN_PROGRESS. Estado actual: %', v_order.status;
  END IF;
  
  IF p_quantity_produced > v_order.quantity_planned THEN
    RAISE EXCEPTION 'Cantidad producida (%) excede cantidad planeada (%)', 
      p_quantity_produced, v_order.quantity_planned;
  END IF;
  
  -- Consumir componentes
  SELECT * INTO v_consumption
  FROM fn_consume_bom_components(
    v_order.tenant_id,
    v_order.location_id,
    v_order.bom_id,
    p_quantity_produced,
    'PRODUCTION',
    p_production_order,
    p_completed_by
  );
  
  -- Calcular costo unitario
  v_unit_cost := v_consumption.total_cost / p_quantity_produced;
  
  -- Registrar output (el trigger fn_generate_production_inventory creará inventory_batch e inventory_move automáticamente)
  INSERT INTO production_outputs (
    tenant_id, production_order_id, 
    quantity_produced, unit_cost, produced_by,
    expiration_date, physical_location
  ) VALUES (
    v_order.tenant_id, p_production_order, 
    p_quantity_produced, v_unit_cost, p_completed_by,
    p_expiration_date, p_physical_location
  )
  RETURNING batch_id INTO v_batch_id;
  
  -- ✅ NUEVO: Actualizar cost de la variante basado en componentes consumidos
  -- Calcular precio de venta según política de pricing_rules
  v_new_price := fn_calculate_price(
    v_order.tenant_id,
    v_order.product_variant_id,
    v_unit_cost,
    v_order.location_id
  );
  
  UPDATE product_variants
  SET cost = v_unit_cost,
      price = v_new_price
  WHERE tenant_id = v_order.tenant_id
    AND variant_id = v_order.product_variant_id;
  
  RAISE NOTICE 'TO_STOCK: Variante actualizada. Costo: %, Precio: %', v_unit_cost, v_new_price;
  
  -- Actualizar orden
  UPDATE production_orders
  SET status = 'COMPLETED',
      quantity_produced = p_quantity_produced,
      actual_cost = v_consumption.total_cost,
      actual_end = NOW(),
      completed_by = p_completed_by
  WHERE production_order_id = p_production_order;
  
  RETURN v_batch_id;
END;
$$;

COMMENT ON FUNCTION fn_complete_production IS 
  'v3.0: Completa orden TO_STOCK. Consume componentes, inserta production_output (trigger crea lote automáticamente), actualiza cost/price de variante.';

-- ============================================================================
-- 2. MODIFICAR sp_create_sale PARA ON_DEMAND (opcional, si no está integrado)
-- ============================================================================

-- Nota: Si usas MANUFACTURING_SP_CREATE_SALE_INTEGRATED.sql, el cambio ya está aplicado
-- Esta sección es para referencia de la lógica agregada en ON_DEMAND:

/*
    ELSIF v_behavior = 'MANUFACTURED' AND v_production_type = 'ON_DEMAND' THEN
      -- ON_DEMAND: Consumir componentes del BOM con FEFO
      v_components_consumed := fn_consume_bom_components(...);
      
      -- Calcular costo de producción real
      v_production_cost := ...;
      
      -- Actualizar línea
      UPDATE sale_lines SET production_cost = ..., components_consumed = ...;
      
      -- ✅ NUEVO: Actualizar cost y price de la variante
      DECLARE
        v_unit_cost NUMERIC;
        v_new_price NUMERIC;
      BEGIN
        v_unit_cost := v_production_cost / v_qty;
        v_new_price := fn_calculate_price(p_tenant, v_variant, v_unit_cost, p_location);
        
        UPDATE product_variants
        SET cost = v_unit_cost, price = v_new_price, updated_at = NOW()
        WHERE tenant_id = p_tenant AND variant_id = v_variant;
      END;
*/

-- ============================================================================
-- 3. RECALCULAR COSTS/PRICES DE PRODUCTOS MANUFACTURADOS EXISTENTES
-- ============================================================================

DO $$
DECLARE
  v_rec RECORD;
  v_avg_cost NUMERIC;
  v_new_price NUMERIC;
  v_updated_count INT := 0;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '🔄 Recalculando Cost/Price de productos manufacturados';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  
  -- Iterar cada variante manufacturada
  FOR v_rec IN
    SELECT 
      pv.tenant_id,
      pv.variant_id,
      pv.sku,
      p.name AS product_name,
      pv.variant_name,
      pv.cost AS current_cost,
      pv.price AS current_price,
      
      -- Calcular costo promedio de últimas producciones TO_STOCK
      (SELECT AVG(sub.unit_cost)
       FROM (
         SELECT po.unit_cost
         FROM production_outputs po
         JOIN production_orders pord ON pord.production_order_id = po.production_order_id
         WHERE pord.product_variant_id = pv.variant_id
         ORDER BY po.produced_at DESC
         LIMIT 10
       ) sub
      ) AS avg_to_stock_cost,
      
      -- Calcular costo promedio de últimas ventas ON_DEMAND
      (SELECT AVG(sub.unit_cost)
       FROM (
         SELECT (sl.production_cost / sl.quantity) AS unit_cost
         FROM sale_lines sl
         JOIN sales s ON s.sale_id = sl.sale_id
         WHERE sl.variant_id = pv.variant_id
           AND sl.production_cost IS NOT NULL
           AND sl.quantity > 0
         ORDER BY s.sold_at DESC
         LIMIT 10
       ) sub
      ) AS avg_ondemand_cost
      
    FROM product_variants pv
    JOIN products p ON p.product_id = pv.product_id
    WHERE p.inventory_behavior = 'MANUFACTURED'
      AND pv.is_active = TRUE
      AND p.is_active = TRUE
  LOOP
    -- Determinar costo a usar (priorizar TO_STOCK, luego ON_DEMAND, luego mantener actual)
    v_avg_cost := COALESCE(v_rec.avg_to_stock_cost, v_rec.avg_ondemand_cost);
    
    -- Si no hay producciones/ventas previas, mantener costo actual
    IF v_avg_cost IS NULL OR v_avg_cost = 0 THEN
      v_avg_cost := COALESCE(v_rec.current_cost, 0);
    END IF;
    
    -- Si aún no hay costo, calcular desde BOM teórico
    IF v_avg_cost = 0 THEN
      SELECT COALESCE(SUM(
        bc.quantity * 
        COALESCE((SELECT cost FROM product_variants WHERE variant_id = bc.component_variant_id), 0)
      ), 0)
      INTO v_avg_cost
      FROM bom_components bc
      WHERE bc.bom_id IN (
        SELECT bom_id FROM bill_of_materials
        WHERE (variant_id = v_rec.variant_id OR product_id = (
          SELECT product_id FROM product_variants WHERE variant_id = v_rec.variant_id
        ))
        AND is_active = TRUE
        LIMIT 1
      );
    END IF;
    
    -- Calcular nuevo precio según política
    IF v_avg_cost > 0 THEN
      v_new_price := fn_calculate_price(
        v_rec.tenant_id,
        v_rec.variant_id,
        v_avg_cost,
        NULL -- Sin restricción de location
      );
      
      -- Actualizar solo si hay cambios significativos
      IF ABS(COALESCE(v_rec.current_cost, 0) - v_avg_cost) > 0.01 
         OR ABS(COALESCE(v_rec.current_price, 0) - v_new_price) > 0.01 THEN
        
        UPDATE product_variants
        SET cost = v_avg_cost,
            price = v_new_price
        WHERE tenant_id = v_rec.tenant_id
          AND variant_id = v_rec.variant_id;
        
        v_updated_count := v_updated_count + 1;
        
        RAISE NOTICE '  ✓ % - % | Costo: % → % | Precio: % → %',
          v_rec.sku,
          COALESCE(v_rec.product_name || COALESCE(' - ' || v_rec.variant_name, ''), 'SIN NOMBRE'),
          ROUND(COALESCE(v_rec.current_cost, 0), 2),
          ROUND(v_avg_cost, 2),
          ROUND(COALESCE(v_rec.current_price, 0), 2),
          ROUND(v_new_price, 2);
      END IF;
    END IF;
  END LOOP;
  
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ Productos actualizados: %', v_updated_count;
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;

-- ============================================================================
-- VERIFICACIÓN
-- ============================================================================

DO $$
DECLARE
  v_manufactured_count INT;
  v_with_cost_count INT;
  v_with_price_count INT;
BEGIN
  -- Contar productos manufacturados
  SELECT COUNT(DISTINCT pv.variant_id)
  INTO v_manufactured_count
  FROM product_variants pv
  JOIN products p ON p.product_id = pv.product_id
  WHERE p.inventory_behavior = 'MANUFACTURED'
    AND pv.is_active = TRUE;
  
  -- Contar con costo > 0
  SELECT COUNT(DISTINCT pv.variant_id)
  INTO v_with_cost_count
  FROM product_variants pv
  JOIN products p ON p.product_id = pv.product_id
  WHERE p.inventory_behavior = 'MANUFACTURED'
    AND pv.is_active = TRUE
    AND pv.cost > 0;
  
  -- Contar con precio > 0
  SELECT COUNT(DISTINCT pv.variant_id)
  INTO v_with_price_count
  FROM product_variants pv
  JOIN products p ON p.product_id = pv.product_id
  WHERE p.inventory_behavior = 'MANUFACTURED'
    AND pv.is_active = TRUE
    AND pv.price > 0;
  
  RAISE NOTICE '';
  RAISE NOTICE '📊 RESUMEN DE PRODUCTOS MANUFACTURADOS:';
  RAISE NOTICE '  • Total variantes manufacturadas: %', v_manufactured_count;
  RAISE NOTICE '  • Con costo > 0: % (%.1f%%)', 
    v_with_cost_count, 
    CASE WHEN v_manufactured_count > 0 
      THEN (v_with_cost_count::NUMERIC / v_manufactured_count * 100) 
      ELSE 0 
    END;
  RAISE NOTICE '  • Con precio > 0: % (%.1f%%)', 
    v_with_price_count,
    CASE WHEN v_manufactured_count > 0 
      THEN (v_with_price_count::NUMERIC / v_manufactured_count * 100) 
      ELSE 0 
    END;
  RAISE NOTICE '';
  
  IF v_with_cost_count < v_manufactured_count THEN
    RAISE NOTICE '⚠️  % productos manufacturados sin costo. Requieren producción/venta para calcular.', 
      (v_manufactured_count - v_with_cost_count);
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '💡 COMPORTAMIENTO AUTOMÁTICO:';
  RAISE NOTICE '  • TO_STOCK: Cost/Price actualiza al completar orden de producción';
  RAISE NOTICE '  • ON_DEMAND: Cost/Price actualiza en cada venta';
  RAISE NOTICE '  • Costo = Suma componentes consumidos / cantidad producida';
  RAISE NOTICE '  • Precio = Costo + Markup según pricing_rules del tenant';
  RAISE NOTICE '';
END $$;
