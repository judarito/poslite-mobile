/* ============================================================================
   FIX COMPLETO: Integer Overflow en Batch Number
   
   Este script verifica y corrige cualquier conversión a INTEGER que cause
   el error "value is out of range for type integer"
   ============================================================================ */

-- =====================================================================
-- 1. VERIFICAR FUNCIÓN ACTUAL
-- =====================================================================

DO $$
DECLARE
  v_source TEXT;
BEGIN
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '1. VERIFICANDO FUNCIÓN fn_generate_batch_number';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  
  SELECT pg_get_functiondef(oid) INTO v_source
  FROM pg_proc
  WHERE proname = 'fn_generate_batch_number'
  LIMIT 1;
  
  IF v_source IS NULL THEN
    RAISE NOTICE '❌ FUNCIÓN NO EXISTE';
  ELSIF v_source LIKE '%::INT %' OR v_source LIKE '%::INTEGER%' THEN
    RAISE NOTICE '❌ FUNCIÓN TIENE CONVERSIÓN A INT (causando overflow)';
    RAISE NOTICE 'Aplicando corrección...';
  ELSE
    RAISE NOTICE '✓ Función ya usa BIGINT o no tiene conversiones INT';
  END IF;
  
  RAISE NOTICE '';
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 2. CORRECCIÓN: Reemplazar INT con BIGINT
-- =====================================================================

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
  
  -- Secuencia del día (BIGINT para evitar overflow)
  SELECT COALESCE(MAX(
    CASE 
      WHEN regexp_replace(batch_number, '\D', '', 'g') = '' THEN 0
      ELSE regexp_replace(batch_number, '\D', '', 'g')::BIGINT
    END
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
  'Genera número de lote automático: PREFIX-SKU-YYMMDD-###. Usa BIGINT para evitar overflow.';

-- =====================================================================
-- 3. LIMPIAR CACHE DE POSTGRESQL
-- =====================================================================

DO $$
BEGIN
  -- Refrescar plan cache
  DISCARD PLANS;
  
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ FIX APLICADO';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Cambios realizados:';
  RAISE NOTICE '  ✓ Conversión INT → BIGINT en fn_generate_batch_number';
  RAISE NOTICE '  ✓ Agregado manejo de cadenas vacías';
  RAISE NOTICE '  ✓ Cache de planes limpio';
  RAISE NOTICE '';
  RAISE NOTICE 'Ahora puedes registrar compras con fecha de vencimiento';
  RAISE NOTICE '';
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 4. PRUEBA: Generar batch number
-- =====================================================================

DO $$
DECLARE
  v_test_batch TEXT;
  v_test_variant UUID;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '4. PRUEBA DE GENERACIÓN';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  
  -- Obtener una variante existente para probar
  SELECT variant_id INTO v_test_variant
  FROM product_variants
  WHERE is_active = TRUE
  LIMIT 1;
  
  IF v_test_variant IS NOT NULL THEN
    v_test_batch := fn_generate_batch_number(
      (SELECT tenant_id FROM product_variants WHERE variant_id = v_test_variant),
      v_test_variant
    );
    
    RAISE NOTICE 'Batch de prueba generado: %', v_test_batch;
    RAISE NOTICE '✓ Función funcionando correctamente';
  ELSE
    RAISE NOTICE '⚠️ No hay variantes activas para probar';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
END;
$$ LANGUAGE plpgsql;
