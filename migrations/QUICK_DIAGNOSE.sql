/* ============================================================================
   VERIFICACIÓN RÁPIDA: ¿Por qué no aparecen los lotes?
   
   Script simplificado para verificar si sp_create_purchase crea lotes
   ============================================================================ */

-- Verificar si sp_create_purchase incluye lógica de lotes
DO $$
DECLARE
  v_procedure_source TEXT;
  v_has_batches BOOLEAN := FALSE;
  v_has_batch_number BOOLEAN := FALSE;
  v_has_expiration BOOLEAN := FALSE;
BEGIN
  RAISE NOTICE '════════════════════════════════════════════════════════════';
  RAISE NOTICE '🔍 VERIFICACIÓN: ¿sp_create_purchase crea lotes?';
  RAISE NOTICE '════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  
  -- Obtener código fuente del procedimiento
  SELECT pg_get_functiondef(p.oid) INTO v_procedure_source
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'sp_create_purchase';
  
  IF v_procedure_source IS NULL THEN
    RAISE NOTICE '❌ PROBLEMA: sp_create_purchase NO EXISTE';
    RAISE NOTICE '';
    RAISE NOTICE '🛠️ SOLUCIÓN:';
    RAISE NOTICE '   1. Verifica que InitDB.sql o UserFunctions.sql se haya ejecutado';
    RAISE NOTICE '   2. Busca el script que crea sp_create_purchase';
    RETURN;
  END IF;
  
  -- Verificar si incluye lógica de lotes
  v_has_batches := v_procedure_source LIKE '%inventory_batches%';
  v_has_batch_number := v_procedure_source LIKE '%batch_number%';
  v_has_expiration := v_procedure_source LIKE '%expiration_date%';
  
  IF v_has_batches AND v_has_batch_number AND v_has_expiration THEN
    RAISE NOTICE '✅ sp_create_purchase INCLUYE lógica de lotes';
    RAISE NOTICE '   ✓ Referencia a inventory_batches';
    RAISE NOTICE '   ✓ Maneja batch_number';
    RAISE NOTICE '   ✓ Maneja expiration_date';
    RAISE NOTICE '';
    RAISE NOTICE '⚠️ Si registraste una compra y no aparece el lote:';
    RAISE NOTICE '';
    RAISE NOTICE '   1. El producto debe tener requires_expiration = TRUE';
    RAISE NOTICE '      → Productos > Editar > Activar "Requiere control de vencimiento"';
    RAISE NOTICE '';
    RAISE NOTICE '   2. Debe completarse la fecha de vencimiento en la compra';
    RAISE NOTICE '      → Al registrar compra, llenar el campo "Fecha de Vencimiento"';
    RAISE NOTICE '';
    RAISE NOTICE '   3. Las funciones auxiliares deben existir:';
    
    -- Verificar funciones
    IF EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'fn_generate_batch_number') THEN
      RAISE NOTICE '      ✓ fn_generate_batch_number existe';
    ELSE
      RAISE NOTICE '      ❌ fn_generate_batch_number NO EXISTE';
    END IF;
    
    IF EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'fn_variant_requires_expiration') THEN
      RAISE NOTICE '      ✓ fn_variant_requires_expiration existe';
    ELSE
      RAISE NOTICE '      ❌ fn_variant_requires_expiration NO EXISTE';
    END IF;
    
    IF EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'fn_refresh_stock_balances') THEN
      RAISE NOTICE '      ✓ fn_refresh_stock_balances existe';
    ELSE
      RAISE NOTICE '      ❌ fn_refresh_stock_balances NO EXISTE';
    END IF;
    
  ELSE
    RAISE NOTICE '❌ PROBLEMA ENCONTRADO:';
    RAISE NOTICE '';
    RAISE NOTICE '   sp_create_purchase NO INCLUYE lógica de lotes';
    
    IF NOT v_has_batches THEN
      RAISE NOTICE '   ❌ No referencia inventory_batches';
    END IF;
    
    IF NOT v_has_batch_number THEN
      RAISE NOTICE '   ❌ No maneja batch_number';
    END IF;
    
    IF NOT v_has_expiration THEN
      RAISE NOTICE '   ❌ No maneja expiration_date';
    END IF;
    
    RAISE NOTICE '';
    RAISE NOTICE '🛠️ SOLUCIÓN:';
    RAISE NOTICE '   Ejecuta el script: INTEGRATE_BATCHES_WITH_PURCHASES.sql';
    RAISE NOTICE '';
    RAISE NOTICE '   psql -U postgres -d tu_base_datos -f "INTEGRATE_BATCHES_WITH_PURCHASES.sql"';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════════';
  RAISE NOTICE '📊 ESTADÍSTICAS ACTUALES';
  RAISE NOTICE '════════════════════════════════════════════════════════════';
  
  -- Mostrar estadísticas
  DECLARE
    v_count_batches INTEGER;
    v_count_purchases INTEGER;
    v_count_products_with_exp INTEGER;
  BEGIN
    SELECT COUNT(*) INTO v_count_batches FROM inventory_batches;
    SELECT COUNT(DISTINCT source_id) INTO v_count_purchases 
    FROM inventory_moves 
    WHERE move_type = 'PURCHASE_IN' 
      AND created_at >= CURRENT_DATE - INTERVAL '7 days';
    SELECT COUNT(*) INTO v_count_products_with_exp 
    FROM products 
    WHERE requires_expiration = TRUE AND is_active = TRUE;
    
    RAISE NOTICE 'Lotes en inventory_batches: %', v_count_batches;
    RAISE NOTICE 'Compras (últimos 7 días): %', v_count_purchases;
    RAISE NOTICE 'Productos con control de vencimiento: %', v_count_products_with_exp;
  END;
  
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════════';
  
END;
$$ LANGUAGE plpgsql;

-- Mostrar últimos lotes creados (si existen)
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '📦 ÚLTIMOS LOTES CREADOS (máximo 5):';
  RAISE NOTICE '════════════════════════════════════════════════════════════';
  
  IF NOT EXISTS(SELECT 1 FROM inventory_batches LIMIT 1) THEN
    RAISE NOTICE '   ⚠️ No hay lotes registrados en inventory_batches';
    RAISE NOTICE '';
    RAISE NOTICE '   Esto confirma que sp_create_purchase NO está creando lotes';
    RAISE NOTICE '   o que no se ha registrado ninguna compra exitosamente.';
  ELSE
    FOR v_record IN 
      SELECT 
        batch_number,
        expiration_date,
        on_hand,
        received_at,
        notes
      FROM inventory_batches
      ORDER BY received_at DESC
      LIMIT 5
    LOOP
      RAISE NOTICE '   Lote: % | Vence: % | Stock: % | Creado: %',
        v_record.batch_number,
        COALESCE(v_record.expiration_date::TEXT, 'Sin vencimiento'),
        v_record.on_hand,
        v_record.received_at;
    END LOOP;
  END IF;
  
  RAISE NOTICE '';
END;
$$ LANGUAGE plpgsql;

-- Verificar compras recientes
DO $$
BEGIN
  RAISE NOTICE '🛒 COMPRAS RECIENTES (últimos 7 días):';
  RAISE NOTICE '════════════════════════════════════════════════════════════';
  
  IF NOT EXISTS(
    SELECT 1 
    FROM inventory_moves 
    WHERE move_type = 'PURCHASE_IN' 
      AND created_at >= CURRENT_DATE - INTERVAL '7 days'
    LIMIT 1
  ) THEN
    RAISE NOTICE '   ⚠️ No hay compras registradas en los últimos 7 días';
  ELSE
    FOR v_record IN 
      SELECT 
        im.source_id AS purchase_id,
        im.created_at,
        pv.sku,
        p.name AS product_name,
        p.requires_expiration,
        im.quantity,
        im.note
      FROM inventory_moves im
      JOIN product_variants pv ON pv.variant_id = im.variant_id
      JOIN products p ON p.product_id = pv.product_id
      WHERE im.move_type = 'PURCHASE_IN'
        AND im.created_at >= CURRENT_DATE - INTERVAL '7 days'
      ORDER BY im.created_at DESC
      LIMIT 5
    LOOP
      RAISE NOTICE '   % | % | SKU: % | Requiere venc: % | Cant: %',
        v_record.created_at::TIMESTAMP(0),
        v_record.product_name,
        v_record.sku,
        CASE WHEN v_record.requires_expiration THEN 'SÍ' ELSE 'NO' END,
        v_record.quantity;
    END LOOP;
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════════';
END;
$$ LANGUAGE plpgsql;
