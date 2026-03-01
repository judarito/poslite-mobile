/* ============================================================================
   sp_create_sale INTEGRADO CON SISTEMA DE MANUFACTURA
   
   VERSIÓN: 5.0 - Manufactura Integrada
   REEMPLAZA: FIX_SALE_ROUNDING.sql (v4.0)
   
   CAMBIOS:
   ✓ Detecta inventory_behavior de cada línea
   ✓ SERVICE: Skip validación y consumo de inventario
   ✓ MANUFACTURED ON_DEMAND: Consume componentes del BOM con FEFO
   ✓ BUNDLE: Consume componentes individuales con FEFO
   ✓ RESELL: Comportamiento actual (FEFO del producto)
   ✓ MANUFACTURED TO_STOCK: Comportamiento actual (FEFO del producto terminado)
   ✓ Preserva FEFO, redondeo, discount_type, price_includes_tax
   
   ORDEN EJECUCIÓN: 7/7 (FINAL - Después de todas las fases de manufactura)
   
   ============================================================================ */

-- DROP FUNCTION IF EXISTS sp_create_sale CASCADE;

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
  v_component RECORD;

  v_variant UUID;
  v_qty NUMERIC;
  v_unit_price NUMERIC;
  v_discount NUMERIC;
  v_cost NUMERIC;
  v_allow_backorder BOOLEAN;

  -- NUEVO: Variables para manufactura
  v_behavior TEXT;
  v_production_type TEXT;
  v_bom_id UUID;
  v_bom_validation RECORD;
  v_components_consumed JSONB;
  v_production_cost NUMERIC;

  v_tax_rate NUMERIC;
  v_line_base NUMERIC;
  v_tax_amount NUMERIC;
  v_line_total NUMERIC;
  v_sale_line_id UUID;

  v_subtotal NUMERIC := 0;
  v_discount_total NUMERIC := 0;
  v_tax_total NUMERIC := 0;
  v_total NUMERIC := 0;
  v_total_rounded NUMERIC := 0;

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
  -- PROCESAR LÍNEAS 
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

    -- ═════════════════════════════════════════════════════════════
    -- NUEVO: DETECTAR COMPORTAMIENTO DE MANUFACTURA
    -- ═════════════════════════════════════════════════════════════
    v_behavior := fn_get_effective_inventory_behavior(p_tenant, v_variant);
    v_production_type := fn_get_effective_production_type(p_tenant, v_variant);

    -- Reiniciar variables de manufactura para esta línea
    v_components_consumed := NULL;
    v_production_cost := NULL;

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

    -- ═════════════════════════════════════════════════════════════
    -- VALIDACIÓN DE STOCK SEGÚN COMPORTAMIENTO
    -- ═════════════════════════════════════════════════════════════
    
    IF v_behavior = 'SERVICE' THEN
      -- SERVICE: NO validar stock (no existe inventario)
      RAISE NOTICE 'Línea SERVICE: % - skip validación stock', v_variant;
      
    ELSIF v_behavior = 'MANUFACTURED' AND v_production_type = 'ON_DEMAND' THEN
      -- ON_DEMAND: Validar que tenga BOM y componentes disponibles
      v_bom_id := fn_get_effective_bom(p_tenant, v_variant);
      
      IF v_bom_id IS NULL THEN
        RAISE EXCEPTION 'Producto ON_DEMAND % no tiene BOM configurado', v_variant;
      END IF;
      
      -- Pre-validar disponibilidad de componentes
      FOR v_bom_validation IN 
        SELECT * FROM fn_validate_bom_availability(p_tenant, v_bom_id, v_qty, p_location)
      LOOP
        IF NOT v_bom_validation.is_sufficient THEN
          RAISE EXCEPTION 'Componente insuficiente: %. Requerido: %, Disponible: %',
            v_bom_validation.component_variant_id,
            v_bom_validation.required_quantity,
            v_bom_validation.available_quantity;
        END IF;
      END LOOP;
      
      RAISE NOTICE 'Línea ON_DEMAND: % - componentes validados', v_variant;
      
    ELSIF v_behavior = 'BUNDLE' THEN
      -- BUNDLE: Validar que todos los componentes tengan stock
      FOR v_component IN 
        SELECT * FROM fn_explode_bundle_components(p_tenant, v_variant, v_qty)
      LOOP
        SELECT * INTO v_allocation
        FROM fn_allocate_stock_fefo(p_tenant, p_location, v_component.component_variant_id, v_component.component_quantity);
        
        IF NOT v_allocation.has_sufficient_stock THEN
          RAISE EXCEPTION 'Stock insuficiente para componente % del bundle. Disponible: %, Requerido: %',
            v_component.component_variant_id,
            v_allocation.total_allocated,
            v_component.component_quantity;
        END IF;
      END LOOP;
      
      RAISE NOTICE 'Línea BUNDLE: % - componentes validados', v_variant;
      
    ELSE
      -- RESELL o MANUFACTURED TO_STOCK: Validación normal
      SELECT * INTO v_allocation
      FROM fn_allocate_stock_fefo(p_tenant, p_location, v_variant, v_qty);

      IF NOT v_allow_backorder AND NOT v_allocation.has_sufficient_stock THEN
        RAISE EXCEPTION 'Stock insuficiente para variante %. Disponible: %, Requerido: %',
          v_variant, v_allocation.total_allocated, v_qty;
      END IF;
      
      RAISE NOTICE 'Línea RESELL/TO_STOCK: % - stock validado', v_variant;
    END IF;

    -- ═════════════════════════════════════════════════════════════
    -- CALCULAR TOTALES DE LÍNEA
    -- ═════════════════════════════════════════════════════════════
    v_tax_rate := fn_get_tax_rate_for_variant(p_tenant, v_variant);
    v_line_base := ROUND((v_qty * v_unit_price) - v_discount, 2);
    IF v_line_base < 0 THEN v_line_base := 0; END IF;
    
    v_tax_amount := ROUND(v_line_base * v_tax_rate, 2);
    v_line_total := v_line_base + v_tax_amount;

    -- ═════════════════════════════════════════════════════════════
    -- INSERTAR LÍNEA DE VENTA
    -- ═════════════════════════════════════════════════════════════
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

    -- ═════════════════════════════════════════════════════════════
    -- CONSUMIR STOCK SEGÚN COMPORTAMIENTO
    -- ═════════════════════════════════════════════════════════════
    
    IF v_behavior = 'SERVICE' THEN
      -- SERVICE: NO consumir inventario
      RAISE NOTICE 'SERVICE: No se consume inventario';
      
    ELSIF v_behavior = 'MANUFACTURED' AND v_production_type = 'ON_DEMAND' THEN
      -- ON_DEMAND: Consumir componentes del BOM con FEFO
      v_components_consumed := fn_consume_bom_components(
        p_tenant,
        v_variant,
        v_qty,
        p_location,
        v_sale_line_id
      );
      
      -- Calcular costo de producción real
      SELECT COALESCE(SUM((item->>'total_cost')::NUMERIC), 0)
      INTO v_production_cost
      FROM jsonb_array_elements(v_components_consumed) AS item;
      
      -- Actualizar línea con datos de producción
      UPDATE sale_lines
      SET production_cost = v_production_cost,
          components_consumed = v_components_consumed
      WHERE sale_line_id = v_sale_line_id;
      
      -- Actualizar cost y price de la variante basado en producción ON_DEMAND
      DECLARE
        v_unit_cost NUMERIC;
        v_new_price NUMERIC;
      BEGIN
        v_unit_cost := v_production_cost / v_qty;
        
        -- Calcular nuevo precio según política de pricing_rules
        v_new_price := fn_calculate_price(p_tenant, v_variant, v_unit_cost, p_location);
        
        -- Actualizar variante
        UPDATE product_variants
        SET cost = v_unit_cost,
            price = v_new_price
        WHERE tenant_id = p_tenant
          AND variant_id = v_variant;
      END;
      
      RAISE NOTICE 'ON_DEMAND: Componentes consumidos. Costo producción: %', v_production_cost;
      
    ELSIF v_behavior = 'BUNDLE' THEN
      -- BUNDLE: Consumir cada componente con FEFO
      FOR v_component IN 
        SELECT * FROM fn_explode_bundle_components(p_tenant, v_variant, v_qty)
      LOOP
        -- Asignar lotes FEFO para este componente
        SELECT * INTO v_allocation
        FROM fn_allocate_stock_fefo(p_tenant, p_location, v_component.component_variant_id, v_component.component_quantity);
        
        -- Consumir lotes asignados
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
            PERFORM fn_consume_batch_stock(p_tenant, v_batch.batch_id, v_batch.quantity, FALSE);

            -- Registrar consumo del componente
            INSERT INTO sale_line_components(
              tenant_id, sale_line_id, component_variant_id,
              quantity, unit_cost, total_cost, batch_id, created_at
            )
            VALUES (
              p_tenant, v_sale_line_id, v_component.component_variant_id,
              v_batch.quantity, v_batch.unit_cost, 
              v_batch.quantity * v_batch.unit_cost,
              v_batch.batch_id, NOW()
            );

            -- Crear movimiento de inventario
            INSERT INTO inventory_moves(
              tenant_id, move_type, location_id, variant_id, 
              quantity, unit_cost, source, source_id, 
              note, created_at, created_by
            )
            VALUES(
              p_tenant, 'SALE_OUT', p_location, v_component.component_variant_id, 
              v_batch.quantity, v_batch.unit_cost, 'SALE', v_sale_id,
              'Bundle componente - Lote: ' || v_batch.batch_number,
              NOW(), p_sold_by
            );
          END LOOP;
        END IF;
      END LOOP;
      
      RAISE NOTICE 'BUNDLE: Componentes consumidos con FEFO';
      
    ELSE
      -- RESELL o MANUFACTURED TO_STOCK: Consumir producto con FEFO (comportamiento actual)
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
      
      RAISE NOTICE 'RESELL/TO_STOCK: Producto consumido con FEFO';
    END IF;

    -- Acumular totales
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
  'v5.0: Crea venta con soporte para RESELL, SERVICE, MANUFACTURED (ON_DEMAND/TO_STOCK), BUNDLE. Incluye FEFO, redondeo, y consumo de componentes.';

-- =====================================================================
-- VERIFICACIÓN FINAL
-- =====================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ sp_create_sale INTEGRADO CON MANUFACTURA';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Versión: 5.0 - Manufactura Completa';
  RAISE NOTICE '';
  RAISE NOTICE 'Comportamientos soportados:';
  RAISE NOTICE '  ✓ RESELL: FEFO normal (comportamiento actual)';
  RAISE NOTICE '  ✓ SERVICE: Sin validación ni consumo de inventario';
  RAISE NOTICE '  ✓ MANUFACTURED ON_DEMAND: Consume componentes BOM con FEFO';
  RAISE NOTICE '  ✓ MANUFACTURED TO_STOCK: FEFO del producto terminado';
  RAISE NOTICE '  ✓ BUNDLE: Consume cada componente con FEFO';
  RAISE NOTICE '';
  RAISE NOTICE 'Funcionalidad preservada:';
  RAISE NOTICE '  ✓ FEFO (First Expired First Out)';
  RAISE NOTICE '  ✓ Redondeo configurable';
  RAISE NOTICE '  ✓ Discount type (AMOUNT/PERCENT)';
  RAISE NOTICE '  ✓ Price includes tax';
  RAISE NOTICE '  ✓ Trazabilidad de lotes';
  RAISE NOTICE '';
  RAISE NOTICE 'TESTING REQUERIDO:';
  RAISE NOTICE '  • Venta RESELL: Debe funcionar exactamente como antes';
  RAISE NOTICE '  • Venta SERVICE: No debe validar/consumir stock';
  RAISE NOTICE '  • Venta ON_DEMAND: Debe consumir componentes y calcular costo';
  RAISE NOTICE '  • Venta TO_STOCK: Debe consumir producto terminado';
  RAISE NOTICE '  • Venta BUNDLE: Debe consumir todos los componentes';
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
END;
$$ LANGUAGE plpgsql;
