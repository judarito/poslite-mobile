/* ============================================================================
   SISTEMA DE LOTES CON FECHA DE VENCIMIENTO - FASE 4
   Actualización de sp_create_sale para integrar FEFO
   
   CAMBIOS:
   - Integra fn_allocate_stock_fefo antes de procesar líneas
   - Consume stock de lotes específicos (no solo stock_balances agregado)
   - Registra asignación de lotes en sale_line_batches
   - Genera alertas de vencimiento para el cajero
   - Mantiene compatibilidad con código existente
   
   REQUERIMIENTOS: Ejecutar PHASE1, PHASE2, PHASE2_MIGRATE y PHASE3 primero
   
   AUTOR: Sistema POS-Lite
   FECHA: 2026-02-15
   ============================================================================ */

-- =========================
-- 1) TABLA PARA ALERTAS DE VENTA
-- =========================

CREATE TABLE IF NOT EXISTS sale_warnings (
  warning_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  sale_id UUID NOT NULL REFERENCES sales(sale_id) ON DELETE CASCADE,
  warning_type TEXT NOT NULL, -- 'NEAR_EXPIRY', 'EXPIRED_STOCK', 'LOW_STOCK'
  severity TEXT NOT NULL, -- 'INFO', 'WARNING', 'CRITICAL'
  message TEXT NOT NULL,
  data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sale_warnings_sale 
ON sale_warnings(tenant_id, sale_id);

COMMENT ON TABLE sale_warnings IS 
  'Alertas generadas durante ventas (productos por vencer, stock bajo, etc.)';

-- =========================
-- 2) SP ACTUALIZADO: sp_create_sale CON FEFO
-- =========================

CREATE OR REPLACE FUNCTION sp_create_sale(
  p_tenant UUID,
  p_location UUID,
  p_cash_session UUID,
  p_customer UUID,
  p_sold_by UUID,
  p_lines JSONB,
  p_payments JSONB,
  p_note TEXT DEFAULT NULL
) 
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_sale_id UUID;
  v_sale_number BIGINT;
  v_sale_line_id UUID;

  v_subtotal NUMERIC(14,2) := 0;
  v_discount_total NUMERIC(14,2) := 0;
  v_tax_total NUMERIC(14,2) := 0;
  v_total NUMERIC(14,2) := 0;

  v_line JSONB;
  v_variant UUID;
  v_qty NUMERIC(14,3);
  v_unit_price NUMERIC(14,2);
  v_discount NUMERIC(14,2);
  v_cost NUMERIC(14,2);
  v_tax_rate NUMERIC;
  v_tax_amount NUMERIC(14,2);
  v_line_base NUMERIC(14,2);
  v_line_total NUMERIC(14,2);

  v_payment JSONB;
  v_payment_method_id UUID;
  v_payment_code TEXT;
  v_payment_amount NUMERIC(14,2);
  v_payment_ref TEXT;
  v_paid_total NUMERIC(14,2) := 0;

  -- Variables para FEFO
  v_allocation RECORD;
  v_batch RECORD;
  v_allow_backorder BOOLEAN;
  v_total_allocated NUMERIC;
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
          FALSE  -- No es de reservado (venta directa)
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

        -- Crear movimiento de inventario (kardex)
        INSERT INTO inventory_moves(
          tenant_id, move_type, location_id, variant_id, 
          quantity, unit_cost, source, source_id, 
          note, created_at, created_by
        )
        VALUES(
          p_tenant, 'SALE_OUT', p_location, v_variant, 
          v_batch.quantity, v_batch.unit_cost, 'SALE', v_sale_id,
          'Lote: ' || v_batch.batch_number || 
          CASE 
            WHEN v_batch.expiration_date IS NOT NULL 
            THEN ' - Vence: ' || v_batch.expiration_date::TEXT
            ELSE ''
          END,
          NOW(), p_sold_by
        );
      END LOOP;
    END IF;

    -- =========================
    -- PROCESAR WARNINGS/ALERTAS
    -- =========================
    IF v_allocation.warnings IS NOT NULL AND jsonb_array_length(v_allocation.warnings) > 0 THEN
      FOR v_batch IN 
        SELECT * FROM jsonb_to_recordset(v_allocation.warnings) AS x(
          type TEXT,
          severity TEXT,
          batch_number TEXT,
          quantity NUMERIC,
          expiration_date DATE,
          days_to_expiry INT,
          message TEXT
        )
      LOOP
        -- Insertar warning para mostrar al cajero
        INSERT INTO sale_warnings(
          tenant_id, sale_id, warning_type, severity, message, data
        )
        VALUES (
          p_tenant, 
          v_sale_id,
          v_batch.type,
          COALESCE(v_batch.severity, 'WARNING'),
          COALESCE(
            v_batch.message,
            format('Producto lote %s vence en %s días', 
              v_batch.batch_number, 
              v_batch.days_to_expiry
            )
          ),
          jsonb_build_object(
            'variant_id', v_variant,
            'batch_number', v_batch.batch_number,
            'expiration_date', v_batch.expiration_date,
            'days_to_expiry', v_batch.days_to_expiry,
            'quantity', v_batch.quantity
          )
        );
      END LOOP;
    END IF;

    -- Acumular totales
    v_subtotal := v_subtotal + ROUND(v_qty * v_unit_price, 2);
    v_discount_total := v_discount_total + v_discount;
    v_tax_total := v_tax_total + v_tax_amount;
  END LOOP;

  -- Calcular total final
  v_total := ROUND((v_subtotal - v_discount_total) + v_tax_total, 2);

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

  -- Validar que pagos cuadren con total
  IF ROUND(v_paid_total, 2) <> ROUND(v_total, 2) THEN
    RAISE EXCEPTION 'Payments total (%) must equal sale total (%)', v_paid_total, v_total;
  END IF;

  -- Actualizar totales en venta
  UPDATE sales
  SET subtotal = ROUND(v_subtotal, 2),
      discount_total = ROUND(v_discount_total, 2),
      tax_total = ROUND(v_tax_total, 2),
      total = v_total
  WHERE sale_id = v_sale_id;

  -- Refresh stock_balances (vista materializada)
  PERFORM fn_refresh_stock_balances(TRUE);

  RETURN v_sale_id;
END;
$$;

COMMENT ON FUNCTION sp_create_sale IS 
  'Crea venta con asignación automática de lotes (FEFO). 
   Genera alertas de vencimiento y registra trazabilidad completa.
   Actualizado FASE 4 - Sistema de lotes 2026-02-15';

-- =========================
-- 3) FUNCIÓN AUXILIAR: OBTENER WARNINGS DE VENTA
-- =========================

CREATE OR REPLACE FUNCTION fn_get_sale_warnings(
  p_tenant UUID,
  p_sale_id UUID
)
RETURNS JSONB
LANGUAGE SQL
STABLE
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'type', warning_type,
        'severity', severity,
        'message', message,
        'data', data
      ) ORDER BY created_at
    ),
    '[]'::JSONB
  )
  FROM sale_warnings
  WHERE tenant_id = p_tenant 
    AND sale_id = p_sale_id;
$$;

COMMENT ON FUNCTION fn_get_sale_warnings IS 
  'Obtiene todas las alertas de una venta en formato JSON';

-- =========================
-- FIN FASE 4
-- =========================

DO $$
BEGIN
  RAISE NOTICE '============================================';
  RAISE NOTICE 'FASE 4 COMPLETADA - SP Ventas con FEFO';
  RAISE NOTICE '============================================';
  RAISE NOTICE 'Función actualizada:';
  RAISE NOTICE '  ✓ sp_create_sale - integra FEFO automáticamente';
  RAISE NOTICE '';
  RAISE NOTICE 'Nuevas tablas:';
  RAISE NOTICE '  ✓ sale_warnings - alertas de venta';
  RAISE NOTICE '';
  RAISE NOTICE 'Flujo completo:';
  RAISE NOTICE '  1. Asignación FEFO automática por lote';
  RAISE NOTICE '  2. Consumo de stock por lote';
  RAISE NOTICE '  3. Registro de trazabilidad';
  RAISE NOTICE '  4. Generación de alertas';
  RAISE NOTICE '  5. Actualización de stock_balances';
  RAISE NOTICE '';
  RAISE NOTICE 'PRÓXIMO PASO:';
  RAISE NOTICE '  - Ejecutar PHASE5: vistas de alertas y reportes';
  RAISE NOTICE '============================================';
END;
$$;
