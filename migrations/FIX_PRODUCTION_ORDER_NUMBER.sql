/* ============================================================================
   FIX: Auto-generar campos en production_orders
   
   PROBLEMA: 
   - order_number es NOT NULL pero el frontend no lo envía
   - product_variant_id es NOT NULL pero el frontend solo envía bom_id
   - status default es 'DRAFT' pero el frontend espera 'PENDING'
   
   SOLUCIÓN:
   - Auto-generar order_number con trigger (PO-YYYY-00001)
   - Auto-obtener product_variant_id del BOM
   - Cambiar status default a 'PENDING'
   ============================================================================ */

-- Hacer order_number nullable temporalmente para datos existentes
ALTER TABLE production_orders 
  ALTER COLUMN order_number DROP NOT NULL;

-- Hacer product_variant_id nullable (se auto-obtiene del BOM)
ALTER TABLE production_orders 
  ALTER COLUMN product_variant_id DROP NOT NULL;

-- Cambiar default status de 'DRAFT' a 'PENDING' (usado por frontend)
ALTER TABLE production_orders 
  ALTER COLUMN status SET DEFAULT 'PENDING';

-- Actualizar CHECK constraint para incluir 'PENDING'
ALTER TABLE production_orders
  DROP CONSTRAINT IF EXISTS production_orders_status_check;

ALTER TABLE production_orders
  ADD CONSTRAINT production_orders_status_check
  CHECK (status IN ('PENDING', 'DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'));

-- Actualizar registros existentes con DRAFT a PENDING
UPDATE production_orders 
SET status = 'PENDING' 
WHERE status = 'DRAFT';

-- Crear función para generar order_number automáticamente
CREATE OR REPLACE FUNCTION generate_production_order_number()
RETURNS TRIGGER AS $$
DECLARE
  v_year TEXT;
  v_sequence INT;
  v_order_number TEXT;
  v_variant_id UUID;
BEGIN
  -- Si ya viene con order_number, no hacer nada
  IF NEW.order_number IS NULL THEN
    -- Obtener año actual
    v_year := TO_CHAR(NOW(), 'YYYY');
    
    -- Obtener siguiente secuencia del año actual para este tenant
    SELECT COALESCE(MAX(CAST(SUBSTRING(order_number FROM 'PO-\d{4}-(\d+)') AS INTEGER)), 0) + 1
    INTO v_sequence
    FROM production_orders
    WHERE tenant_id = NEW.tenant_id
      AND order_number LIKE 'PO-' || v_year || '-%';
    
    -- Generar order_number: PO-2024-00001
    v_order_number := 'PO-' || v_year || '-' || LPAD(v_sequence::TEXT, 5, '0');
    
    NEW.order_number := v_order_number;
  END IF;
  
  -- Si no viene product_variant_id, obtenerlo del BOM
  IF NEW.product_variant_id IS NULL AND NEW.bom_id IS NOT NULL THEN
    SELECT COALESCE(variant_id, (SELECT pv.variant_id 
                                  FROM product_variants pv 
                                  WHERE pv.product_id = bom.product_id 
                                  LIMIT 1))
    INTO v_variant_id
    FROM bill_of_materials bom
    WHERE bom.bom_id = NEW.bom_id;
    
    NEW.product_variant_id := v_variant_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Crear trigger para ejecutar antes de INSERT
DROP TRIGGER IF EXISTS generate_order_number_trigger ON production_orders;
CREATE TRIGGER generate_order_number_trigger
  BEFORE INSERT ON production_orders
  FOR EACH ROW
  EXECUTE FUNCTION generate_production_order_number();

-- Generar order_number para registros existentes que no lo tengan
WITH numbered_orders AS (
  SELECT 
    production_order_id,
    'PO-' || TO_CHAR(created_at, 'YYYY') || '-' || 
    LPAD(ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at)::TEXT, 5, '0') AS new_order_number
  FROM production_orders
  WHERE order_number IS NULL
)
UPDATE production_orders po
SET order_number = no.new_order_number
FROM numbered_orders no
WHERE po.production_order_id = no.production_order_id;

-- Ahora sí, hacer NOT NULL de nuevo
ALTER TABLE production_orders 
  ALTER COLUMN order_number SET NOT NULL;

COMMENT ON COLUMN production_orders.order_number IS 'Número de orden auto-generado. Formato: PO-YYYY-00001';

-- Verificación
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ AUTO-GENERACIÓN PRODUCTION_ORDERS ACTIVADA';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '  ✓ order_number se genera automáticamente (PO-2024-00001)';
  RAISE NOTICE '  ✓ product_variant_id se obtiene del BOM';
  RAISE NOTICE '  ✓ status default cambiado a PENDING';
  RAISE NOTICE '';
  RAISE NOTICE 'Frontend puede crear órdenes con solo: bom_id, quantity, location';
  RAISE NOTICE '════════════════════════════════════════════════════════';
END;
$$ LANGUAGE plpgsql;
