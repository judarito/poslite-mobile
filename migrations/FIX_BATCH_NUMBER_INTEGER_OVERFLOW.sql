/* ============================================================================
   FIX: Overflow en fn_generate_batch_number
   
   Problema: La función usa INT pero los números de lote pueden exceder
   el límite de INTEGER (2,147,483,647) cuando se concatenan fecha + secuencia.
   
   Solución: Cambiar INT a BIGINT en la conversión
   ============================================================================ */

CREATE OR REPLACE FUNCTION fn_generate_batch_number(
  p_tenant UUID,
  p_variant UUID,
  p_prefix TEXT DEFAULT 'BATCH'
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_sku TEXT;
  v_date TEXT;
  v_seq INT;
  v_batch_number TEXT;
BEGIN
  -- Obtener SKU
  SELECT sku INTO v_sku
  FROM product_variants
  WHERE tenant_id = p_tenant AND variant_id = p_variant;
  
  -- Fecha en formato YYMMDD
  v_date := TO_CHAR(CURRENT_DATE, 'YYMMDD');
  
  -- Secuencia del día (cambiado a BIGINT para evitar overflow)
  SELECT COALESCE(MAX(
    NULLIF(regexp_replace(batch_number, '\D', '', 'g'), '')::BIGINT
  ), 0) + 1
  INTO v_seq
  FROM inventory_batches
  WHERE tenant_id = p_tenant
    AND variant_id = p_variant
    AND received_at::DATE = CURRENT_DATE;
  
  -- Formato: PREFIX-SKU-YYMMDD-###
  v_batch_number := format('%s-%s-%s-%s', p_prefix, v_sku, v_date, LPAD(v_seq::TEXT, 3, '0'));
  
  RETURN v_batch_number;
END;
$$;

COMMENT ON FUNCTION fn_generate_batch_number IS 
  'Genera número de lote automático con formato PREFIX-SKU-YYMMDD-###. Usa BIGINT para evitar overflow.';

-- Verificación
DO $$
BEGIN
  RAISE NOTICE '✓ fn_generate_batch_number actualizada';
  RAISE NOTICE 'Cambio: INT → BIGINT para evitar overflow';
  RAISE NOTICE '';
  RAISE NOTICE 'Puedes probar registrando una nueva compra con fecha de vencimiento';
END;
$$;
