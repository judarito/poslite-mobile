-- ===================================================================
-- Migración: Actualizar SP de Ventas para Descuentos Flexibles
-- Fecha: 2026-02-14
-- Descripción: Actualiza sp_create_sale para soportar discount_type
-- ===================================================================

CREATE OR REPLACE FUNCTION sp_create_sale(
  p_tenant uuid,
  p_location uuid,
  p_cash_session uuid,
  p_customer uuid,
  p_sold_by uuid,
  p_lines jsonb,
  p_payments jsonb,
  p_note text default null
) 
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_sale_id uuid;
  v_sale_number bigint;

  v_subtotal numeric(14,2) := 0;
  v_discount_total numeric(14,2) := 0;
  v_tax_total numeric(14,2) := 0;
  v_total numeric(14,2) := 0;

  v_line jsonb;
  v_variant uuid;
  v_qty numeric(14,3);
  v_unit_price numeric(14,2);
  v_discount_value numeric(14,2);
  v_discount_type text;
  v_discount_calculated numeric(14,2);
  v_cost numeric(14,2);
  v_tax_rate numeric;
  v_tax_amount numeric(14,2);
  v_line_base numeric(14,2);
  v_line_subtotal numeric(14,2);
  v_line_total numeric(14,2);

  v_payment jsonb;
  v_payment_method_id uuid;
  v_payment_code text;
  v_payment_amount numeric(14,2);
  v_payment_ref text;
  v_paid_total numeric(14,2) := 0;

  v_on_hand numeric(14,3);
  v_allow_backorder boolean;
BEGIN
  -- Validaciones
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Sale must have at least one line';
  END IF;

  IF p_payments IS NULL OR jsonb_typeof(p_payments) <> 'array' OR jsonb_array_length(p_payments) = 0 THEN
    RAISE EXCEPTION 'Sale must have at least one payment';
  END IF;

  -- Validar sesión de caja si viene
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

  -- Obtener siguiente número de venta
  v_sale_number := fn_next_sale_number(p_tenant, p_location);

  -- Crear venta
  INSERT INTO sales(
    tenant_id, location_id, cash_session_id, sale_number,
    status, sold_at, customer_id, sold_by,
    subtotal, discount_total, tax_total, total, note
  )
  VALUES (
    p_tenant, p_location, p_cash_session, v_sale_number,
    'COMPLETED', now(), p_customer, p_sold_by,
    0, 0, 0, 0, p_note
  )
  RETURNING sale_id INTO v_sale_id;

  -- Procesar líneas
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_variant := (v_line->>'variant_id')::uuid;
    v_qty := (v_line->>'qty')::numeric;
    v_unit_price := (v_line->>'unit_price')::numeric;
    
    -- 🆕 NUEVO: Leer tipo de descuento (por defecto AMOUNT si no viene)
    v_discount_type := COALESCE(v_line->>'discount_type', 'AMOUNT');
    v_discount_value := COALESCE((v_line->>'discount')::numeric, 0);

    -- Validaciones básicas
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid qty for variant %', v_variant;
    END IF;
    IF v_unit_price < 0 THEN
      RAISE EXCEPTION 'Invalid unit_price for variant %', v_variant;
    END IF;
    IF v_discount_value < 0 THEN
      RAISE EXCEPTION 'Invalid discount for variant %', v_variant;
    END IF;

    -- Obtener costo del producto
    SELECT pv.cost
    INTO v_cost
    FROM product_variants pv
    WHERE pv.tenant_id = p_tenant 
      AND pv.variant_id = v_variant 
      AND pv.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variant not found/active: %', v_variant;
    END IF;

    -- Obtener allow_backorder
    SELECT pv.allow_backorder
    INTO v_allow_backorder
    FROM product_variants pv
    WHERE pv.tenant_id = p_tenant 
      AND pv.variant_id = v_variant;

    -- Validar stock disponible
    SELECT (sb.on_hand - sb.reserved)
    INTO v_on_hand
    FROM stock_balances sb
    WHERE sb.tenant_id = p_tenant 
      AND sb.location_id = p_location 
      AND sb.variant_id = v_variant;

    v_on_hand := COALESCE(v_on_hand, 0);

    IF COALESCE(v_allow_backorder, false) = false AND v_on_hand < v_qty THEN
      RAISE EXCEPTION 'Stock insuficiente para la variante % (disponible=%, requerido=%)', 
        v_variant, v_on_hand, v_qty;
    END IF;

    -- 🆕 NUEVO: Calcular descuento según tipo
    v_line_subtotal := ROUND(v_qty * v_unit_price, 2);
    v_discount_calculated := fn_calculate_discount(v_line_subtotal, v_discount_value, v_discount_type);

    -- Calcular base imponible (después del descuento)
    v_line_base := v_line_subtotal - v_discount_calculated;
    IF v_line_base < 0 THEN 
      v_line_base := 0; 
    END IF;

    -- Calcular impuestos
    v_tax_rate := fn_get_tax_rate_for_variant(p_tenant, v_variant);
    v_tax_amount := ROUND(v_line_base * v_tax_rate, 2);
    v_line_total := v_line_base + v_tax_amount;

    -- 🆕 NUEVO: Insertar línea con discount_type
    INSERT INTO sale_lines(
      tenant_id, sale_id, variant_id, quantity,
      unit_price, unit_cost, 
      discount_type, discount_amount,
      tax_amount, line_total, tax_detail
    )
    VALUES (
      p_tenant, v_sale_id, v_variant, v_qty,
      v_unit_price, v_cost,
      v_discount_type, v_discount_value,
      v_tax_amount, v_line_total,
      jsonb_build_object('rate', v_tax_rate)
    );

    -- Movimiento de inventario
    INSERT INTO inventory_moves(
      tenant_id, move_type, location_id, variant_id, quantity, unit_cost,
      source, source_id, note, created_at, created_by
    )
    VALUES(
      p_tenant, 'SALE_OUT', p_location, v_variant, v_qty, v_cost,
      'SALE', v_sale_id, null, now(), p_sold_by
    );

    -- Actualizar stock
    PERFORM fn_apply_stock_delta(p_tenant, p_location, v_variant, -v_qty);

    -- Acumular totales
    v_subtotal := v_subtotal + v_line_subtotal;
    v_discount_total := v_discount_total + v_discount_calculated;
    v_tax_total := v_tax_total + v_tax_amount;
  END LOOP;

  v_total := ROUND((v_subtotal - v_discount_total) + v_tax_total, 2);

  -- Procesar pagos
  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
  LOOP
    v_payment_code := upper(v_payment->>'payment_method_code');
    v_payment_amount := (v_payment->>'amount')::numeric;
    v_payment_ref := v_payment->>'reference';

    IF v_payment_amount <= 0 THEN
      RAISE EXCEPTION 'Invalid payment amount';
    END IF;

    SELECT pm.payment_method_id
    INTO v_payment_method_id
    FROM payment_methods pm
    WHERE pm.tenant_id = p_tenant 
      AND upper(pm.code) = v_payment_code 
      AND pm.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Payment method not found/active: %', v_payment_code;
    END IF;

    INSERT INTO sale_payments(
      tenant_id, sale_id, payment_method_id, cash_session_id,
      amount, reference, paid_at
    )
    VALUES(
      p_tenant, v_sale_id, v_payment_method_id, p_cash_session,
      v_payment_amount, v_payment_ref, now()
    );

    v_paid_total := v_paid_total + v_payment_amount;
  END LOOP;

  -- Validar que el pago cubra el total
  IF v_paid_total < v_total THEN
    RAISE EXCEPTION 'Insufficient payment: required=%, paid=%', v_total, v_paid_total;
  END IF;

  -- Actualizar totales de la venta
  UPDATE sales
  SET subtotal = v_subtotal,
      discount_total = v_discount_total,
      tax_total = v_tax_total,
      total = v_total
  WHERE sale_id = v_sale_id;

  RETURN v_sale_id;
END;
$$;

COMMENT ON FUNCTION sp_create_sale IS 
'Crea una venta con soporte para descuentos por AMOUNT (valor fijo) o PERCENT (porcentaje).
Formato JSON de líneas:
{
  "variant_id": "uuid",
  "qty": 1,
  "unit_price": 10000,
  "discount": 10,
  "discount_type": "PERCENT"  -- "AMOUNT" o "PERCENT" (opcional, default: AMOUNT)
}';

-- Mensaje de confirmación
DO $$
BEGIN
  RAISE NOTICE '✅ sp_create_sale actualizado con soporte para discount_type';
  RAISE NOTICE '📝 Ahora soporta descuentos por AMOUNT o PERCENT';
END $$;
