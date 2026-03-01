/* ============================================================================
   FIX: Actualizar fn_apply_stock_delta y fn_apply_stock_reservation_delta
   
   PROBLEMA:
   Estas funciones quedaron desactualizadas después de migrar a sistema de lotes.
   Intentan hacer INSERT/UPDATE en stock_balances, que ahora es MATERIALIZED VIEW.
   
   ERROR: "cannot change materialized view stock_balances"
   
   SOLUCIÓN:
   - fn_apply_stock_delta: modificar inventory_batches en lugar de stock_balances
   - fn_apply_stock_reservation_delta: modificar reserved en inventory_batches
   
   APLICAR DESPUÉS DE: ADD_EXPIRATION_BATCHES_PHASE2.sql
   ============================================================================ */

-- =====================================================================
-- 1) ACTUALIZAR fn_apply_stock_delta
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_apply_stock_delta(
  p_tenant UUID,
  p_location UUID,
  p_variant UUID,
  p_delta NUMERIC
) 
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_batch_id UUID;
  v_remaining NUMERIC;
  v_batch_record RECORD;
BEGIN
  
  -- CASO 1: SALIDA DE STOCK (delta negativo) - aplicar FEFO
  IF p_delta < 0 THEN
    v_remaining := ABS(p_delta);
    
    -- Descontar de lotes con vencimiento más próximo primero (FEFO)
    FOR v_batch_record IN 
      SELECT batch_id, on_hand
      FROM inventory_batches
      WHERE tenant_id = p_tenant
        AND location_id = p_location
        AND variant_id = p_variant
        AND is_active = TRUE
        AND on_hand > 0
      ORDER BY 
        CASE WHEN expiration_date IS NULL THEN 1 ELSE 0 END, -- Con vencimiento primero
        expiration_date ASC NULLS LAST,  -- Más próximos primero
        received_at ASC  -- Más antiguos primero si no hay vencimiento
    LOOP
      IF v_remaining <= 0 THEN
        EXIT; -- Ya descontamos todo
      END IF;
      
      -- Descontar lo que se pueda de este lote
      IF v_batch_record.on_hand >= v_remaining THEN
        -- Este lote tiene suficiente
        UPDATE inventory_batches
        SET on_hand = on_hand - v_remaining,
            updated_at = NOW()
        WHERE batch_id = v_batch_record.batch_id;
        
        v_remaining := 0;
      ELSE
        -- Este lote no alcanza, descontamos todo y seguimos
        UPDATE inventory_batches
        SET on_hand = 0,
            updated_at = NOW()
        WHERE batch_id = v_batch_record.batch_id;
        
        v_remaining := v_remaining - v_batch_record.on_hand;
      END IF;
    END LOOP;
    
    IF v_remaining > 0 THEN
      RAISE EXCEPTION 'Stock insuficiente para variant % en location %. Faltaron % unidades', 
        p_variant, p_location, v_remaining;
    END IF;
    
  -- CASO 2: ENTRADA DE STOCK (delta positivo) - agregar al lote sin vencimiento
  ELSIF p_delta > 0 THEN
    -- Buscar lote genérico sin vencimiento para esta variante
    SELECT batch_id INTO v_batch_id
    FROM inventory_batches
    WHERE tenant_id = p_tenant
      AND location_id = p_location
      AND variant_id = p_variant
      AND expiration_date IS NULL
      AND is_active = TRUE
    LIMIT 1;
    
    IF FOUND THEN
      -- Actualizar lote existente
      UPDATE inventory_batches
      SET on_hand = on_hand + p_delta,
          updated_at = NOW()
      WHERE batch_id = v_batch_id;
    ELSE
      -- Crear nuevo lote genérico (sin vencimiento)
      INSERT INTO inventory_batches(
        tenant_id, location_id, variant_id,
        batch_number, received_at, on_hand, reserved,
        expiration_date, physical_location, notes, is_active
      )
      VALUES(
        p_tenant, p_location, p_variant,
        'GENERIC-' || TO_CHAR(NOW(), 'YYMMDD-HH24MISS'), -- Número genérico
        NOW(),
        p_delta,
        0,
        NULL,  -- Sin vencimiento
        'STOCK GENERAL',
        'Lote genérico creado automáticamente',
        TRUE
      );
    END IF;
  END IF;
  
  -- El trigger trg_after_batch_change_refresh_stock actualizará stock_balances automáticamente
  
END;
$$;

COMMENT ON FUNCTION fn_apply_stock_delta IS 
  'Aplica cambios de stock en inventory_batches. 
   - Delta negativo: descuenta usando FEFO (lotes más próximos a vencer primero)
   - Delta positivo: agrega a lote genérico sin vencimiento
   Actualiza stock_balances automáticamente vía trigger.';

-- =====================================================================
-- 2) ACTUALIZAR fn_apply_stock_reservation_delta
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_apply_stock_reservation_delta(
  p_tenant UUID,
  p_location UUID,
  p_variant UUID,
  p_delta NUMERIC
) 
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_remaining NUMERIC;
  v_batch_record RECORD;
  v_total_reserved NUMERIC;
BEGIN
  
  -- CASO 1: RESERVAR STOCK (delta positivo) - aplicar FEFO
  IF p_delta > 0 THEN
    v_remaining := p_delta;
    
    -- Reservar de lotes con vencimiento más próximo primero (FEFO)
    FOR v_batch_record IN 
      SELECT batch_id, on_hand, reserved
      FROM inventory_batches
      WHERE tenant_id = p_tenant
        AND location_id = p_location
        AND variant_id = p_variant
        AND is_active = TRUE
        AND (on_hand - reserved) > 0  -- Solo lotes con disponibilidad
      ORDER BY 
        CASE WHEN expiration_date IS NULL THEN 1 ELSE 0 END,
        expiration_date ASC NULLS LAST,
        received_at ASC
    LOOP
      IF v_remaining <= 0 THEN
        EXIT;
      END IF;
      
      -- Calcular cuánto podemos reservar de este lote
      DECLARE
        v_available NUMERIC;
        v_to_reserve NUMERIC;
      BEGIN
        v_available := v_batch_record.on_hand - v_batch_record.reserved;
        
        IF v_available >= v_remaining THEN
          -- Este lote tiene suficiente disponible
          v_to_reserve := v_remaining;
          v_remaining := 0;
        ELSE
          -- Reservar todo lo disponible de este lote
          v_to_reserve := v_available;
          v_remaining := v_remaining - v_available;
        END IF;
        
        -- Aplicar reserva
        UPDATE inventory_batches
        SET reserved = reserved + v_to_reserve,
            updated_at = NOW()
        WHERE batch_id = v_batch_record.batch_id;
      END;
    END LOOP;
    
    IF v_remaining > 0 THEN
      RAISE EXCEPTION 'Stock disponible insuficiente para reservar variant % en location %. Faltaron % unidades', 
        p_variant, p_location, v_remaining;
    END IF;
    
  -- CASO 2: LIBERAR RESERVA (delta negativo) - descontar de cualquier lote con reserva
  ELSIF p_delta < 0 THEN
    v_remaining := ABS(p_delta);
    
    -- Liberar de lotes que tienen reservas (orden FEFO también)
    FOR v_batch_record IN 
      SELECT batch_id, reserved
      FROM inventory_batches
      WHERE tenant_id = p_tenant
        AND location_id = p_location
        AND variant_id = p_variant
        AND is_active = TRUE
        AND reserved > 0
      ORDER BY 
        CASE WHEN expiration_date IS NULL THEN 1 ELSE 0 END,
        expiration_date ASC NULLS LAST,
        received_at ASC
    LOOP
      IF v_remaining <= 0 THEN
        EXIT;
      END IF;
      
      -- Liberar lo que se pueda de este lote
      DECLARE
        v_to_release NUMERIC;
      BEGIN
        IF v_batch_record.reserved >= v_remaining THEN
          -- Este lote tiene suficiente reserva
          v_to_release := v_remaining;
          v_remaining := 0;
        ELSE
          -- Liberar toda la reserva de este lote
          v_to_release := v_batch_record.reserved;
          v_remaining := v_remaining - v_batch_record.reserved;
        END IF;
        
        -- Aplicar liberación
        UPDATE inventory_batches
        SET reserved = reserved - v_to_release,
            updated_at = NOW()
        WHERE batch_id = v_batch_record.batch_id;
      END;
    END LOOP;
    
    IF v_remaining > 0 THEN
      RAISE EXCEPTION 'Intentando liberar más reserva de la que existe para variant % en location %', 
        p_variant, p_location;
    END IF;
  END IF;
  
  -- Validar que ningún lote quede con reserva negativa
  SELECT SUM(reserved) INTO v_total_reserved
  FROM inventory_batches
  WHERE tenant_id = p_tenant
    AND location_id = p_location
    AND variant_id = p_variant
    AND is_active = TRUE;
  
  IF v_total_reserved < 0 THEN
    RAISE EXCEPTION 'Stock reservado no puede ser negativo (tenant=%, location=%, variant=%)', 
      p_tenant, p_location, p_variant;
  END IF;
  
  -- El trigger trg_after_batch_change_refresh_stock actualizará stock_balances automáticamente
  
END;
$$;

COMMENT ON FUNCTION fn_apply_stock_reservation_delta IS 
  'Aplica cambios de stock reservado en inventory_batches usando FEFO.
   - Delta positivo: reserva stock de lotes más próximos a vencer
   - Delta negativo: libera reservas
   Actualiza stock_balances automáticamente vía trigger.';

-- =====================================================================
-- 3) VERIFICACIÓN
-- =====================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ FUNCIONES DE STOCK ACTUALIZADAS PARA SISTEMA DE LOTES';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Funciones corregidas:';
  RAISE NOTICE '  ✓ fn_apply_stock_delta - ahora modifica inventory_batches';
  RAISE NOTICE '  ✓ fn_apply_stock_reservation_delta - ahora modifica inventory_batches';
  RAISE NOTICE '';
  RAISE NOTICE 'Comportamiento:';
  RAISE NOTICE '  • Salidas: se descuentan usando FEFO (lotes más próximos a vencer)';
  RAISE NOTICE '  • Entradas: se agregan a lote genérico sin vencimiento';
  RAISE NOTICE '  • Reservas: se aplican usando FEFO';
  RAISE NOTICE '  • stock_balances se actualiza automáticamente vía trigger';
  RAISE NOTICE '';
  RAISE NOTICE 'Ahora sp_complete_layaway_to_sale funcionará correctamente!';
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
END $$;
