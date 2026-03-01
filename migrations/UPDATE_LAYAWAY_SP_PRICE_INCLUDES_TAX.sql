-- ===================================================================
-- Migración: Actualizar SP de Plan Separé para Precios con IVA Incluido
-- Fecha: 2026-02-14
-- Descripción: Actualiza sp_create_layaway para soportar price_includes_tax
-- REQUIERE: ADD_PRICE_INCLUDES_TAX.sql ejecutado previamente
-- ===================================================================

CREATE OR REPLACE FUNCTION sp_create_layaway(
  p_tenant uuid,
  p_location uuid,
  p_customer uuid,
  p_created_by uuid,
  p_items jsonb,
  p_due_date date,
  p_note text DEFAULT NULL,
  p_initial_payment jsonb DEFAULT NULL,
  p_installments jsonb DEFAULT NULL
) 
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_layaway uuid;
  v_item jsonb;
  v_variant uuid;
  v_qty numeric(14,3);
  v_unit_price numeric(14,2);
  v_discount_value numeric(14,2);
  v_discount_type text;
  v_discount_calculated numeric(14,2);
  v_tax_rate numeric;
  v_price_includes_tax boolean;
  v_line_subtotal numeric(14,2);
  v_price_after_discount numeric(14,2);
  v_tax_breakdown jsonb;
  v_base_amount numeric(14,2);
  v_tax_amount numeric(14,2);
  v_line_total numeric(14,2);

  v_available numeric(14,3);

  v_pm_code text;
  v_pm_id uuid;
  v_pay_amount numeric(14,2);
  v_pay_ref text;
  v_cash_session uuid;

  v_inst jsonb;
  v_inst_due date;
  v_inst_amount numeric(14,2);
BEGIN
  IF p_customer IS NULL THEN
    RAISE EXCEPTION 'Customer is required for layaway';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Layaway must have at least one item';
  END IF;

  INSERT INTO layaway_contracts(
    tenant_id, location_id, customer_id, created_by, created_at,
    status, currency_code, due_date, note,
    initial_deposit, paid_total, balance, subtotal, discount_total, tax_total, total
  )
  VALUES(
    p_tenant, p_location, p_customer, p_created_by, now(),
    'ACTIVE', 'COP', p_due_date, p_note,
    0, 0, 0, 0, 0, 0, 0
  )
  RETURNING layaway_id INTO v_layaway;

  -- Insertar items + reservar stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_variant := (v_item->>'variant_id')::uuid;
    v_qty := (v_item->>'qty')::numeric;
    v_unit_price := (v_item->>'unit_price')::numeric;
    
    -- Leer tipo de descuento
    v_discount_type := COALESCE(v_item->>'discount_type', 'AMOUNT');
    v_discount_value := COALESCE((v_item->>'discount')::numeric, 0);

    IF v_qty <= 0 THEN 
      RAISE EXCEPTION 'Invalid qty for variant %', v_variant; 
    END IF;
    IF v_unit_price < 0 THEN 
      RAISE EXCEPTION 'Invalid unit_price for variant %', v_variant; 
    END IF;
    IF v_discount_value < 0 THEN 
      RAISE EXCEPTION 'Invalid discount for variant %', v_variant; 
    END IF;

    -- 🆕 NUEVO: Obtener price_includes_tax del producto
    SELECT pv.price_includes_tax
    INTO v_price_includes_tax
    FROM product_variants pv
    WHERE pv.tenant_id = p_tenant 
      AND pv.variant_id = v_variant
      AND pv.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Variant not found/active: %', v_variant;
    END IF;

    -- Validar stock disponible = on_hand - reserved
    SELECT (sb.on_hand - sb.reserved)
    INTO v_available
    FROM stock_balances sb
    WHERE sb.tenant_id = p_tenant 
      AND sb.location_id = p_location 
      AND sb.variant_id = v_variant;

    IF v_available IS NULL THEN
      RAISE EXCEPTION 'No existe registro de stock para la variante % (tenant=% location=%)', 
        v_variant, p_tenant, p_location;
    END IF;

    IF v_available < v_qty THEN
      RAISE EXCEPTION 'Stock disponible insuficiente para la variante % (disponible=%, requerido=%)', 
        v_variant, v_available, v_qty;
    END IF;

    -- ==================================================================
    -- 🎯 FLUJO CORRECTO DE CÁLCULO (Orden crítico)
    -- ==================================================================
    
    -- 1. Subtotal bruto
    v_line_subtotal := ROUND(v_qty * v_unit_price, 2);
    
    -- 2. Calcular descuento según tipo
    v_discount_calculated := fn_calculate_discount(v_line_subtotal, v_discount_value, v_discount_type);

    -- 3. Precio después de descuentos
    v_price_after_discount := v_line_subtotal - v_discount_calculated;
    IF v_price_after_discount < 0 THEN 
      v_price_after_discount := 0; 
    END IF;

    -- 4. Obtener tasa de impuesto
    v_tax_rate := fn_get_tax_rate_for_variant(p_tenant, v_variant);

    -- 5. 🆕 NUEVO: Calcular base e impuesto según si el precio incluye o no IVA
    v_tax_breakdown := fn_calculate_tax_breakdown(
      v_price_after_discount,
      v_tax_rate,
      v_price_includes_tax
    );

    v_base_amount := (v_tax_breakdown->>'base')::numeric;
    v_tax_amount := (v_tax_breakdown->>'tax')::numeric;
    v_line_total := (v_tax_breakdown->>'total')::numeric;

    -- ==================================================================

    -- Insertar con discount_type
    INSERT INTO layaway_items(
      tenant_id, layaway_id, variant_id, quantity, unit_price,
      discount_type, discount_amount, tax_amount, line_total, tax_detail
    )
    VALUES(
      p_tenant, v_layaway, v_variant, v_qty, v_unit_price,
      v_discount_type, v_discount_value, v_tax_amount, v_line_total, 
      jsonb_build_object(
        'rate', v_tax_rate,
        'price_includes_tax', v_price_includes_tax,
        'base_amount', v_base_amount
      )
    );

    -- Reservar stock
    PERFORM fn_apply_stock_reservation_delta(p_tenant, p_location, v_variant, v_qty);

    INSERT INTO stock_reservations_log(
      tenant_id, layaway_id, location_id, variant_id, quantity, action, created_at, created_by
    )
    VALUES(
      p_tenant, v_layaway, p_location, v_variant, v_qty, 'RESERVE', now(), p_created_by
    );
  END LOOP;

  -- Cuotas opcionales
  IF p_installments IS NOT NULL AND jsonb_typeof(p_installments) = 'array' AND jsonb_array_length(p_installments) > 0 THEN
    FOR v_inst IN SELECT * FROM jsonb_array_elements(p_installments)
    LOOP
      v_inst_due := (v_inst->>'due_date')::date;
      v_inst_amount := (v_inst->>'amount')::numeric;
      IF v_inst_amount <= 0 THEN 
        RAISE EXCEPTION 'Invalid installment amount'; 
      END IF;

      INSERT INTO layaway_installments(tenant_id, layaway_id, due_date, amount, status)
      VALUES (p_tenant, v_layaway, v_inst_due, v_inst_amount, 'PENDING');
    END LOOP;
  END IF;

  -- Abono inicial opcional
  IF p_initial_payment IS NOT NULL THEN
    v_pm_code := upper(p_initial_payment->>'payment_method_code');
    v_pay_amount := (p_initial_payment->>'amount')::numeric;
    v_pay_ref := p_initial_payment->>'reference';
    v_cash_session := (p_initial_payment->>'cash_session_id')::uuid;

    IF v_pay_amount <= 0 THEN 
      RAISE EXCEPTION 'Payment amount must be positive'; 
    END IF;

    SELECT pm.payment_method_id
    INTO v_pm_id
    FROM payment_methods pm
    WHERE pm.tenant_id = p_tenant 
      AND upper(pm.code) = v_pm_code 
      AND pm.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Payment method not found or inactive: %', v_pm_code;
    END IF;

    INSERT INTO layaway_payments(
      tenant_id, layaway_id, payment_method_id, cash_session_id,
      amount, reference, paid_at
    )
    VALUES(
      p_tenant, v_layaway, v_pm_id, v_cash_session,
      v_pay_amount, v_pay_ref, now()
    );
  END IF;

  -- Recalcular y actualizar totales del contrato
  PERFORM fn_recalc_layaway_totals(v_layaway);

  RETURN v_layaway;
END;
$$;

COMMENT ON FUNCTION sp_create_layaway IS 
'Crea un plan separé con soporte para:
- Descuentos por AMOUNT o PERCENT
- Precios con IVA incluido (price_includes_tax)
- Cálculo correcto: Subtotal → Descuentos → Separar base/IVA según tipo

Formato JSON de items:
{
  "variant_id": "uuid",
  "qty": 1,
  "unit_price": 10000,
  "discount": 10,
  "discount_type": "PERCENT"
}

El sistema automáticamente:
1. Lee price_includes_tax del variant
2. Aplica descuentos sobre el precio
3. Descompone base e IVA correctamente
';

-- Mensaje de confirmación
DO $$
BEGIN
  RAISE NOTICE '✅ sp_create_layaway actualizado con soporte para price_includes_tax';
  RAISE NOTICE '📝 Plan Separé ahora calcula correctamente IVA incluido vs adicional';
END $$;
