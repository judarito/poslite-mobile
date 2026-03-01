-- ===================================================================
-- Migración: Soportar Precios con IVA Incluido
-- Fecha: 2026-02-14
-- Descripción: 
--   Agregar campo price_includes_tax a product_variants para
--   soportar productos con impuesto ya incluido en el precio
-- ===================================================================

-- =================================================================
-- 1. AGREGAR CAMPO A PRODUCT_VARIANTS
-- =================================================================
ALTER TABLE product_variants 
ADD COLUMN IF NOT EXISTS price_includes_tax BOOLEAN DEFAULT false;

COMMENT ON COLUMN product_variants.price_includes_tax IS 
'false: precio NO incluye impuesto (se suma al final)
true: precio YA incluye impuesto (se descompone)

Ejemplo false: $10.000 + 19% IVA = $11.900
Ejemplo true: $10.000 (ya tiene IVA dentro, base=$8.403,36 + IVA=$1.596,64)';

-- Actualizar registros existentes (por defecto NO incluye impuesto)
UPDATE product_variants 
SET price_includes_tax = false 
WHERE price_includes_tax IS NULL;

-- =================================================================
-- 2. FUNCIÓN: Calcular base e impuesto según tipo de precio
-- =================================================================
CREATE OR REPLACE FUNCTION fn_calculate_tax_breakdown(
  p_price_after_discount numeric,
  p_tax_rate numeric,
  p_price_includes_tax boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_base numeric;
  v_tax numeric;
  v_total numeric;
BEGIN
  -- Validaciones
  IF p_price_after_discount < 0 THEN
    RAISE EXCEPTION 'El precio después de descuento no puede ser negativo';
  END IF;
  
  IF p_tax_rate < 0 OR p_tax_rate > 1 THEN
    RAISE EXCEPTION 'La tasa de impuesto debe estar entre 0 y 1 (ej: 0.19 para 19%%)';
  END IF;

  -- Caso A: Precio NO incluye impuesto (adicional)
  IF NOT p_price_includes_tax THEN
    v_base := p_price_after_discount;
    v_tax := ROUND(v_base * p_tax_rate, 2);
    v_total := v_base + v_tax;
    
  -- Caso B: Precio incluye impuesto (descomponer)
  ELSE
    v_total := p_price_after_discount;
    v_base := ROUND(v_total / (1 + p_tax_rate), 2);
    v_tax := v_total - v_base;
  END IF;

  RETURN jsonb_build_object(
    'base', v_base,
    'tax', v_tax,
    'total', v_total,
    'price_includes_tax', p_price_includes_tax
  );
END;
$$;

COMMENT ON FUNCTION fn_calculate_tax_breakdown IS 
'Calcula la descomposición base/impuesto/total según si el precio incluye o no el impuesto.

Ejemplos:
- fn_calculate_tax_breakdown(10000, 0.19, false) → {base: 10000, tax: 1900, total: 11900}
- fn_calculate_tax_breakdown(10000, 0.19, true)  → {base: 8403.36, tax: 1596.64, total: 10000}';

-- =================================================================
-- 3. VISTA: Productos con información de impuestos
-- =================================================================
CREATE OR REPLACE VIEW v_products_with_tax_info AS
SELECT 
  pv.variant_id,
  pv.tenant_id,
  pv.product_id,
  pv.sku,
  pv.variant_name,
  pv.cost,
  pv.price AS price_entered,
  pv.price_includes_tax,
  p.name AS product_name,
  c.name AS category_name,
  
  -- Si el precio incluye IVA, mostrar base y tax separados (asumiendo 19% si aplica)
  CASE 
    WHEN pv.price_includes_tax THEN ROUND(pv.price / 1.19, 2)
    ELSE pv.price
  END AS base_price,
  
  CASE 
    WHEN pv.price_includes_tax THEN pv.price - ROUND(pv.price / 1.19, 2)
    ELSE 0
  END AS tax_in_price,
  
  pv.is_active
FROM product_variants pv
JOIN products p ON p.product_id = pv.product_id
LEFT JOIN categories c ON c.category_id = p.category_id;

COMMENT ON VIEW v_products_with_tax_info IS 
'Vista que muestra productos con su precio descompuesto si incluye impuesto';

-- =================================================================
-- 4. EJEMPLOS DE USO
-- =================================================================

-- Ejemplo 1: Producto SIN IVA incluido (tradicional)
-- Precio: $10.000, IVA 19%
-- SELECT fn_calculate_tax_breakdown(10000, 0.19, false);
-- → {"base": 10000, "tax": 1900, "total": 11900}

-- Ejemplo 2: Producto CON IVA incluido
-- Precio: $10.000 (ya tiene IVA dentro), IVA 19%
-- SELECT fn_calculate_tax_breakdown(10000, 0.19, true);
-- → {"base": 8403.36, "tax": 1596.64, "total": 10000}

-- Ejemplo 3: Con descuento - IVA incluido
-- Precio original: $10.000 con IVA
-- Descuento 10% = $1.000
-- Precio después descuento: $9.000
-- SELECT fn_calculate_tax_breakdown(9000, 0.19, true);
-- → {"base": 7563.03, "tax": 1436.97, "total": 9000}

-- =================================================================
-- MENSAJES DE CONFIRMACIÓN
-- =================================================================
DO $$
BEGIN
  RAISE NOTICE '✅ Campo price_includes_tax agregado a product_variants';
  RAISE NOTICE '✅ Función fn_calculate_tax_breakdown creada';
  RAISE NOTICE '✅ Vista v_products_with_tax_info creada';
  RAISE NOTICE '';
  RAISE NOTICE '📝 IMPORTANTE - Flujo correcto de cálculo:';
  RAISE NOTICE '   1. Precio unitario × cantidad = subtotal_línea';
  RAISE NOTICE '   2. Aplicar descuento de línea';
  RAISE NOTICE '   3. Aplicar descuento global (distribuido)';
  RAISE NOTICE '   4. precio_después_descuentos = resultado paso 3';
  RAISE NOTICE '   5. fn_calculate_tax_breakdown(precio_después_descuentos, tasa, price_includes_tax)';
  RAISE NOTICE '   6. Usar base, tax y total del resultado';
  RAISE NOTICE '';
  RAISE NOTICE '🔧 Próximos pasos:';
  RAISE NOTICE '   - Actualizar sp_create_sale para usar esta función';
  RAISE NOTICE '   - Actualizar sp_create_layaway para usar esta función';
  RAISE NOTICE '   - Actualizar frontend para leer price_includes_tax';
END $$;
