-- ============================================================================
-- SISTEMA DE UNIDADES DE MEDIDA
-- ============================================================================
-- Descripción: Maestro de unidades de medida con códigos DIAN para Colombia
-- Autor: Sistema POS Lite
-- Fecha: 2026-02-17
--
-- Incluye:
--   1. Tabla units_of_measure (maestro)
--   2. Datos iniciales con códigos DIAN comunes
--   3. Migración de products.unit_id
--   4. Migración de product_variants.unit_id
--   5. Migración de bom_components.unit_id (desde TEXT a FK)
--   6. Políticas RLS
-- ============================================================================

-- ============================================================================
-- 1. CREAR TABLA UNITS_OF_MEASURE
-- ============================================================================

CREATE TABLE IF NOT EXISTS units_of_measure (
  unit_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  
  -- Identificadores
  code VARCHAR(20) NOT NULL,           -- Código interno: 'KG', 'UND', 'MT', etc.
  dian_code VARCHAR(20),                -- Código DIAN oficial Colombia
  
  -- Información descriptiva
  name VARCHAR(100) NOT NULL,          -- Nombre: 'Kilogramo', 'Unidad', 'Metro'
  description TEXT,                     -- Descripción adicional
  
  -- Metadata
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,  -- Si es unidad del sistema (no editable)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Constraints
  UNIQUE(tenant_id, code),
  UNIQUE(tenant_id, name),
  
  -- Permitir unidades globales (tenant_id NULL para sistema)
  CHECK (
    (tenant_id IS NULL AND is_system = TRUE) OR 
    (tenant_id IS NOT NULL)
  )
);

-- Índices
CREATE INDEX idx_units_tenant ON units_of_measure(tenant_id);
CREATE INDEX idx_units_code ON units_of_measure(code);
CREATE INDEX idx_units_active ON units_of_measure(is_active) WHERE is_active = TRUE;

-- Comentarios
COMMENT ON TABLE units_of_measure IS 'Maestro de unidades de medida con códigos DIAN para facturación electrónica Colombia.';
COMMENT ON COLUMN units_of_measure.code IS 'Código interno corto (KG, UND, MT, LT, etc.)';
COMMENT ON COLUMN units_of_measure.dian_code IS 'Código oficial DIAN para facturación electrónica.';
COMMENT ON COLUMN units_of_measure.is_system IS 'Unidades del sistema no editables por usuarios (tenant_id NULL).';

-- ============================================================================
-- 2. INSERTAR UNIDADES DE MEDIDA DEL SISTEMA (CÓDIGOS DIAN)
-- ============================================================================
-- Basado en resolución DIAN 000042 de 2020 - Unidades de medida permitidas
-- https://www.dian.gov.co/atencionciudadano/infoconsulta/anexosresol/2020/42/Anexo_tecnico_Resolucion_000042_de_05_05_2020.pdf

INSERT INTO units_of_measure (tenant_id, code, dian_code, name, description, is_system, is_active) VALUES
-- Unidades de masa
(NULL, 'KG', '28', 'Kilogramo', 'Unidad de masa del sistema internacional', TRUE, TRUE),
(NULL, 'GR', 'GRM', 'Gramo', 'Unidad de masa, milésima parte del kilogramo', TRUE, TRUE),
(NULL, 'MG', 'MGM', 'Miligramo', 'Unidad de masa, milésima parte del gramo', TRUE, TRUE),
(NULL, 'TON', 'TNE', 'Tonelada', 'Unidad de masa, 1000 kilogramos', TRUE, TRUE),
(NULL, 'LB', 'LBR', 'Libra', 'Unidad de masa, aproximadamente 0.453592 kg', TRUE, TRUE),
(NULL, 'OZ', 'ONZ', 'Onza', 'Unidad de masa, 1/16 de libra', TRUE, TRUE),

-- Unidades de volumen/capacidad
(NULL, 'LT', 'LTR', 'Litro', 'Unidad de volumen del sistema internacional', TRUE, TRUE),
(NULL, 'ML', 'MLT', 'Mililitro', 'Unidad de volumen, milésima parte del litro', TRUE, TRUE),
(NULL, 'CM3', 'CMQ', 'Centímetro cúbico', 'Unidad de volumen, equivalente a 1 mililitro', TRUE, TRUE),
(NULL, 'M3', 'MTQ', 'Metro cúbico', 'Unidad de volumen, 1000 litros', TRUE, TRUE),
(NULL, 'GAL', 'GLI', 'Galón', 'Unidad de volumen, 3.785411784 litros', TRUE, TRUE),

-- Unidades de longitud
(NULL, 'MT', 'MTR', 'Metro', 'Unidad de longitud del sistema internacional', TRUE, TRUE),
(NULL, 'CM', 'CMT', 'Centímetro', 'Unidad de longitud, centésima parte del metro', TRUE, TRUE),
(NULL, 'MM', 'MMT', 'Milímetro', 'Unidad de longitud, milésima parte del metro', TRUE, TRUE),
(NULL, 'KM', 'KMT', 'Kilómetro', 'Unidad de longitud, 1000 metros', TRUE, TRUE),
(NULL, 'IN', 'INH', 'Pulgada', 'Unidad de longitud, 2.54 centímetros', TRUE, TRUE),
(NULL, 'FT', 'FOT', 'Pie', 'Unidad de longitud, 30.48 centímetros', TRUE, TRUE),
(NULL, 'YD', 'YRD', 'Yarda', 'Unidad de longitud, 0.9144 metros', TRUE, TRUE),

-- Unidades de área
(NULL, 'M2', 'MTK', 'Metro cuadrado', 'Unidad de superficie del sistema internacional', TRUE, TRUE),
(NULL, 'CM2', 'CMK', 'Centímetro cuadrado', 'Unidad de superficie, centésima parte del metro cuadrado', TRUE, TRUE),
(NULL, 'HA', 'HAR', 'Hectárea', 'Unidad de superficie, 10000 metros cuadrados', TRUE, TRUE),

-- Unidades de tiempo
(NULL, 'HR', 'HUR', 'Hora', 'Unidad de tiempo, 60 minutos', TRUE, TRUE),
(NULL, 'MIN', 'MIN', 'Minuto', 'Unidad de tiempo, 60 segundos', TRUE, TRUE),
(NULL, 'SEG', 'SEC', 'Segundo', 'Unidad de tiempo del sistema internacional', TRUE, TRUE),
(NULL, 'DIA', 'DAY', 'Día', 'Unidad de tiempo, 24 horas', TRUE, TRUE),
(NULL, 'MES', 'MON', 'Mes', 'Unidad de tiempo, aproximadamente 30 días', TRUE, TRUE),
(NULL, 'ANO', 'ANN', 'Año', 'Unidad de tiempo, 365 días', TRUE, TRUE),

-- Unidades de cantidad
(NULL, 'UND', '94', 'Unidad', 'Unidad individual de producto', TRUE, TRUE),
(NULL, 'PAR', 'PR', 'Par', 'Conjunto de dos unidades', TRUE, TRUE),
(NULL, 'DOCENA', 'DZN', 'Docena', 'Conjunto de 12 unidades', TRUE, TRUE),
(NULL, 'CIENTO', 'CEN', 'Ciento', 'Conjunto de 100 unidades', TRUE, TRUE),
(NULL, 'MILLAR', 'MIL', 'Millar', 'Conjunto de 1000 unidades', TRUE, TRUE),

-- Unidades de empaque
(NULL, 'CAJA', 'BX', 'Caja', 'Empaque tipo caja', TRUE, TRUE),
(NULL, 'PAQUETE', 'PK', 'Paquete', 'Empaque tipo paquete', TRUE, TRUE),
(NULL, 'BOLSA', 'BG', 'Bolsa', 'Empaque tipo bolsa', TRUE, TRUE),
(NULL, 'ROLLO', 'RO', 'Rollo', 'Empaque tipo rollo', TRUE, TRUE),
(NULL, 'BOTELLA', 'BO', 'Botella', 'Empaque tipo botella', TRUE, TRUE),
(NULL, 'FRASCO', 'VI', 'Frasco', 'Empaque tipo frasco o vial', TRUE, TRUE),

-- Otras unidades comunes
(NULL, 'KWH', 'KWH', 'Kilovatio-hora', 'Unidad de energía eléctrica', TRUE, TRUE),
(NULL, 'SERV', 'E48', 'Servicio', 'Unidad de servicio prestado', TRUE, TRUE),
(NULL, 'ACT', 'ACT', 'Actividad', 'Unidad de actividad realizada', TRUE, TRUE)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ============================================================================
-- 3. AGREGAR COLUMNA unit_id A PRODUCTS
-- ============================================================================

-- Agregar columna si no existe
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'products' AND column_name = 'unit_id'
  ) THEN
    ALTER TABLE products 
    ADD COLUMN unit_id UUID REFERENCES units_of_measure(unit_id) ON DELETE SET NULL;
    
    RAISE NOTICE '✓ Columna products.unit_id agregada';
  ELSE
    RAISE NOTICE '⊙ Columna products.unit_id ya existe';
  END IF;
END $$;

-- Índice para mejor performance
CREATE INDEX IF NOT EXISTS idx_products_unit ON products(unit_id);

COMMENT ON COLUMN products.unit_id IS 'Unidad de medida del producto (referencia a units_of_measure).';

-- ============================================================================
-- 4. AGREGAR COLUMNA unit_id A PRODUCT_VARIANTS
-- ============================================================================

-- Agregar columna si no existe
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'product_variants' AND column_name = 'unit_id'
  ) THEN
    ALTER TABLE product_variants 
    ADD COLUMN unit_id UUID REFERENCES units_of_measure(unit_id) ON DELETE SET NULL;
    
    RAISE NOTICE '✓ Columna product_variants.unit_id agregada';
  ELSE
    RAISE NOTICE '⊙ Columna product_variants.unit_id ya existe';
  END IF;
END $$;

-- Índice para mejor performance
CREATE INDEX IF NOT EXISTS idx_variants_unit ON product_variants(unit_id);

COMMENT ON COLUMN product_variants.unit_id IS 'Unidad de medida de la variante (puede heredar del producto o tener propia).';

-- ============================================================================
-- 5. MIGRAR BOM_COMPONENTS DE unit TEXT A unit_id UUID
-- ============================================================================

-- Verificar si la tabla existe (solo si manufacturing está instalado)
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'bom_components'
  ) THEN
    
    -- A. Agregar columna unit_id si no existe
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'bom_components' AND column_name = 'unit_id'
    ) THEN
      ALTER TABLE bom_components 
      ADD COLUMN unit_id UUID REFERENCES units_of_measure(unit_id) ON DELETE RESTRICT;
      
      RAISE NOTICE '✓ Columna bom_components.unit_id agregada';
    ELSE
      RAISE NOTICE '⊙ Columna bom_components.unit_id ya existe';
    END IF;
    
    -- B. Migrar datos existentes de TEXT a UUID (mapeo de códigos comunes)
    UPDATE bom_components bc
    SET unit_id = (
      SELECT unit_id FROM units_of_measure 
      WHERE tenant_id IS NULL 
      AND code = UPPER(TRIM(bc.unit))
      LIMIT 1
    )
    WHERE bc.unit_id IS NULL 
    AND bc.unit IS NOT NULL;
    
    RAISE NOTICE '✓ Datos bom_components.unit migrados a unit_id';
    
    -- C. Hacer columna unit_id NOT NULL después de migración
    -- (Solo si todos los registros tienen unit_id asignado)
    IF NOT EXISTS (
      SELECT 1 FROM bom_components WHERE unit_id IS NULL
    ) THEN
      ALTER TABLE bom_components 
      ALTER COLUMN unit_id SET NOT NULL;
      
      RAISE NOTICE '✓ Columna bom_components.unit_id marcada como NOT NULL';
    ELSE
      RAISE WARNING '⚠ Algunos registros bom_components sin unit_id, no se marcó NOT NULL';
      RAISE NOTICE '  Ejecuta manualmente: SELECT * FROM bom_components WHERE unit_id IS NULL;';
    END IF;
    
    -- D. Deprecar columna unit TEXT (mantener por compatibilidad temporal)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'bom_components' AND column_name = 'unit'
    ) THEN
      COMMENT ON COLUMN bom_components.unit IS 
        'DEPRECATED: Usar unit_id (UUID). Campo mantenido temporalmente para compatibilidad.';
      
      RAISE NOTICE '⊙ Columna bom_components.unit marcada como DEPRECATED';
    END IF;
    
    -- E. Crear índice
    CREATE INDEX IF NOT EXISTS idx_bom_comp_unit ON bom_components(unit_id);
    
    COMMENT ON COLUMN bom_components.unit_id IS 'Unidad de medida del componente (referencia a units_of_measure).';
    
  ELSE
    RAISE NOTICE '⊙ Tabla bom_components no existe (manufacturing no instalado)';
  END IF;
END $$;

-- ============================================================================
-- 6. POLÍTICAS RLS (Row Level Security)
-- ============================================================================

-- Habilitar RLS
ALTER TABLE units_of_measure ENABLE ROW LEVEL SECURITY;

-- Política: Los usuarios pueden ver unidades del sistema (tenant_id NULL) y de su tenant
DROP POLICY IF EXISTS units_select_policy ON units_of_measure;
CREATE POLICY units_select_policy ON units_of_measure
  FOR SELECT
  USING (
    tenant_id IS NULL OR  -- Unidades del sistema (visibles para todos)
    tenant_id = (current_setting('app.current_tenant_id', true))::UUID
  );

-- Política: Solo pueden crear unidades para su tenant (no sistema)
DROP POLICY IF EXISTS units_insert_policy ON units_of_measure;
CREATE POLICY units_insert_policy ON units_of_measure
  FOR INSERT
  WITH CHECK (
    tenant_id IS NOT NULL AND 
    tenant_id = (current_setting('app.current_tenant_id', true))::UUID AND
    is_system = FALSE
  );

-- Política: Solo pueden actualizar sus propias unidades (no sistema)
DROP POLICY IF EXISTS units_update_policy ON units_of_measure;
CREATE POLICY units_update_policy ON units_of_measure
  FOR UPDATE
  USING (
    tenant_id IS NOT NULL AND 
    tenant_id = (current_setting('app.current_tenant_id', true))::UUID AND
    is_system = FALSE
  )
  WITH CHECK (
    tenant_id IS NOT NULL AND 
    tenant_id = (current_setting('app.current_tenant_id', true))::UUID AND
    is_system = FALSE
  );

-- Política: Solo pueden eliminar sus propias unidades (no sistema)
DROP POLICY IF EXISTS units_delete_policy ON units_of_measure;
CREATE POLICY units_delete_policy ON units_of_measure
  FOR DELETE
  USING (
    tenant_id IS NOT NULL AND 
    tenant_id = (current_setting('app.current_tenant_id', true))::UUID AND
    is_system = FALSE
  );

-- ============================================================================
-- 7. FUNCIÓN HELPER: Obtener unidad por código
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_get_unit_by_code(
  p_tenant_id UUID,
  p_code VARCHAR
) RETURNS UUID AS $$
DECLARE
  v_unit_id UUID;
BEGIN
  -- Buscar primero en unidades del tenant
  SELECT unit_id INTO v_unit_id
  FROM units_of_measure
  WHERE tenant_id = p_tenant_id
  AND code = UPPER(TRIM(p_code))
  AND is_active = TRUE
  LIMIT 1;
  
  -- Si no existe, buscar en unidades del sistema
  IF v_unit_id IS NULL THEN
    SELECT unit_id INTO v_unit_id
    FROM units_of_measure
    WHERE tenant_id IS NULL
    AND code = UPPER(TRIM(p_code))
    AND is_active = TRUE
    LIMIT 1;
  END IF;
  
  RETURN v_unit_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_get_unit_by_code IS 
  'Obtiene el unit_id de una unidad por su código (busca primero en tenant, luego en sistema).';

-- ============================================================================
-- 8. TRIGGER: Auto-actualizar updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_update_units_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_units_updated_at ON units_of_measure;
CREATE TRIGGER trg_units_updated_at
  BEFORE UPDATE ON units_of_measure
  FOR EACH ROW
  EXECUTE FUNCTION fn_update_units_timestamp();

-- ============================================================================
-- 9. VERIFICACIÓN FINAL
-- ============================================================================

DO $$ 
DECLARE
  v_units_count INTEGER;
  v_products_cols INTEGER;
  v_variants_cols INTEGER;
  v_bom_cols INTEGER;
BEGIN
  -- Contar unidades del sistema
  SELECT COUNT(*) INTO v_units_count 
  FROM units_of_measure 
  WHERE tenant_id IS NULL;
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ SISTEMA DE UNIDADES DE MEDIDA CREADO';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE '📊 Resumen:';
  RAISE NOTICE '  • % unidades del sistema insertadas', v_units_count;
  RAISE NOTICE '  • Tabla units_of_measure creada';
  RAISE NOTICE '  • RLS habilitado (políticas tenant-aware)';
  RAISE NOTICE '';
  
  -- Verificar products
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'products' AND column_name = 'unit_id'
  ) THEN
    RAISE NOTICE '  ✓ products.unit_id agregada';
  END IF;
  
  -- Verificar variants
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'product_variants' AND column_name = 'unit_id'
  ) THEN
    RAISE NOTICE '  ✓ product_variants.unit_id agregada';
  END IF;
  
  -- Verificar bom_components
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'bom_components'
  ) THEN
    RAISE NOTICE '  ✓ bom_components.unit_id migrada';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '🔧 Próximos pasos:';
  RAISE NOTICE '  1. Actualizar frontend para usar units_of_measure';
  RAISE NOTICE '  2. Crear vista UnitsOfMeasure.vue';
  RAISE NOTICE '  3. Modificar formularios productos/BOMs';
  RAISE NOTICE '';
  RAISE NOTICE '📝 Consultas útiles:';
  RAISE NOTICE '  • Ver unidades sistema: SELECT * FROM units_of_measure WHERE tenant_id IS NULL;';
  RAISE NOTICE '  • Migrar producto: UPDATE products SET unit_id = fn_get_unit_by_code(tenant_id, ''UND'');';
  RAISE NOTICE '';
END $$;
