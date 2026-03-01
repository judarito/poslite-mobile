/* ============================================================================
   SISTEMA DE MANUFACTURA - FASE 1: TABLAS BASE
   
   ALCANCE:
   Creación de 8 nuevas tablas para soportar el sistema completo de manufactura:
   - bill_of_materials (BOM)
   - bom_components
   - production_orders
   - production_order_lines
   - production_outputs
   - bundle_compositions
   - service_deliveries (trazabilidad servicios)
   - component_allocations (trazabilidad consumo componentes)
   
   ORDEN DE EJECUCIÓN: 1/6
   PREREQUISITO: Sistema de lotes implementado (ADD_EXPIRATION_BATCHES_PHASE2.sql)
   ============================================================================ */

-- =====================================================================
-- 1. BILL_OF_MATERIALS (Lista de Materiales)
-- =====================================================================

CREATE TABLE IF NOT EXISTS bill_of_materials (
  bom_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  
  -- Puede estar a nivel producto O variante (no ambos)
  product_id UUID REFERENCES products(product_id) ON DELETE CASCADE,
  variant_id UUID REFERENCES product_variants(variant_id) ON DELETE CASCADE,
  
  bom_code TEXT NOT NULL,
  version INTEGER DEFAULT 1 CHECK (version > 0),
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Auditoría
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(user_id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES users(user_id),
  
  notes TEXT,
  
  -- Constraints
  UNIQUE(tenant_id, product_id, variant_id, version),
  CHECK (
    (product_id IS NOT NULL AND variant_id IS NULL) OR 
    (product_id IS NULL AND variant_id IS NOT NULL)
  )
);

CREATE INDEX idx_bom_tenant_product ON bill_of_materials(tenant_id, product_id) WHERE product_id IS NOT NULL;
CREATE INDEX idx_bom_tenant_variant ON bill_of_materials(tenant_id, variant_id) WHERE variant_id IS NOT NULL;
CREATE INDEX idx_bom_active ON bill_of_materials(tenant_id, is_active) WHERE is_active = TRUE;

COMMENT ON TABLE bill_of_materials IS 'Lista de materiales (BOM) para productos manufacturados. Define componentes necesarios.';
COMMENT ON COLUMN bill_of_materials.version IS 'Versión del BOM. Cada cambio crea nueva versión para trazabilidad histórica.';

-- =====================================================================
-- 2. BOM_COMPONENTS (Componentes del BOM)
-- =====================================================================

CREATE TABLE IF NOT EXISTS bom_components (
  component_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  bom_id UUID NOT NULL REFERENCES bill_of_materials(bom_id) ON DELETE CASCADE,
  
  component_variant_id UUID NOT NULL REFERENCES product_variants(variant_id) ON DELETE RESTRICT,
  
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL, -- 'UND', 'KG', 'LT', 'GR', 'ML', 'MT'
  
  -- Desperdicio estimado (ej: 5% = se consume 1.05x la cantidad teórica)
  waste_percentage NUMERIC(5,2) DEFAULT 0 CHECK (waste_percentage >= 0 AND waste_percentage <= 100),
  
  is_optional BOOLEAN DEFAULT FALSE,
  sequence INTEGER, -- Orden sugerido de consumo (future)
  
  notes TEXT,
  
  UNIQUE(tenant_id, bom_id, component_variant_id)
);

CREATE INDEX idx_bom_comp_bom ON bom_components(bom_id);
CREATE INDEX idx_bom_comp_variant ON bom_components(component_variant_id);

COMMENT ON TABLE bom_components IS 'Componentes individuales de un BOM con cantidades y desperdicios.';
COMMENT ON COLUMN bom_components.waste_percentage IS 'Porcentaje de desperdicio esperado. ej: 5% significa consumir 105g cuando BOM pide 100g.';

-- =====================================================================
-- 3. PRODUCTION_ORDERS (Órdenes de Producción)
-- =====================================================================

CREATE TABLE IF NOT EXISTS production_orders (
  production_order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(location_id) ON DELETE RESTRICT,
  
  order_number TEXT NOT NULL,
  bom_id UUID NOT NULL REFERENCES bill_of_materials(bom_id) ON DELETE RESTRICT,
  product_variant_id UUID NOT NULL REFERENCES product_variants(variant_id) ON DELETE RESTRICT,
  
  -- Cantidades
  quantity_planned NUMERIC(14,3) NOT NULL CHECK (quantity_planned > 0),
  quantity_produced NUMERIC(14,3) DEFAULT 0 CHECK (quantity_produced >= 0),
  
  -- Estados del workflow
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  
  -- Fechas planificadas
  scheduled_start TIMESTAMPTZ,
  scheduled_end TIMESTAMPTZ,
  
  -- Fechas reales
  actual_start TIMESTAMPTZ,
  actual_end TIMESTAMPTZ,
  
  -- Costos
  estimated_cost NUMERIC(14,2),
  actual_cost NUMERIC(14,2),
  labor_cost NUMERIC(14,2) DEFAULT 0, -- Mano de obra directa (MOD)
  overhead_cost NUMERIC(14,2) DEFAULT 0, -- Costos indirectos de fabricación (CIF)
  
  -- Auditoría
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(user_id),
  started_by UUID REFERENCES users(user_id),
  completed_by UUID REFERENCES users(user_id),
  cancelled_by UUID REFERENCES users(user_id),
  cancellation_reason TEXT,
  
  notes TEXT,
  
  UNIQUE(tenant_id, order_number)
);

CREATE INDEX idx_prod_orders_tenant_location ON production_orders(tenant_id, location_id);
CREATE INDEX idx_prod_orders_status ON production_orders(tenant_id, status);
CREATE INDEX idx_prod_orders_variant ON production_orders(product_variant_id);
CREATE INDEX idx_prod_orders_dates ON production_orders(tenant_id, scheduled_start, scheduled_end);

COMMENT ON TABLE production_orders IS 'Órdenes de producción para productos MANUFACTURED TO_STOCK. Workflow: DRAFT → SCHEDULED → IN_PROGRESS → COMPLETED';
COMMENT ON COLUMN production_orders.quantity_planned IS 'Cantidad planificada a producir';
COMMENT ON COLUMN production_orders.quantity_produced IS 'Cantidad realmente producida (puede ser menor = producción parcial)';

-- =====================================================================
-- 4. PRODUCTION_ORDER_LINES (Componentes Consumidos en Producción)
-- =====================================================================

CREATE TABLE IF NOT EXISTS production_order_lines (
  line_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  production_order_id UUID NOT NULL REFERENCES production_orders(production_order_id) ON DELETE CASCADE,
  
  component_variant_id UUID NOT NULL REFERENCES product_variants(variant_id) ON DELETE RESTRICT,
  
  -- Cantidades
  quantity_required NUMERIC(14,3) NOT NULL CHECK (quantity_required > 0),
  quantity_consumed NUMERIC(14,3) DEFAULT 0 CHECK (quantity_consumed >= 0),
  
  -- Costo y lote
  unit_cost NUMERIC(14,2) NOT NULL,
  batch_id UUID REFERENCES inventory_batches(batch_id) ON DELETE SET NULL,
  
  consumed_at TIMESTAMPTZ,
  
  notes TEXT
);

CREATE INDEX idx_prod_lines_order ON production_order_lines(production_order_id);
CREATE INDEX idx_prod_lines_component ON production_order_lines(component_variant_id);
CREATE INDEX idx_prod_lines_batch ON production_order_lines(batch_id);

COMMENT ON TABLE production_order_lines IS 'Detalle de componentes requeridos y consumidos en una orden de producción.';

-- =====================================================================
-- 5. PRODUCTION_OUTPUTS (Productos Terminados Creados)
-- =====================================================================

CREATE TABLE IF NOT EXISTS production_outputs (
  output_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  production_order_id UUID NOT NULL REFERENCES production_orders(production_order_id) ON DELETE CASCADE,
  
  batch_id UUID NOT NULL REFERENCES inventory_batches(batch_id) ON DELETE RESTRICT,
  
  quantity_produced NUMERIC(14,3) NOT NULL CHECK (quantity_produced > 0),
  unit_cost NUMERIC(14,2) NOT NULL, -- Costo promedio: (actual_cost + labor + overhead) / quantity
  
  produced_at TIMESTAMPTZ DEFAULT NOW(),
  produced_by UUID REFERENCES users(user_id),
  
  notes TEXT
);

CREATE INDEX idx_prod_outputs_order ON production_outputs(production_order_id);
CREATE INDEX idx_prod_outputs_batch ON production_outputs(batch_id);
CREATE INDEX idx_prod_outputs_date ON production_outputs(tenant_id, produced_at);

COMMENT ON TABLE production_outputs IS 'Lotes de producto terminado creados por una orden de producción.';
COMMENT ON COLUMN production_outputs.unit_cost IS 'Costo unitario calculado: (suma costos componentes + MOD + CIF) / quantity_produced';

-- =====================================================================
-- 6. BUNDLE_COMPOSITIONS (Composición de Kits/Paquetes)
-- =====================================================================

CREATE TABLE IF NOT EXISTS bundle_compositions (
  composition_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  
  bundle_variant_id UUID NOT NULL REFERENCES product_variants(variant_id) ON DELETE CASCADE,
  component_variant_id UUID NOT NULL REFERENCES product_variants(variant_id) ON DELETE RESTRICT,
  
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  is_active BOOLEAN DEFAULT TRUE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(tenant_id, bundle_variant_id, component_variant_id)
);

CREATE INDEX idx_bundle_comp_bundle ON bundle_compositions(bundle_variant_id);
CREATE INDEX idx_bundle_comp_component ON bundle_compositions(component_variant_id);
CREATE INDEX idx_bundle_comp_active ON bundle_compositions(tenant_id, is_active) WHERE is_active = TRUE;

COMMENT ON TABLE bundle_compositions IS 'Define qué productos componen un bundle/kit. No hay proceso productivo, solo se descuentan componentes.';

-- =====================================================================
-- 7. SERVICE_DELIVERIES (Trazabilidad de Servicios)
-- =====================================================================

CREATE TABLE IF NOT EXISTS service_deliveries (
  delivery_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  sale_id UUID NOT NULL REFERENCES sales(sale_id) ON DELETE CASCADE,
  sale_line_id UUID NOT NULL REFERENCES sale_lines(sale_line_id) ON DELETE CASCADE,
  
  variant_id UUID NOT NULL REFERENCES product_variants(variant_id) ON DELETE RESTRICT,
  
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  
  -- Estado de entrega del servicio
  delivery_status TEXT DEFAULT 'PENDING' CHECK (delivery_status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  
  scheduled_date TIMESTAMPTZ,
  completed_date TIMESTAMPTZ,
  
  performed_by UUID REFERENCES users(user_id),
  
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_service_deliv_sale ON service_deliveries(sale_id);
CREATE INDEX idx_service_deliv_status ON service_deliveries(tenant_id, delivery_status);
CREATE INDEX idx_service_deliv_date ON service_deliveries(tenant_id, scheduled_date);

COMMENT ON TABLE service_deliveries IS 'Trazabilidad de servicios vendidos. Permite tracking de entrega/completitud.';

-- =====================================================================
-- 8. COMPONENT_ALLOCATIONS (Trazabilidad Consumo Componentes)
-- =====================================================================

CREATE TABLE IF NOT EXISTS component_allocations (
  allocation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  
  -- Origen: puede ser venta ON_DEMAND o bundle
  source_type TEXT NOT NULL CHECK (source_type IN ('SALE_ON_DEMAND', 'SALE_BUNDLE')),
  sale_id UUID NOT NULL REFERENCES sales(sale_id) ON DELETE CASCADE,
  sale_line_id UUID NOT NULL REFERENCES sale_lines(sale_line_id) ON DELETE CASCADE,
  
  -- Componente consumido
  component_variant_id UUID NOT NULL REFERENCES product_variants(variant_id) ON DELETE RESTRICT,
  batch_id UUID REFERENCES inventory_batches(batch_id) ON DELETE SET NULL,
  
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(14,2) NOT NULL,
  total_cost NUMERIC(14,2) NOT NULL,
  
  consumed_at TIMESTAMPTZ DEFAULT NOW(),
  
  notes TEXT
);

CREATE INDEX idx_comp_alloc_sale ON component_allocations(sale_id);
CREATE INDEX idx_comp_alloc_line ON component_allocations(sale_line_id);
CREATE INDEX idx_comp_alloc_component ON component_allocations(component_variant_id);
CREATE INDEX idx_comp_alloc_batch ON component_allocations(batch_id);

COMMENT ON TABLE component_allocations IS 'Registro de qué componentes se consumieron en cada venta ON_DEMAND o bundle. FEFO aplicado.';

-- =====================================================================
-- 9. CREAR FUNCIÓN DE GENERACIÓN DE NÚMEROS DE ORDEN
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_next_production_order_number(
  p_tenant UUID,
  p_location UUID
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_prefix TEXT;
  v_sequence INT;
  v_order_number TEXT;
BEGIN
  -- Formato: PRD-YYMMDD-NNNN
  v_prefix := 'PRD-' || TO_CHAR(NOW(), 'YYMMDD') || '-';
  
  -- Obtener último número del día
  SELECT COALESCE(MAX(
    CASE 
      WHEN order_number LIKE v_prefix || '%' THEN
        CAST(SUBSTRING(order_number FROM LENGTH(v_prefix) + 1) AS INTEGER)
      ELSE 0
    END
  ), 0) + 1
  INTO v_sequence
  FROM production_orders
  WHERE tenant_id = p_tenant
    AND location_id = p_location
    AND created_at::DATE = CURRENT_DATE;
  
  v_order_number := v_prefix || LPAD(v_sequence::TEXT, 4, '0');
  
  RETURN v_order_number;
END;
$$;

COMMENT ON FUNCTION fn_next_production_order_number IS 'Genera número único de orden de producción: PRD-YYMMDD-0001';

-- =====================================================================
-- 10. VERIFICACIÓN
-- =====================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ TABLAS BASE DEL SISTEMA DE MANUFACTURA CREADAS';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Tablas creadas (8):';
  RAISE NOTICE '  ✓ bill_of_materials - Listas de materiales';
  RAISE NOTICE '  ✓ bom_components - Componentes del BOM';
  RAISE NOTICE '  ✓ production_orders - Órdenes de producción';
  RAISE NOTICE '  ✓ production_order_lines - Detalle consumo componentes';
  RAISE NOTICE '  ✓ production_outputs - Productos terminados creados';
  RAISE NOTICE '  ✓ bundle_compositions - Composición de kits';
  RAISE NOTICE '  ✓ service_deliveries - Trazabilidad servicios';
  RAISE NOTICE '  ✓ component_allocations - Trazabilidad consumo ON_DEMAND/bundle';
  RAISE NOTICE '';
  RAISE NOTICE 'Funciones auxiliares:';
  RAISE NOTICE '  ✓ fn_next_production_order_number() - Generador números orden';
  RAISE NOTICE '';
  RAISE NOTICE 'SIGUIENTE PASO: Ejecutar MANUFACTURING_PHASE1_ALTER_TABLES.sql';
  RAISE NOTICE '════════════════════════════════════════════════════════';
END $$;
