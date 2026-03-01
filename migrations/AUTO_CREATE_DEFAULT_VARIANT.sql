-- ============================================================================
-- SISTEMA DE AUTO-GENERACIÓN DE VARIANTE PREDETERMINADA
-- ============================================================================
-- Descripción: Crea automáticamente una variante predeterminada al crear productos
-- Autor: Sistema POS Lite
-- Fecha: 2026-02-18
--
-- Incluye:
--   1. Función fn_create_default_variant() - Genera variante con SKU único
--   2. Trigger trg_auto_create_default_variant - Se dispara en INSERT products
--   3. Función fn_generate_unique_sku() - Algoritmo de generación SKU
-- ============================================================================

-- ============================================================================
-- 1. FUNCIÓN PARA GENERAR SKU ÚNICO
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_generate_unique_sku(
  p_tenant_id UUID,
  p_product_name TEXT
) RETURNS TEXT AS $$
DECLARE
  v_sku TEXT;
  v_base TEXT;
  v_counter INTEGER;
  v_max_attempts INTEGER := 100;
BEGIN
  -- Generar base del SKU: primeras 3 letras del producto
  v_base := UPPER(SUBSTRING(REGEXP_REPLACE(p_product_name, '[^A-Za-z0-9]', '', 'g') FROM 1 FOR 3));
  
  -- Si no hay letras suficientes, usar 'PRD'
  IF LENGTH(v_base) < 3 THEN
    v_base := 'PRD';
  END IF;
  
  -- Agregar fecha en formato YYMMDD
  v_base := v_base || '-' || TO_CHAR(NOW(), 'YYMMDD');
  
  v_counter := 0;
  
  -- Intentar generar SKU único (hasta 100 intentos)
  LOOP
    -- Generar número aleatorio de 4 dígitos
    v_sku := v_base || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
    
    -- Verificar si existe
    IF NOT EXISTS (
      SELECT 1 FROM product_variants 
      WHERE tenant_id = p_tenant_id AND sku = v_sku
    ) THEN
      RETURN v_sku;
    END IF;
    
    v_counter := v_counter + 1;
    
    IF v_counter >= v_max_attempts THEN
      RAISE EXCEPTION 'No se pudo generar SKU único después de % intentos para producto "%"', 
        v_max_attempts, p_product_name;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_generate_unique_sku IS 
  'Genera un SKU único en formato: [3LETRAS]-[YYMMDD]-[4DIGITOS] para un tenant específico.';

-- ============================================================================
-- 2. FUNCIÓN PARA CREAR VARIANTE PREDETERMINADA
-- ============================================================================

-- Eliminar versiones anteriores de la función
DROP FUNCTION IF EXISTS fn_create_default_variant(UUID, UUID, TEXT, NUMERIC, NUMERIC, UUID, BOOLEAN, BOOLEAN, BOOLEAN);
DROP FUNCTION IF EXISTS fn_create_default_variant(UUID, UUID, TEXT, NUMERIC, NUMERIC, UUID, BOOLEAN, BOOLEAN, BOOLEAN, NUMERIC);

CREATE OR REPLACE FUNCTION fn_create_default_variant(
  p_tenant_id UUID,
  p_product_id UUID,
  p_product_name TEXT,
  p_base_cost NUMERIC DEFAULT 0,
  p_base_price NUMERIC DEFAULT 0,
  p_unit_id UUID DEFAULT NULL,
  p_track_inventory BOOLEAN DEFAULT TRUE,
  p_requires_expiration BOOLEAN DEFAULT FALSE,
  p_is_active BOOLEAN DEFAULT TRUE,
  p_min_stock NUMERIC DEFAULT 0
) RETURNS UUID AS $$
DECLARE
  v_variant_id UUID;
  v_sku TEXT;
BEGIN
  -- Generar SKU único
  v_sku := fn_generate_unique_sku(p_tenant_id, p_product_name);
  
  -- Insertar variante predeterminada
  INSERT INTO product_variants (
    tenant_id,
    product_id,
    sku,
    variant_name,
    cost,
    price,
    price_includes_tax,
    pricing_method,
    markup_percentage,
    price_rounding,
    rounding_to,
    min_stock,
    allow_backorder,
    requires_expiration,
    is_active,
    unit_id
  ) VALUES (
    p_tenant_id,
    p_product_id,
    v_sku,
    'Predeterminado',  -- Nombre de variante predeterminada
    p_base_cost,
    p_base_price,
    FALSE,             -- price_includes_tax por defecto
    'MARKUP',          -- pricing_method estándar
    0,                 -- markup_percentage inicial
    'NONE',            -- sin redondeo por defecto
    0,                 -- rounding_to
    p_min_stock,       -- min_stock desde parámetro
    FALSE,             -- allow_backorder por defecto
    p_requires_expiration,
    p_is_active,
    p_unit_id
  )
  RETURNING variant_id INTO v_variant_id;
  
  RAISE NOTICE 'Variante predeterminada creada: product_id=%, variant_id=%, SKU=%', 
    p_product_id, v_variant_id, v_sku;
  
  RETURN v_variant_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_create_default_variant IS 
  'Crea automáticamente una variante predeterminada para un producto con SKU único generado.';

-- ============================================================================
-- 3. TRIGGER PARA AUTO-CREAR VARIANTE AL INSERTAR PRODUCTO
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_auto_create_default_variant_fn()
RETURNS TRIGGER AS $$
DECLARE
  v_variant_id UUID;
  v_base_cost NUMERIC;
  v_base_price NUMERIC;
  v_base_min_stock NUMERIC;
BEGIN
  -- Solo crear variante si NO existe ninguna para este producto
  IF NOT EXISTS (
    SELECT 1 FROM product_variants 
    WHERE product_id = NEW.product_id AND tenant_id = NEW.tenant_id
  ) THEN
    
    -- Extraer base_cost y base_price si existen (campos temporales)
    -- Si no existen, usar valores por defecto 0
    v_base_cost := COALESCE(NEW.base_cost, 0);
    v_base_price := COALESCE(NEW.base_price, 0);
    v_base_min_stock := COALESCE(NEW.base_min_stock, 0);
    
    -- Crear variante predeterminada
    v_variant_id := fn_create_default_variant(
      p_tenant_id := NEW.tenant_id,
      p_product_id := NEW.product_id,
      p_product_name := NEW.name,
      p_base_cost := v_base_cost,
      p_base_price := v_base_price,
      p_unit_id := NEW.unit_id,
      p_track_inventory := NEW.track_inventory,
      p_requires_expiration := NEW.requires_expiration,
      p_is_active := NEW.is_active,
      p_min_stock := v_base_min_stock
    );
    
    RAISE NOTICE 'Trigger auto-creó variante % para producto %', v_variant_id, NEW.product_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Eliminar trigger anterior si existe
DROP TRIGGER IF EXISTS trg_auto_create_default_variant ON products;

-- Crear trigger AFTER INSERT
CREATE TRIGGER trg_auto_create_default_variant
  AFTER INSERT ON products
  FOR EACH ROW
  EXECUTE FUNCTION trg_auto_create_default_variant_fn();

COMMENT ON TRIGGER trg_auto_create_default_variant ON products IS 
  'Crea automáticamente una variante predeterminada cuando se inserta un nuevo producto.';

-- ============================================================================
-- 4. AGREGAR COLUMNAS TEMPORALES A PRODUCTS (OPCIONAL)
-- ============================================================================
-- Estas columnas permiten pasar base_cost y base_price desde el frontend
-- al momento de crear el producto. NO se almacenan permanentemente.

DO $$ 
BEGIN
  -- base_cost
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'products' AND column_name = 'base_cost'
  ) THEN
    ALTER TABLE products ADD COLUMN base_cost NUMERIC(14,2) DEFAULT NULL;
    COMMENT ON COLUMN products.base_cost IS 'Temporal: Costo base para generar variante predeterminada.';
    RAISE NOTICE '✓ Columna products.base_cost agregada';
  ELSE
    RAISE NOTICE '⊙ Columna products.base_cost ya existe';
  END IF;
  
  -- base_price
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'products' AND column_name = 'base_price'
  ) THEN
    ALTER TABLE products ADD COLUMN base_price NUMERIC(14,2) DEFAULT NULL;
    COMMENT ON COLUMN products.base_price IS 'Temporal: Precio base para generar variante predeterminada.';
    RAISE NOTICE '✓ Columna products.base_price agregada';
  ELSE
    RAISE NOTICE '⊙ Columna products.base_price ya existe';
  END IF;  
  -- base_min_stock
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'products' AND column_name = 'base_min_stock'
  ) THEN
    ALTER TABLE products ADD COLUMN base_min_stock NUMERIC(14,2) DEFAULT NULL;
    COMMENT ON COLUMN products.base_min_stock IS 'Temporal: Stock mínimo base para generar variante predeterminada.';
    RAISE NOTICE '✓ Columna products.base_min_stock agregada';
  ELSE
    RAISE NOTICE '⊊ Columna products.base_min_stock ya existe';
  END IF;END $$;

-- ============================================================================
-- 5. FUNCIÓN HELPER: Obtener variante predeterminada de un producto
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_get_default_variant(
  p_tenant_id UUID,
  p_product_id UUID
) RETURNS UUID AS $$
DECLARE
  v_variant_id UUID;
BEGIN
  -- Buscar variante con nombre 'Predeterminado'
  SELECT variant_id INTO v_variant_id
  FROM product_variants
  WHERE tenant_id = p_tenant_id
  AND product_id = p_product_id
  AND variant_name = 'Predeterminado'
  AND is_active = TRUE
  LIMIT 1;
  
  -- Si no existe, retornar la primera variante activa del producto
  IF v_variant_id IS NULL THEN
    SELECT variant_id INTO v_variant_id
    FROM product_variants
    WHERE tenant_id = p_tenant_id
    AND product_id = p_product_id
    AND is_active = TRUE
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;
  
  RETURN v_variant_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_get_default_variant IS 
  'Obtiene el variant_id de la variante predeterminada de un producto.';

-- ============================================================================
-- 6. VERIFICACIÓN Y TESTING
-- ============================================================================

DO $$ 
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ SISTEMA AUTO-GENERACIÓN VARIANTES INSTALADO';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE '📦 Componentes instalados:';
  RAISE NOTICE '  ✓ fn_generate_unique_sku() - Genera SKU únicos';
  RAISE NOTICE '  ✓ fn_create_default_variant() - Crea variante predeterminada';
  RAISE NOTICE '  ✓ trg_auto_create_default_variant - Trigger en INSERT products';
  RAISE NOTICE '  ✓ fn_get_default_variant() - Helper para obtener variante';
  RAISE NOTICE '  ✓ products.base_cost y base_price (columnas temporales)';
  RAISE NOTICE '';
  RAISE NOTICE '🔧 Funcionamiento:';
  RAISE NOTICE '  1. Usuario crea producto con base_cost y base_price';
  RAISE NOTICE '  2. Trigger detecta INSERT en products';
  RAISE NOTICE '  3. Genera SKU único formato: [ABC]-[260218]-[1234]';
  RAISE NOTICE '  4. Crea variante "Predeterminado" automáticamente';
  RAISE NOTICE '  5. Producto inmediatamente vendible/inventariable';
  RAISE NOTICE '';
  RAISE NOTICE '📝 Testing rápido:';
  RAISE NOTICE '  -- Asegúrate de tener un tenant_id válido';
  RAISE NOTICE '  SET app.current_tenant_id = ''tu-tenant-id'';';
  RAISE NOTICE '  ';
  RAISE NOTICE '  INSERT INTO products (tenant_id, name, base_cost, base_price)';
  RAISE NOTICE '  VALUES (''tu-tenant-id'', ''Producto Test'', 1000, 1500);';
  RAISE NOTICE '  ';
  RAISE NOTICE '  SELECT * FROM product_variants WHERE product_id = (';
  RAISE NOTICE '    SELECT product_id FROM products WHERE name = ''Producto Test'' LIMIT 1';
  RAISE NOTICE '  );';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️  Próximos pasos:';
  RAISE NOTICE '  1. Actualizar frontend Products.vue (agregar base_cost/base_price)';
  RAISE NOTICE '  2. Actualizar productsService.createProduct()';
  RAISE NOTICE '  3. Ejecutar script migración productos existentes sin variantes';
  RAISE NOTICE '  4. Testing E2E crear producto → vender → inventario';
  RAISE NOTICE '';
END $$;
