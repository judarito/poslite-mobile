-- ===================================================================
-- Migración: Agregar Tipo de Descuento (Porcentaje o Valor)
-- Fecha: 2026-02-14
-- Descripción: Permite especificar si el descuento es por porcentaje o valor fijo
--              en líneas de venta, plan separé y otros documentos
-- ===================================================================

-- =================================================================
-- 1. AGREGAR COLUMNA A SALE_LINES
-- =================================================================
ALTER TABLE sale_lines 
ADD COLUMN IF NOT EXISTS discount_type TEXT DEFAULT 'AMOUNT' 
CHECK (discount_type IN ('AMOUNT', 'PERCENT'));

COMMENT ON COLUMN sale_lines.discount_type IS 
'AMOUNT: valor fijo en moneda | PERCENT: porcentaje del subtotal (quantity * unit_price)';

-- Actualizar registros existentes para que tengan el tipo por defecto
UPDATE sale_lines 
SET discount_type = 'AMOUNT' 
WHERE discount_type IS NULL;

-- =================================================================
-- 2. AGREGAR COLUMNA A LAYAWAY_ITEMS (Plan Separé)
-- =================================================================
ALTER TABLE layaway_items 
ADD COLUMN IF NOT EXISTS discount_type TEXT DEFAULT 'AMOUNT' 
CHECK (discount_type IN ('AMOUNT', 'PERCENT'));

COMMENT ON COLUMN layaway_items.discount_type IS 
'AMOUNT: valor fijo en moneda | PERCENT: porcentaje del subtotal (quantity * unit_price)';

UPDATE layaway_items 
SET discount_type = 'AMOUNT' 
WHERE discount_type IS NULL;

-- =================================================================
-- 3. FUNCIÓN AUXILIAR: Calcular descuento según tipo
-- =================================================================
CREATE OR REPLACE FUNCTION fn_calculate_discount(
  p_subtotal numeric,
  p_discount_value numeric,
  p_discount_type text DEFAULT 'AMOUNT'
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  -- Si no hay descuento, retornar 0
  IF p_discount_value IS NULL OR p_discount_value <= 0 THEN
    RETURN 0;
  END IF;

  -- Calcular según el tipo
  CASE p_discount_type
    WHEN 'PERCENT' THEN
      -- Porcentaje: subtotal * (discount_value / 100)
      -- Validar que no exceda 100%
      IF p_discount_value > 100 THEN
        RAISE EXCEPTION 'El porcentaje de descuento no puede ser mayor a 100%%';
      END IF;
      RETURN ROUND(p_subtotal * (p_discount_value / 100), 2);
    
    WHEN 'AMOUNT' THEN
      -- Valor fijo: validar que no exceda el subtotal
      IF p_discount_value > p_subtotal THEN
        RAISE EXCEPTION 'El descuento no puede ser mayor al subtotal';
      END IF;
      RETURN ROUND(p_discount_value, 2);
    
    ELSE
      RAISE EXCEPTION 'Tipo de descuento inválido: %. Use AMOUNT o PERCENT', p_discount_type;
  END CASE;
END;
$$;

COMMENT ON FUNCTION fn_calculate_discount IS 
'Calcula el monto real del descuento según el tipo (AMOUNT o PERCENT)';

-- =================================================================
-- 4. EJEMPLOS DE USO
-- =================================================================

-- Ejemplo 1: Descuento de $5,000 (valor fijo)
-- SELECT fn_calculate_discount(50000, 5000, 'AMOUNT'); -- Retorna: 5000

-- Ejemplo 2: Descuento del 10% (porcentaje)
-- SELECT fn_calculate_discount(50000, 10, 'PERCENT'); -- Retorna: 5000

-- Ejemplo 3: Descuento del 15% sobre $30,000
-- SELECT fn_calculate_discount(30000, 15, 'PERCENT'); -- Retorna: 4500

-- =================================================================
-- 5. VISTA PARA CONSULTAS (Opcional, para debugging)
-- =================================================================
CREATE OR REPLACE VIEW v_sale_lines_with_discounts AS
SELECT 
  sl.sale_line_id,
  sl.sale_id,
  sl.variant_id,
  sl.quantity,
  sl.unit_price,
  (sl.quantity * sl.unit_price) AS subtotal_line,
  sl.discount_type,
  sl.discount_amount AS discount_value_stored,
  CASE 
    WHEN sl.discount_type = 'PERCENT' THEN 
      ROUND((sl.quantity * sl.unit_price) * (sl.discount_amount / 100), 2)
    ELSE 
      sl.discount_amount
  END AS discount_calculated,
  sl.tax_amount,
  sl.line_total
FROM sale_lines sl;

COMMENT ON VIEW v_sale_lines_with_discounts IS 
'Vista que muestra el descuento calculado según su tipo para facilitar consultas';

-- =================================================================
-- MENSAJES DE CONFIRMACIÓN
-- =================================================================
DO $$
BEGIN
  RAISE NOTICE '✅ Columna discount_type agregada a sale_lines';
  RAISE NOTICE '✅ Columna discount_type agregada a layaway_items';
  RAISE NOTICE '✅ Función fn_calculate_discount creada';
  RAISE NOTICE '✅ Vista v_sale_lines_with_discounts creada';
  RAISE NOTICE '';
  RAISE NOTICE '📝 IMPORTANTE:';
  RAISE NOTICE '   - discount_type: AMOUNT (valor fijo) o PERCENT (porcentaje)';
  RAISE NOTICE '   - Si es PERCENT, discount_amount = porcentaje (ej: 10 para 10%%)';
  RAISE NOTICE '   - Si es AMOUNT, discount_amount = valor en moneda';
  RAISE NOTICE '   - Usar fn_calculate_discount() para calcular el descuento real';
  RAISE NOTICE '';
  RAISE NOTICE '🔧 Actualizar stored procedures de ventas para usar esta función';
END $$;
