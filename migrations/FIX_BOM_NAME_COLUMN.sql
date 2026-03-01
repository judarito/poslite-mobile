/* ============================================================================
   FIX: Compatibilidad columnas bill_of_materials y bom_components
   
   PROBLEMA: 
   - La tabla bill_of_materials tiene "bom_code" pero el frontend busca "bom_name"
   - La tabla bom_components tiene "quantity" pero el frontend busca "quantity_required"
   
   SOLUCIÓN:
   - Agregar columnas faltantes para compatibilidad frontend
   ============================================================================ */

-- =====================================================================
-- 1. BILL_OF_MATERIALS: Agregar bom_name
-- =====================================================================

ALTER TABLE bill_of_materials 
  ADD COLUMN IF NOT EXISTS bom_name TEXT;

-- Copiar datos existentes de bom_code a bom_name
UPDATE bill_of_materials 
SET bom_name = bom_code
WHERE bom_name IS NULL;

-- Si no hay datos, hacer NOT NULL
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM bill_of_materials LIMIT 1) THEN
    ALTER TABLE bill_of_materials 
      ALTER COLUMN bom_name SET NOT NULL;
  END IF;
END $$;

-- Agregar índice para búsquedas
CREATE INDEX IF NOT EXISTS idx_bom_name ON bill_of_materials(tenant_id, bom_name);

-- Trigger para sincronizar bom_name <-> bom_code
CREATE OR REPLACE FUNCTION sync_bom_name_code()
RETURNS TRIGGER AS $$
BEGIN
  -- En INSERT: sincronizar si uno está vacío
  IF TG_OP = 'INSERT' THEN
    IF NEW.bom_name IS NOT NULL AND NEW.bom_code IS NULL THEN
      NEW.bom_code := NEW.bom_name;
    ELSIF NEW.bom_code IS NOT NULL AND NEW.bom_name IS NULL THEN
      NEW.bom_name := NEW.bom_code;
    END IF;
  END IF;
  
  -- En UPDATE: sincronizar cambios
  IF TG_OP = 'UPDATE' THEN
    IF NEW.bom_name IS DISTINCT FROM OLD.bom_name THEN
      NEW.bom_code := NEW.bom_name;
    END IF;
    IF NEW.bom_code IS DISTINCT FROM OLD.bom_code THEN
      NEW.bom_name := NEW.bom_code;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_bom_name_trigger ON bill_of_materials;
CREATE TRIGGER sync_bom_name_trigger
  BEFORE INSERT OR UPDATE ON bill_of_materials
  FOR EACH ROW
  EXECUTE FUNCTION sync_bom_name_code();

COMMENT ON COLUMN bill_of_materials.bom_name IS 'Nombre descriptivo del BOM (ej: "Camisa Polo v1", "Pizza Grande").';

-- =====================================================================
-- 2. BOM_COMPONENTS: Agregar quantity_required (alias de quantity)
-- =====================================================================

ALTER TABLE bom_components 
  ADD COLUMN IF NOT EXISTS quantity_required NUMERIC(14,3);

-- Copiar datos existentes de quantity a quantity_required
UPDATE bom_components 
SET quantity_required = quantity
WHERE quantity_required IS NULL;

-- Sincronizar: si se actualiza quantity, actualizar quantity_required
CREATE OR REPLACE FUNCTION sync_bom_component_quantity()
RETURNS TRIGGER AS $$
BEGIN
  -- En INSERT: si viene quantity_required pero no quantity
  IF TG_OP = 'INSERT' THEN
    IF NEW.quantity_required IS NOT NULL AND NEW.quantity IS NULL THEN
      NEW.quantity := NEW.quantity_required;
    ELSIF NEW.quantity IS NOT NULL AND NEW.quantity_required IS NULL THEN
      NEW.quantity_required := NEW.quantity;
    END IF;
  END IF;
  
  -- En UPDATE: sincronizar cambios
  IF TG_OP = 'UPDATE' THEN
    IF NEW.quantity IS DISTINCT FROM OLD.quantity THEN
      NEW.quantity_required := NEW.quantity;
    END IF;
    IF NEW.quantity_required IS DISTINCT FROM OLD.quantity_required THEN
      NEW.quantity := NEW.quantity_required;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_quantity_trigger ON bom_components;
CREATE TRIGGER sync_quantity_trigger
  BEFORE INSERT OR UPDATE ON bom_components
  FOR EACH ROW
  EXECUTE FUNCTION sync_bom_component_quantity();

COMMENT ON COLUMN bom_components.quantity_required IS 'Cantidad requerida del componente (sincronizada con quantity).';

-- =====================================================================
-- 3. PRODUCTION_ORDERS: Agregar alias columnas
-- =====================================================================

-- Agregar columnas con nombres esperados por frontend
ALTER TABLE production_orders 
  ADD COLUMN IF NOT EXISTS scheduled_start_date TIMESTAMPTZ;

-- Copiar datos existentes
UPDATE production_orders 
SET scheduled_start_date = scheduled_start
WHERE scheduled_start_date IS NULL;

-- Trigger sincronización scheduled_start <-> scheduled_start_date
CREATE OR REPLACE FUNCTION sync_production_order_dates()
RETURNS TRIGGER AS $$
BEGIN
  -- En INSERT: sincronizar
  IF TG_OP = 'INSERT' THEN
    IF NEW.scheduled_start_date IS NOT NULL AND NEW.scheduled_start IS NULL THEN
      NEW.scheduled_start := NEW.scheduled_start_date;
    ELSIF NEW.scheduled_start IS NOT NULL AND NEW.scheduled_start_date IS NULL THEN
      NEW.scheduled_start_date := NEW.scheduled_start;
    END IF;
  END IF;
  
  -- En UPDATE: sincronizar cambios
  IF TG_OP = 'UPDATE' THEN
    IF NEW.scheduled_start IS DISTINCT FROM OLD.scheduled_start THEN
      NEW.scheduled_start_date := NEW.scheduled_start;
    END IF;
    IF NEW.scheduled_start_date IS DISTINCT FROM OLD.scheduled_start_date THEN
      NEW.scheduled_start := NEW.scheduled_start_date;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_dates_trigger ON production_orders;
CREATE TRIGGER sync_dates_trigger
  BEFORE INSERT OR UPDATE ON production_orders
  FOR EACH ROW
  EXECUTE FUNCTION sync_production_order_dates();

COMMENT ON COLUMN production_orders.scheduled_start_date IS 'Fecha programada inicio producción (sincronizada con scheduled_start).';

-- =====================================================================
-- 4. PRODUCTION_ORDER_LINES: Agregar alias quantity_planned
-- =====================================================================

-- Agregar columna quantity_planned (alias de quantity_required)
ALTER TABLE production_order_lines 
  ADD COLUMN IF NOT EXISTS quantity_planned NUMERIC(14,3);

-- Copiar datos existentes
UPDATE production_order_lines 
SET quantity_planned = quantity_required
WHERE quantity_planned IS NULL;

-- Trigger sincronización quantity_planned <-> quantity_required
CREATE OR REPLACE FUNCTION sync_production_line_quantity()
RETURNS TRIGGER AS $$
BEGIN
  -- En INSERT: sincronizar
  IF TG_OP = 'INSERT' THEN
    IF NEW.quantity_planned IS NOT NULL AND NEW.quantity_required IS NULL THEN
      NEW.quantity_required := NEW.quantity_planned;
    ELSIF NEW.quantity_required IS NOT NULL AND NEW.quantity_planned IS NULL THEN
      NEW.quantity_planned := NEW.quantity_required;
    END IF;
  END IF;
  
  -- En UPDATE: sincronizar cambios
  IF TG_OP = 'UPDATE' THEN
    IF NEW.quantity_required IS DISTINCT FROM OLD.quantity_required THEN
      NEW.quantity_planned := NEW.quantity_required;
    END IF;
    IF NEW.quantity_planned IS DISTINCT FROM OLD.quantity_planned THEN
      NEW.quantity_required := NEW.quantity_planned;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_line_quantity_trigger ON production_order_lines;
CREATE TRIGGER sync_line_quantity_trigger
  BEFORE INSERT OR UPDATE ON production_order_lines
  FOR EACH ROW
  EXECUTE FUNCTION sync_production_line_quantity();

COMMENT ON COLUMN production_order_lines.quantity_planned IS 'Cantidad planeada del componente (sincronizada con quantity_required).';

-- =====================================================================
-- 5. PRODUCTION_ORDERS: Agregar alias fechas (started_at, completed_at, cancelled_at)
-- =====================================================================

-- Agregar columnas de auditoría esperadas por frontend
ALTER TABLE production_orders 
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- Copiar datos existentes
UPDATE production_orders 
SET started_at = actual_start,
    completed_at = actual_end
WHERE started_at IS NULL OR completed_at IS NULL;

-- Trigger sincronización fechas auditoría
CREATE OR REPLACE FUNCTION sync_production_order_audit_dates()
RETURNS TRIGGER AS $$
BEGIN
  -- En INSERT: sincronizar
  IF TG_OP = 'INSERT' THEN
    IF NEW.started_at IS NOT NULL AND NEW.actual_start IS NULL THEN
      NEW.actual_start := NEW.started_at;
    ELSIF NEW.actual_start IS NOT NULL AND NEW.started_at IS NULL THEN
      NEW.started_at := NEW.actual_start;
    END IF;
    
    IF NEW.completed_at IS NOT NULL AND NEW.actual_end IS NULL THEN
      NEW.actual_end := NEW.completed_at;
    ELSIF NEW.actual_end IS NOT NULL AND NEW.completed_at IS NULL THEN
      NEW.completed_at := NEW.actual_end;
    END IF;
  END IF;
  
  -- En UPDATE: sincronizar cambios
  IF TG_OP = 'UPDATE' THEN
    IF NEW.actual_start IS DISTINCT FROM OLD.actual_start THEN
      NEW.started_at := NEW.actual_start;
    END IF;
    IF NEW.started_at IS DISTINCT FROM OLD.started_at THEN
      NEW.actual_start := NEW.started_at;
    END IF;
    
    IF NEW.actual_end IS DISTINCT FROM OLD.actual_end THEN
      NEW.completed_at := NEW.actual_end;
    END IF;
    IF NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
      NEW.actual_end := NEW.completed_at;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_audit_dates_trigger ON production_orders;
CREATE TRIGGER sync_audit_dates_trigger
  BEFORE INSERT OR UPDATE ON production_orders
  FOR EACH ROW
  EXECUTE FUNCTION sync_production_order_audit_dates();

COMMENT ON COLUMN production_orders.started_at IS 'Fecha/hora inicio real (sincronizada con actual_start).';
COMMENT ON COLUMN production_orders.completed_at IS 'Fecha/hora finalización real (sincronizada con actual_end).';
COMMENT ON COLUMN production_orders.cancelled_at IS 'Fecha/hora cancelación.';

-- =====================================================================
-- 6. VERIFICACIÓN
-- =====================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ COLUMNAS COMPATIBILIDAD AGREGADAS';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '  ✓ bill_of_materials.bom_name agregada';
  RAISE NOTICE '  ✓ bom_components.quantity_required agregada';
  RAISE NOTICE '  ✓ production_orders.scheduled_start_date agregada';
  RAISE NOTICE '  ✓ production_orders.started_at/completed_at/cancelled_at agregadas';
  RAISE NOTICE '  ✓ production_order_lines.quantity_planned agregada';
  RAISE NOTICE '  ✓ Triggers sincronización automática activados';
  RAISE NOTICE '';
  RAISE NOTICE 'Frontend puede usar nombres esperados normalmente';
  RAISE NOTICE '════════════════════════════════════════════════════════';
END;
$$ LANGUAGE plpgsql;
