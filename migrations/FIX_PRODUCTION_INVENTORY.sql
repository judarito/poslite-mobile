/* ============================================================================
   FIX: Generar inventario automáticamente al completar producción
   
   PROBLEMA: 
   - Al completar una orden de producción, se inserta en production_outputs
   - Pero NO se crea el inventory_batch ni el inventory_move
   - Resultado: El producto terminado no tiene stock disponible
   
   SOLUCIÓN:
   - Agregar columnas necesarias a production_outputs
   - Trigger que automáticamente:
     * Crea inventory_batch con el producto terminado
     * Crea inventory_move tipo PRODUCTION_IN
     * Actualiza stock_balances
   ============================================================================ */

-- =====================================================================
-- 1. MODIFICAR production_outputs: Agregar columnas y cambiar constraints
-- =====================================================================

-- Agregar columnas que el frontend envía pero no existen en la tabla
ALTER TABLE production_outputs 
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES product_variants(variant_id),
  ADD COLUMN IF NOT EXISTS physical_location TEXT,
  ADD COLUMN IF NOT EXISTS expiration_date DATE;

-- Hacer batch_id y unit_cost opcionales (el trigger los generará)
ALTER TABLE production_outputs 
  ALTER COLUMN batch_id DROP NOT NULL,
  ALTER COLUMN unit_cost DROP NOT NULL;

-- Asegurar índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_production_outputs_variant 
  ON production_outputs(tenant_id, variant_id);

-- =====================================================================
-- 2. FUNCIÓN: Generar inventario desde production_output
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_generate_production_inventory()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_order RECORD;
  v_batch_id UUID;
  v_batch_number TEXT;
  v_unit_cost NUMERIC := 0;
  v_variant_id UUID;
BEGIN
  -- Obtener información de la orden de producción
  SELECT 
    po.tenant_id,
    po.location_id,
    po.product_variant_id,
    po.order_number,
    po.bom_id,
    po.quantity_produced,
    po.actual_cost
  INTO v_order
  FROM production_orders po
  WHERE po.production_order_id = NEW.production_order_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden de producción % no encontrada', NEW.production_order_id;
  END IF;
  
  -- Determinar variant_id (del frontend o de la orden)
  v_variant_id := COALESCE(NEW.variant_id, v_order.product_variant_id);
  
  IF v_variant_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo determinar variant_id para production_output';
  END IF;
  
  -- Calcular costo unitario
  IF v_order.actual_cost IS NOT NULL AND v_order.quantity_produced > 0 THEN
    v_unit_cost := v_order.actual_cost / v_order.quantity_produced;
  ELSIF NEW.quantity_produced > 0 THEN
    -- Si no hay actual_cost, calcular desde componentes del BOM
    SELECT COALESCE(SUM(
      bc.quantity_required * 
      (1 + COALESCE(bc.waste_percentage, 0) / 100) * 
      COALESCE(pv.cost, 0)
    ), 0) / NEW.quantity_produced
    INTO v_unit_cost
    FROM bom_components bc
    JOIN product_variants pv ON pv.variant_id = bc.component_variant_id
    WHERE bc.bom_id = v_order.bom_id;
  END IF;
  
  -- Generar número de lote
  v_batch_number := 'PRD-' || v_order.order_number || '-' || TO_CHAR(NOW(), 'HHMI');
  
  -- Crear lote de inventario con el producto terminado
  INSERT INTO inventory_batches (
    tenant_id,
    location_id,
    variant_id,
    batch_number,
    on_hand,
    reserved,
    expiration_date,
    physical_location,
    unit_cost,
    notes,
    is_active,
    created_by
  ) VALUES (
    v_order.tenant_id,
    v_order.location_id,
    v_variant_id,
    v_batch_number,
    NEW.quantity_produced,
    0,
    NEW.expiration_date,
    COALESCE(NEW.physical_location, 'PRODUCCIÓN'),
    v_unit_cost,
    'Orden producción: ' || v_order.order_number,
    TRUE,
    NEW.produced_by
  )
  RETURNING batch_id INTO v_batch_id;
  
  -- Actualizar campos de production_output
  NEW.batch_id := v_batch_id;
  NEW.unit_cost := v_unit_cost;
  NEW.variant_id := v_variant_id;
  
  -- Crear movimiento de inventario (entrada por producción)
  INSERT INTO inventory_moves (
    tenant_id,
    location_id,
    variant_id,
    move_type,
    quantity,
    unit_cost,
    source,
    source_id,
    created_by,
    note
  ) VALUES (
    v_order.tenant_id,
    v_order.location_id,
    v_variant_id,
    'PRODUCTION_IN',
    NEW.quantity_produced,
    v_unit_cost,
    'PRODUCTION',
    NEW.production_order_id,
    NEW.produced_by,
    'Orden producción: ' || v_order.order_number
  );
  
  -- Nota: stock_balances se actualiza automáticamente desde inventory_batches
  
  RETURN NEW;
END;
$$;

-- =====================================================================
-- 3. TRIGGER: Activar generación de inventario
-- =====================================================================

DROP TRIGGER IF EXISTS trg_generate_production_inventory ON production_outputs;

CREATE TRIGGER trg_generate_production_inventory
  BEFORE INSERT ON production_outputs
  FOR EACH ROW
  EXECUTE FUNCTION fn_generate_production_inventory();

COMMENT ON FUNCTION fn_generate_production_inventory() IS 
  'Genera automáticamente inventory_batch, inventory_move y actualiza stock_balances cuando se completa una orden de producción.';

-- =====================================================================
-- 4. VERIFICACIÓN
-- =====================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ TRIGGER INVENTARIO PRODUCCIÓN ACTIVADO';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '  ✓ Función fn_generate_production_inventory() creada';
  RAISE NOTICE '  ✓ Trigger trg_generate_production_inventory activado';
  RAISE NOTICE '  ✓ Al completar orden de producción:';
  RAISE NOTICE '    - Se crea inventory_batch automáticamente';
  RAISE NOTICE '    - Se crea inventory_move tipo PRODUCTION_IN';
  RAISE NOTICE '    - Se actualiza stock_balances';
  RAISE NOTICE '';
  RAISE NOTICE 'El stock estará disponible inmediatamente después de completar producción';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
END;
$$ LANGUAGE plpgsql;
