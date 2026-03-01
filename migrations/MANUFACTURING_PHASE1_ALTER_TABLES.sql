/* ============================================================================
   SISTEMA DE MANUFACTURA - FASE 1: MODIFICAR TABLAS EXISTENTES
   
   ALCANCE:
   Agregar columnas necesarias a tablas existentes:
   - products: inventory_behavior, production_type, is_component, bom_id
   - product_variants: inventory_behavior, production_type, is_component, bom_id
   - sale_lines: bom_snapshot, production_cost, components_consumed
   - tenant_settings: configuraciones manufactura
   
   ORDEN DE EJECUCIÓN: 2/6
   PREREQUISITO: MANUFACTURING_PHASE1_BASE_TABLES.sql
   ============================================================================ */

-- =====================================================================
-- 1. MODIFICAR TABLA PRODUCTS
-- =====================================================================

-- Agregar columnas de comportamiento de inventario
ALTER TABLE products 
  ADD COLUMN IF NOT EXISTS inventory_behavior TEXT 
    CHECK (inventory_behavior IN ('RESELL', 'MANUFACTURED', 'SERVICE', 'BUNDLE'));

ALTER TABLE products 
  ADD COLUMN IF NOT EXISTS production_type TEXT 
    CHECK (production_type IN ('ON_DEMAND', 'TO_STOCK'));

ALTER TABLE products 
  ADD COLUMN IF NOT EXISTS is_component BOOLEAN DEFAULT FALSE;

ALTER TABLE products 
  ADD COLUMN IF NOT EXISTS bom_id UUID REFERENCES bill_of_materials(bom_id) ON DELETE SET NULL;

-- Agregar constraint: si MANUFACTURED debe tener production_type
ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_manufacturing_check;

ALTER TABLE products
  ADD CONSTRAINT products_manufacturing_check
  CHECK (
    (inventory_behavior = 'MANUFACTURED' AND production_type IN ('ON_DEMAND', 'TO_STOCK')) OR
    (inventory_behavior != 'MANUFACTURED' AND production_type IS NULL) OR
    (inventory_behavior IS NULL)
  );

-- Índices
CREATE INDEX IF NOT EXISTS idx_products_inventory_behavior ON products(tenant_id, inventory_behavior);
CREATE INDEX IF NOT EXISTS idx_products_production_type ON products(tenant_id, production_type);
CREATE INDEX IF NOT EXISTS idx_products_is_component ON products(tenant_id, is_component) WHERE is_component = TRUE;

COMMENT ON COLUMN products.inventory_behavior IS 'Comportamiento del producto: RESELL (reventa), MANUFACTURED (fabricado), SERVICE (servicio), BUNDLE (kit). NULL hereda de categoría.';
COMMENT ON COLUMN products.production_type IS 'Tipo de producción si MANUFACTURED: ON_DEMAND (al vender) o TO_STOCK (anticipado). NULL si no es MANUFACTURED.';
COMMENT ON COLUMN products.is_component IS 'TRUE si este producto puede usarse como componente en BOM de otros productos.';
COMMENT ON COLUMN products.bom_id IS 'BOM activo a nivel producto. Variantes pueden sobrescribir con su propio BOM.';

-- =====================================================================
-- 2. MODIFICAR TABLA PRODUCT_VARIANTS
-- =====================================================================

-- Agregar mismas columnas que products (sobrescriben si no son NULL)
ALTER TABLE product_variants 
  ADD COLUMN IF NOT EXISTS inventory_behavior TEXT 
    CHECK (inventory_behavior IN ('RESELL', 'MANUFACTURED', 'SERVICE', 'BUNDLE'));

ALTER TABLE product_variants 
  ADD COLUMN IF NOT EXISTS production_type TEXT 
    CHECK (production_type IN ('ON_DEMAND', 'TO_STOCK'));

ALTER TABLE product_variants 
  ADD COLUMN IF NOT EXISTS is_component BOOLEAN;

ALTER TABLE product_variants 
  ADD COLUMN IF NOT EXISTS bom_id UUID REFERENCES bill_of_materials(bom_id) ON DELETE SET NULL;

-- Constraint igual que products
ALTER TABLE product_variants
  DROP CONSTRAINT IF EXISTS variants_manufacturing_check;

ALTER TABLE product_variants
  ADD CONSTRAINT variants_manufacturing_check
  CHECK (
    (inventory_behavior = 'MANUFACTURED' AND production_type IN ('ON_DEMAND', 'TO_STOCK')) OR
    (inventory_behavior != 'MANUFACTURED' AND production_type IS NULL) OR
    (inventory_behavior IS NULL)
  );

-- Índices
CREATE INDEX IF NOT EXISTS idx_variants_inventory_behavior ON product_variants(tenant_id, inventory_behavior);
CREATE INDEX IF NOT EXISTS idx_variants_production_type ON product_variants(tenant_id, production_type);
CREATE INDEX IF NOT EXISTS idx_variants_is_component ON product_variants(tenant_id, is_component) WHERE is_component = TRUE;

COMMENT ON COLUMN product_variants.inventory_behavior IS 'Sobrescribe inventory_behavior del producto. NULL hereda del producto.';
COMMENT ON COLUMN product_variants.production_type IS 'Sobrescribe production_type del producto. NULL hereda del producto.';
COMMENT ON COLUMN product_variants.is_component IS 'Sobrescribe is_component del producto. NULL hereda del producto.';
COMMENT ON COLUMN product_variants.bom_id IS 'BOM específico de esta variante. Sobrescribe BOM del producto si no es NULL.';

-- =====================================================================
-- 3. MODIFICAR TABLA SALE_LINES
-- =====================================================================

-- Snapshot del BOM usado (para ON_DEMAND)
ALTER TABLE sale_lines 
  ADD COLUMN IF NOT EXISTS bom_snapshot JSONB;

-- Costo real de producción (suma costos componentes)
ALTER TABLE sale_lines 
  ADD COLUMN IF NOT EXISTS production_cost NUMERIC(14,2);

-- Array de componentes consumidos (denormalizado para queries rápidas)
ALTER TABLE sale_lines 
  ADD COLUMN IF NOT EXISTS components_consumed JSONB;

-- Índices para queries frecuentes
CREATE INDEX IF NOT EXISTS idx_sale_lines_production_cost ON sale_lines(production_cost) WHERE production_cost IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sale_lines_bom_snapshot ON sale_lines USING GIN(bom_snapshot) WHERE bom_snapshot IS NOT NULL;

COMMENT ON COLUMN sale_lines.bom_snapshot IS 'Snapshot inmutable del BOM usado en venta ON_DEMAND. Incluye: bom_id, version, components[].';
COMMENT ON COLUMN sale_lines.production_cost IS 'Costo real de producción ON_DEMAND = suma(component_cost × quantity_consumed). NULL si no es ON_DEMAND.';
COMMENT ON COLUMN sale_lines.components_consumed IS 'Array de componentes consumidos: [{variant_id, sku, quantity, unit_cost, batch_id}]. Para reporting rápido.';

-- =====================================================================
-- 4. MODIFICAR TENANT_SETTINGS
-- =====================================================================

-- Configuraciones específicas de manufactura
ALTER TABLE tenant_settings 
  ADD COLUMN IF NOT EXISTS max_bom_depth INTEGER DEFAULT 5 CHECK (max_bom_depth >= 1 AND max_bom_depth <= 10);

ALTER TABLE tenant_settings 
  ADD COLUMN IF NOT EXISTS component_costing_method TEXT DEFAULT 'FIFO' 
    CHECK (component_costing_method IN ('FIFO', 'AVERAGE', 'LAST'));

ALTER TABLE tenant_settings 
  ADD COLUMN IF NOT EXISTS allow_expired_in_production BOOLEAN DEFAULT FALSE;

ALTER TABLE tenant_settings 
  ADD COLUMN IF NOT EXISTS block_component_sale_if_bom_active BOOLEAN DEFAULT FALSE;

ALTER TABLE tenant_settings 
  ADD COLUMN IF NOT EXISTS require_production_approval BOOLEAN DEFAULT FALSE;

ALTER TABLE tenant_settings 
  ADD COLUMN IF NOT EXISTS allow_partial_production BOOLEAN DEFAULT TRUE;

ALTER TABLE tenant_settings 
  ADD COLUMN IF NOT EXISTS track_production_waste BOOLEAN DEFAULT FALSE;

ALTER TABLE tenant_settings 
  ADD COLUMN IF NOT EXISTS include_labor_in_cost BOOLEAN DEFAULT FALSE;

ALTER TABLE tenant_settings 
  ADD COLUMN IF NOT EXISTS include_overhead_in_cost BOOLEAN DEFAULT FALSE;

ALTER TABLE tenant_settings 
  ADD COLUMN IF NOT EXISTS allow_ondemand_returns BOOLEAN DEFAULT FALSE;

ALTER TABLE tenant_settings 
  ADD COLUMN IF NOT EXISTS reverse_components_on_return BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN tenant_settings.max_bom_depth IS 'Profundidad máxima permitida para BOM recursivos (recomendado: 5).';
COMMENT ON COLUMN tenant_settings.component_costing_method IS 'Método para calcular costo de componentes: FIFO (lote más antiguo), AVERAGE (promedio móvil), LAST (último costo).';
COMMENT ON COLUMN tenant_settings.allow_expired_in_production IS 'Permitir usar componentes vencidos en producción (con warning).';
COMMENT ON COLUMN tenant_settings.block_component_sale_if_bom_active IS 'Bloquear venta directa de componente si existe BOM activo que lo use.';
COMMENT ON COLUMN tenant_settings.require_production_approval IS 'Órdenes de producción requieren aprobación antes de iniciar.';
COMMENT ON COLUMN tenant_settings.allow_partial_production IS 'Permitir completar orden produciendo menos cantidad de la planeada.';
COMMENT ON COLUMN tenant_settings.track_production_waste IS 'Registrar desperdicios en producción (cantidad real vs teórica).';
COMMENT ON COLUMN tenant_settings.include_labor_in_cost IS 'Incluir mano de obra directa (MOD) en costo producto terminado.';
COMMENT ON COLUMN tenant_settings.include_overhead_in_cost IS 'Incluir costos indirectos fabricación (CIF) en costo producto terminado.';
COMMENT ON COLUMN tenant_settings.allow_ondemand_returns IS 'Permitir devolución de productos ON_DEMAND (que nunca tuvieron stock).';
COMMENT ON COLUMN tenant_settings.reverse_components_on_return IS 'Al devolver ON_DEMAND, retornar componentes a inventario (ej: devolución inmediata).';

-- =====================================================================
-- 5. MIGRAR DATOS EXISTENTES A "RESELL"
-- =====================================================================

-- Todos los productos actuales son RESELL (comportamiento actual)
UPDATE products 
SET inventory_behavior = 'RESELL'
WHERE inventory_behavior IS NULL
  AND is_active = TRUE;

UPDATE product_variants 
SET inventory_behavior = NULL -- Heredan de products
WHERE inventory_behavior IS NULL;

-- =====================================================================
-- 6. VERIFICACIÓN
-- =====================================================================

DO $$
DECLARE
  v_products_count INT;
  v_variants_count INT;
  v_settings_count INT;
BEGIN
  SELECT COUNT(*) INTO v_products_count FROM products WHERE inventory_behavior = 'RESELL';
  SELECT COUNT(*) INTO v_variants_count FROM product_variants;
  SELECT COUNT(*) INTO v_settings_count FROM tenant_settings WHERE max_bom_depth IS NOT NULL;
  
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ TABLAS EXISTENTES MODIFICADAS PARA MANUFACTURA';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Modificaciones completadas:';
  RAISE NOTICE '  ✓ products - agregadas 4 columnas (inventory_behavior, production_type, is_component, bom_id)';
  RAISE NOTICE '  ✓ product_variants - agregadas 4 columnas (sobrescriben products)';
  RAISE NOTICE '  ✓ sale_lines - agregadas 3 columnas (bom_snapshot, production_cost, components_consumed)';
  RAISE NOTICE '  ✓ tenant_settings - agregadas 11 configuraciones manufactura';
  RAISE NOTICE '';
  RAISE NOTICE 'Migración datos:';
  RAISE NOTICE '  • % productos migrados a RESELL', v_products_count;
  RAISE NOTICE '  • % variantes con herencia configurada', v_variants_count;
  RAISE NOTICE '  • % tenants con configuración manufactura', v_settings_count;
  RAISE NOTICE '';
  RAISE NOTICE 'SIGUIENTE PASO: Ejecutar MANUFACTURING_PHASE1_HELPER_FUNCTIONS.sql';
  RAISE NOTICE '════════════════════════════════════════════════════════';
END $$;
