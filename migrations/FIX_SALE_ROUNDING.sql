/* ============================================================================
   FIX: Aplicar redondeo a totales de venta
   
   PROBLEMA:
   El frontend aplica redondeo al total (ej: 17,850 → 17,900)
   El backend NO aplica redondeo, causando error de validación
   
   SOLUCIÓN:
   Crear función de redondeo SQL y aplicarla en sp_create_sale
   ============================================================================ */

-- =====================================================================
-- 1. FUNCIÓN DE REDONDEO (igual lógica que frontend)
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_apply_rounding(
  p_tenant UUID,
  p_amount NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_method TEXT;
  v_multiple INT;
  v_divided NUMERIC;
  v_rounded NUMERIC;
BEGIN
  -- Obtener configuración de redondeo del tenant
  SELECT 
    COALESCE(rounding_method, 'none'),
    COALESCE(rounding_multiple, 1)
  INTO v_method, v_multiple
  FROM tenant_settings
  WHERE tenant_id = p_tenant;
  
  -- Si no hay configuración o método es 'none' o múltiplo es 1, retornar sin cambios
  IF v_method IS NULL OR v_method = 'none' OR v_multiple IS NULL OR v_multiple = 1 THEN
    RETURN p_amount;
  END IF;
  
  -- Dividir por el múltiplo
  v_divided := p_amount / v_multiple;
  
  -- Aplicar método de redondeo
  CASE v_method
    WHEN 'up' THEN
      v_rounded := CEIL(v_divided);
    WHEN 'down' THEN
      v_rounded := FLOOR(v_divided);
    WHEN 'normal' THEN
      v_rounded := ROUND(v_divided);
    ELSE
      v_rounded := v_divided;
  END CASE;
  
  -- Multiplicar de vuelta
  RETURN v_rounded * v_multiple;
END;
$$;

COMMENT ON FUNCTION fn_apply_rounding IS 
  'Aplica redondeo al monto según configuración del tenant (método y múltiplo)';

-- =====================================================================
-- 2. ACTUALIZAR sp_create_sale PARA APLICAR REDONDEO
-- =====================================================================

-- Buscar dónde se validan los pagos y aplicar redondeo antes
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE 'ACTUALIZANDO sp_create_sale';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Se aplicará fn_apply_rounding al total antes de comparar';
  RAISE NOTICE 'con los pagos para evitar discrepancias por redondeo.';
  RAISE NOTICE '';
END;
$$ LANGUAGE plpgsql;

-- Leer el procedimiento actual y modificar la validación
CREATE OR REPLACE FUNCTION sp_create_sale(
  p_tenant UUID,
  p_location UUID,
  p_cash_session UUID,
  p_customer UUID,
  p_sold_by UUID,
  p_lines JSONB,
  p_payments JSONB,
  p_note TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_sale_id UUID;
  v_sale_number BIGINT;

  v_line JSONB;
  v_payment JSONB;
  v_batch RECORD;
  v_allocation RECORD;

  v_variant UUID;
  v_qty NUMERIC;
  v_unit_price NUMERIC;
  v_discount NUMERIC;
  v_cost NUMERIC;
  v_allow_backorder BOOLEAN;

  v_tax_rate NUMERIC;
  v_line_base NUMERIC;
  v_tax_amount NUMERIC;
  v_line_total NUMERIC;
  v_sale_line_id UUID;

  v_subtotal NUMERIC := 0;
  v_discount_total NUMERIC := 0;
  v_tax_total NUMERIC := 0;
  v_total NUMERIC := 0;
  v_total_rounded NUMERIC := 0;  -- NUEVO: Total con redondeo

  v_payment_code TEXT;
  v_payment_method_id UUID;
  v_payment_amount NUMERIC;
  v_payment_ref TEXT;
  v_paid_total NUMERIC := 0;
BEGIN
  -- Validaciones básicas
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Sale must have at least one line';
  END IF;

  IF p_payments IS NULL OR jsonb_typeof(p_payments) <> 'array' OR jsonb_array_length(p_payments) = 0 THEN
    RAISE EXCEPTION 'Sale must have at least one payment';
  END IF;

  -- Validar sesión de caja
  IF p_cash_session IS NOT NULL THEN
    PERFORM 1
    FROM cash_sessions cs
    WHERE cs.tenant_id = p_tenant
      AND cs.cash_session_id = p_cash_session
      AND cs.status = 'OPEN';
    
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cash session is not OPEN or not found';
    END IF;
  END IF;

  -- Generar número de venta
  v_sale_number := fn_next_sale_number(p_tenant, p_location);

  -- Crear header de venta
  INSERT INTO sales(
    tenant_id, location_id, cash_session_id, sale_number,
    status, sold_at, customer_id, sold_by,
    subtotal, discount_total, tax_total, total, note
  )
  VALUES (
    p_tenant, p_location, p_cash_session, v_sale_number,
    'COMPLETED', NOW(), p_customer, p_sold_by,
    0, 0, 0, 0, p_note
  )
  RETURNING sale_id INTO v_sale_id;

  -- =========================
  -- PROCESAR LÍNEAS CON FEFO
  -- =========================
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_variant := (v_line->>'variant_id')::UUID;
    v_qty := (v_line->>'qty')::NUMERIC;
    v_unit_price := (v_line->>'unit_price')::NUMERIC;
    v_discount := COALESCE((v_line->>'discount')::NUMERIC, 0);

    -- Validaciones de línea
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid qty for variant %', v_variant;
    END IF;
    IF v_unit_price < 0 THEN
      RAISE EXCEPTION 'Invalid unit_price for variant %', v_variant;
    END IF;
    IF v_discount < 0 THEN
      RAISE EXCEPTION 'Invalid discount for variant %', v_variant;
    END IF;

    -- Obtener costo y configuración de variante
    SELECT pv.cost, COALESCE(pv.allow_backorder, FALSE)
    INTO v_cost, v_allow_backorder
    FROM product_variants pv
    WHERE pv.tenant_id = p_tenant 
      AND pv.variant_id = v_variant 
      AND pv.is_active = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variant not found/active: %', v_variant;
    END IF;

    -- =========================
    -- ASIGNACIÓN DE LOTES (FEFO)
    -- =========================
    SELECT * INTO v_allocation
    FROM fn_allocate_stock_fefo(p_tenant, p_location, v_variant, v_qty);

    -- Validar stock suficiente (si NO permite sobreventa)
    IF NOT v_allow_backorder AND NOT v_allocation.has_sufficient_stock THEN
      RAISE EXCEPTION 'Stock insuficiente para variante %. Disponible: %, Requerido: %',
        v_variant, v_allocation.total_allocated, v_qty;
    END IF;

    -- Calcular totales de línea
    v_tax_rate := fn_get_tax_rate_for_variant(p_tenant, v_variant);
    v_line_base := ROUND((v_qty * v_unit_price) - v_discount, 2);
    IF v_line_base < 0 THEN v_line_base := 0; END IF;
    
    v_tax_amount := ROUND(v_line_base * v_tax_rate, 2);
    v_line_total := v_line_base + v_tax_amount;

    -- Insertar línea de venta
    INSERT INTO sale_lines(
      tenant_id, sale_id, variant_id, quantity,
      unit_price, unit_cost, discount_amount,
      tax_amount, line_total, tax_detail
    )
    VALUES (
      p_tenant, v_sale_id, v_variant, v_qty,
      v_unit_price, v_cost, v_discount,
      v_tax_amount, v_line_total,
      jsonb_build_object('rate', v_tax_rate)
    )
    RETURNING sale_line_id INTO v_sale_line_id;

    -- =========================
   -- CONSUMIR LOTES ASIGNADOS
    -- =========================
    IF v_allocation.allocation_details IS NOT NULL THEN
      FOR v_batch IN 
        SELECT * FROM jsonb_to_recordset(v_allocation.allocation_details) AS x(
          batch_id UUID,
          batch_number TEXT,
          quantity NUMERIC,
          unit_cost NUMERIC,
          expiration_date DATE,
          days_to_expiry INT,
          physical_location TEXT,
          expiry_status TEXT
        )
      LOOP
        -- Consumir stock del lote
        PERFORM fn_consume_batch_stock(
          p_tenant, 
          v_batch.batch_id, 
          v_batch.quantity,
          FALSE
        );

        -- Registrar asignación de lote a línea de venta
        INSERT INTO sale_line_batches(
          tenant_id, sale_id, sale_line_id, batch_id,
          quantity, unit_cost, created_at
        )
        VALUES (
          p_tenant, v_sale_id, v_sale_line_id, v_batch.batch_id,
          v_batch.quantity, v_batch.unit_cost, NOW()
        );

        -- Crear movimiento de inventario
        INSERT INTO inventory_moves(
          tenant_id, move_type, location_id, variant_id, 
          quantity, unit_cost, source, source_id, 
          note, created_at, created_by
        )
        VALUES(
          p_tenant, 'SALE_OUT', p_location, v_variant, 
          v_batch.quantity, v_batch.unit_cost, 'SALE', v_sale_id,
          'Lote: ' || v_batch.batch_number,
          NOW(), p_sold_by
        );
      END LOOP;
    END IF;

    v_subtotal := v_subtotal + v_line_base;
    v_discount_total := v_discount_total + v_discount;
    v_tax_total := v_tax_total + v_tax_amount;
    v_total := v_total + v_line_total;
  END LOOP;

  -- =========================
  -- APLICAR REDONDEO AL TOTAL
  -- =========================
  v_total_rounded := fn_apply_rounding(p_tenant, v_total);

  -- =========================
  -- PROCESAR PAGOS
  -- =========================
  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
  LOOP
    v_payment_code := UPPER(v_payment->>'payment_method_code');
    v_payment_amount := (v_payment->>'amount')::NUMERIC;
    v_payment_ref := v_payment->>'reference';

    IF v_payment_amount <= 0 THEN
      RAISE EXCEPTION 'Invalid payment amount';
    END IF;

    SELECT pm.payment_method_id
    INTO v_payment_method_id
    FROM payment_methods pm
    WHERE pm.tenant_id = p_tenant
      AND pm.code = v_payment_code
      AND pm.is_active = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Payment method not found/active: %', v_payment_code;
    END IF;

    INSERT INTO sale_payments(
      tenant_id, sale_id, payment_method_id, 
      cash_session_id, amount, reference, paid_at
    )
    VALUES(
      p_tenant, v_sale_id, v_payment_method_id, 
      p_cash_session, v_payment_amount, v_payment_ref, NOW()
    );

    v_paid_total := v_paid_total + v_payment_amount;
  END LOOP;

  -- VALIDAR CON TOTAL REDONDEADO
  IF ROUND(v_paid_total, 2) <> ROUND(v_total_rounded, 2) THEN
    RAISE EXCEPTION 'Payments total (%) must equal sale total (%)', v_paid_total, v_total_rounded;
  END IF;

  -- Actualizar totales en venta (guardar total REDONDEADO)
  UPDATE sales
  SET subtotal = ROUND(v_subtotal, 2),
      discount_total = ROUND(v_discount_total, 2),
      tax_total = ROUND(v_tax_total, 2),
      total = v_total_rounded
  WHERE sale_id = v_sale_id;

  -- Refresh stock_balances
  BEGIN
    PERFORM fn_refresh_stock_balances();
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_sale_id;
END;
$$;

COMMENT ON FUNCTION sp_create_sale IS 
  'Crea una venta con FEFO y redondeo aplicado al total según configuración del tenant';

-- =====================================================================
-- VERIFICACIÓN FINAL
-- =====================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ FIX DE REDONDEO APLICADO';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Cambios realizados:';
  RAISE NOTICE '  ✓ Creada función fn_apply_rounding';
  RAISE NOTICE '  ✓ sp_create_sale ahora aplica redondeo al total';
  RAISE NOTICE '  ✓ Validación de pagos usa total redondeado';
  RAISE NOTICE '';
  RAISE NOTICE 'Ahora el frontend y backend usan la misma lógica';
  RAISE NOTICE 'de redondeo y no habrá discrepancias.';
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
END;
$$ LANGUAGE plpgsql;
