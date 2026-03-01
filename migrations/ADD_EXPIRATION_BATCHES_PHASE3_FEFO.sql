/* ============================================================================
   SISTEMA DE LOTES CON FECHA DE VENCIMIENTO - FASE 3
   Lógica FEFO (First Expired, First Out) para asignación de lotes en ventas
   
   CARACTERÍSTICAS:
   - Asignación automática de lotes por fecha de vencimiento
   - Validación de stock disponible vs vencido
   - Información de ubicación física para cajero
   - Alertas de productos por vencer
   - Bloqueo de vencidos configurable
   
   REQUERIMIENTOS: Ejecutar PHASE1, PHASE2 y PHASE2_MIGRATE primero
   
   AUTOR: Sistema POS-Lite
   FECHA: 2026-02-15
   ============================================================================ */

-- =========================
-- 1) FUNCIÓN PRINCIPAL: ASIGNAR LOTES CON FEFO
-- =========================

CREATE OR REPLACE FUNCTION fn_allocate_stock_fefo(
  p_tenant UUID,
  p_location UUID,
  p_variant UUID,
  p_qty_needed NUMERIC,
  OUT total_allocated NUMERIC,
  OUT has_sufficient_stock BOOLEAN,
  OUT allocation_details JSONB,
  OUT warnings JSONB
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_requires_exp BOOLEAN;
  v_block_expired BOOLEAN;
  v_warn_days INT;
  v_critical_days INT;
  
  v_remaining NUMERIC := p_qty_needed;
  v_allocated NUMERIC := 0;
  v_batch RECORD;
  v_allocations JSONB := '[]'::JSONB;
  v_warnings JSONB := '[]'::JSONB;
BEGIN
  -- Obtener configuración del tenant
  SELECT 
    fn_variant_requires_expiration(p_tenant, p_variant),
    (expiration_config->>'block_sale_when_expired')::BOOLEAN,
    (expiration_config->>'warn_days_before_expiration')::INT,
    (expiration_config->>'critical_days_before_expiration')::INT
  INTO v_requires_exp, v_block_expired, v_warn_days, v_critical_days
  FROM tenant_settings
  WHERE tenant_id = p_tenant;
  
  -- Valores por defecto si no hay configuración
  v_block_expired := COALESCE(v_block_expired, TRUE);
  v_warn_days := COALESCE(v_warn_days, 30);
  v_critical_days := COALESCE(v_critical_days, 7);
  
  -- Cursor FEFO: ordena por fecha de vencimiento (más próxima primero)
  FOR v_batch IN
    SELECT 
      ib.batch_id,
      ib.batch_number,
      ib.expiration_date,
      ib.physical_location,
      (ib.on_hand - ib.reserved) AS available,
      ib.unit_cost,
      ib.received_at,
      -- Calcular estado de vencimiento
      CASE
        WHEN ib.expiration_date IS NULL THEN 'NO_EXPIRY'
        WHEN ib.expiration_date < CURRENT_DATE THEN 'EXPIRED'
        WHEN ib.expiration_date <= CURRENT_DATE + v_critical_days THEN 'CRITICAL'
        WHEN ib.expiration_date <= CURRENT_DATE + v_warn_days THEN 'WARNING'
        ELSE 'OK'
      END AS expiry_status,
      CASE 
        WHEN ib.expiration_date IS NOT NULL 
        THEN ib.expiration_date - CURRENT_DATE 
        ELSE NULL 
      END AS days_to_expiry
    FROM inventory_batches ib
    WHERE ib.tenant_id = p_tenant
      AND ib.location_id = p_location
      AND ib.variant_id = p_variant
      AND ib.is_active = TRUE
      AND (ib.on_hand - ib.reserved) > 0
    ORDER BY 
      -- FEFO: vencimiento más próximo primero (NULL al final)
      ib.expiration_date NULLS LAST,
      -- Tiebreaker: más antiguo primero
      ib.received_at ASC
    FOR UPDATE SKIP LOCKED  -- Evitar deadlocks en concurrencia
  LOOP
    -- Salir si ya asignamos todo
    IF v_remaining <= 0 THEN
      EXIT;
    END IF;
    
    -- Si el lote está vencido y se bloquean vencidos, saltar
    IF v_batch.expiry_status = 'EXPIRED' AND v_block_expired THEN
      v_warnings := v_warnings || jsonb_build_object(
        'type', 'EXPIRED_STOCK_SKIPPED',
        'batch_number', v_batch.batch_number,
        'quantity', v_batch.available,
        'expiration_date', v_batch.expiration_date
      );
      CONTINUE;
    END IF;
    
    -- Determinar cantidad a asignar de este lote
    DECLARE
      v_qty_from_batch NUMERIC;
    BEGIN
      IF v_batch.available >= v_remaining THEN
        v_qty_from_batch := v_remaining;
        v_remaining := 0;
      ELSE
        v_qty_from_batch := v_batch.available;
        v_remaining := v_remaining - v_batch.available;
      END IF;
      
      v_allocated := v_allocated + v_qty_from_batch;
      
      -- Registrar asignación
      v_allocations := v_allocations || jsonb_build_object(
        'batch_id', v_batch.batch_id,
        'batch_number', v_batch.batch_number,
        'quantity', v_qty_from_batch,
        'unit_cost', v_batch.unit_cost,
        'expiration_date', v_batch.expiration_date,
        'days_to_expiry', v_batch.days_to_expiry,
        'physical_location', v_batch.physical_location,
        'expiry_status', v_batch.expiry_status
      );
      
      -- Generar warning si está por vencer
      IF v_batch.expiry_status IN ('CRITICAL', 'WARNING') THEN
        v_warnings := v_warnings || jsonb_build_object(
          'type', 'NEAR_EXPIRY',
          'severity', v_batch.expiry_status,
          'batch_number', v_batch.batch_number,
          'quantity', v_qty_from_batch,
          'expiration_date', v_batch.expiration_date,
          'days_to_expiry', v_batch.days_to_expiry
        );
      END IF;
    END;
  END LOOP;
  
  -- Determinar si hay stock suficiente
  has_sufficient_stock := (v_remaining <= 0);
  
  -- Si falta stock, agregar warning
  IF v_remaining > 0 THEN
    v_warnings := v_warnings || jsonb_build_object(
      'type', 'INSUFFICIENT_STOCK',
      'requested', p_qty_needed,
      'available', v_allocated,
      'missing', v_remaining
    );
  END IF;
  
  -- Resultados
  total_allocated := v_allocated;
  allocation_details := v_allocations;
  warnings := v_warnings;
END;
$$;

COMMENT ON FUNCTION fn_allocate_stock_fefo IS 
  'Asigna lotes automáticamente usando FEFO. Retorna detalles de asignación y warnings.
   Parámetros de salida:
   - total_allocated: cantidad total asignada
   - has_sufficient_stock: boolean si hay suficiente
   - allocation_details: array JSON con detalles de cada lote asignado
   - warnings: array JSON con alertas (vencimientos, faltantes, etc.)';

-- =========================
-- 2) FUNCIÓN: RESERVAR STOCK EN LOTES
-- =========================

CREATE OR REPLACE FUNCTION fn_reserve_batch_stock(
  p_tenant UUID,
  p_batch_id UUID,
  p_qty_to_reserve NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_available NUMERIC;
BEGIN
  -- Obtener disponible del lote
  SELECT (on_hand - reserved) INTO v_available
  FROM inventory_batches
  WHERE tenant_id = p_tenant 
    AND batch_id = p_batch_id
    AND is_active = TRUE
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote % no encontrado o inactivo', p_batch_id;
  END IF;
  
  IF v_available < p_qty_to_reserve THEN
    RAISE EXCEPTION 'Stock insuficiente en lote %. Disponible: %, Solicitado: %',
      p_batch_id, v_available, p_qty_to_reserve;
  END IF;
  
  -- Incrementar reserved
  UPDATE inventory_batches
  SET reserved = reserved + p_qty_to_reserve,
      updated_at = NOW()
  WHERE batch_id = p_batch_id;
END;
$$;

COMMENT ON FUNCTION fn_reserve_batch_stock IS 
  'Reserva stock en un lote específico. Usado para Plan Separe.';

-- =========================
-- 3) FUNCIÓN: LIBERAR RESERVA DE LOTE
-- =========================

CREATE OR REPLACE FUNCTION fn_release_batch_reservation(
  p_tenant UUID,
  p_batch_id UUID,
  p_qty_to_release NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE inventory_batches
  SET reserved = GREATEST(0, reserved - p_qty_to_release),
      updated_at = NOW()
  WHERE tenant_id = p_tenant 
    AND batch_id = p_batch_id;
  
  IF NOT FOUND THEN
    RAISE WARNING 'Lote % no encontrado al liberar reserva', p_batch_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION fn_release_batch_reservation IS 
  'Libera reserva de un lote. Usado al cancelar Plan Separe o ventas.';

-- =========================
-- 4) FUNCIÓN: CONSUMIR STOCK DE LOTE (VENTA)
-- =========================

CREATE OR REPLACE FUNCTION fn_consume_batch_stock(
  p_tenant UUID,
  p_batch_id UUID,
  p_qty_to_consume NUMERIC,
  p_from_reserved BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_on_hand NUMERIC;
  v_reserved NUMERIC;
BEGIN
  -- Obtener cantidades actuales
  SELECT on_hand, reserved INTO v_on_hand, v_reserved
  FROM inventory_batches
  WHERE tenant_id = p_tenant 
    AND batch_id = p_batch_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote % no encontrado', p_batch_id;
  END IF;
  
  -- Validar disponibilidad
  IF p_from_reserved THEN
    -- Consumir de reservado (ej: completar Plan Separe)
    IF v_reserved < p_qty_to_consume THEN
      RAISE EXCEPTION 'Reservado insuficiente en lote %. Reservado: %, Solicitado: %',
        p_batch_id, v_reserved, p_qty_to_consume;
    END IF;
    
    UPDATE inventory_batches
    SET on_hand = on_hand - p_qty_to_consume,
        reserved = reserved - p_qty_to_consume,
        updated_at = NOW()
    WHERE batch_id = p_batch_id;
  ELSE
    -- Consumir de disponible (venta directa)
    IF (v_on_hand - v_reserved) < p_qty_to_consume THEN
      RAISE EXCEPTION 'Stock disponible insuficiente en lote %. Disponible: %, Solicitado: %',
        p_batch_id, (v_on_hand - v_reserved), p_qty_to_consume;
    END IF;
    
    UPDATE inventory_batches
    SET on_hand = on_hand - p_qty_to_consume,
        updated_at = NOW()
    WHERE batch_id = p_batch_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION fn_consume_batch_stock IS 
  'Consume stock de un lote (reduce on_hand). 
   Si from_reserved=true, también reduce reserved (para Plan Separe).';

-- =========================
-- 5) TABLA: REGISTRO DE ASIGNACIONES DE LOTES EN VENTAS
-- =========================

CREATE TABLE IF NOT EXISTS sale_line_batches (
  sale_line_batch_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  sale_id UUID NOT NULL REFERENCES sales(sale_id) ON DELETE CASCADE,
  sale_line_id UUID NOT NULL,  -- Referencia a sale_lines (sin FK por ahora)
  batch_id UUID NOT NULL REFERENCES inventory_batches(batch_id) ON DELETE RESTRICT,
  
  -- Detalle de la asignación
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(14,2) NOT NULL,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sale_line_batches_sale 
ON sale_line_batches(tenant_id, sale_id);

CREATE INDEX idx_sale_line_batches_batch 
ON sale_line_batches(tenant_id, batch_id);

COMMENT ON TABLE sale_line_batches IS 
  'Registro de qué lotes se usaron en cada línea de venta. Trazabilidad completa.';

-- =========================
-- 6) VISTA: REPORTE DE TRAZABILIDAD
-- =========================

CREATE OR REPLACE VIEW vw_batch_traceability AS
SELECT 
  slb.tenant_id,
  slb.sale_id,
  s.sale_number,
  s.sold_at,
  s.customer_id,
  c.full_name AS customer_name,
  slb.batch_id,
  ib.batch_number,
  ib.expiration_date,
  pv.sku,
  p.name AS product_name,
  pv.variant_name,
  slb.quantity,
  slb.unit_cost,
  (slb.quantity * slb.unit_cost) AS total_cost
FROM sale_line_batches slb
JOIN sales s ON s.sale_id = slb.sale_id AND s.tenant_id = slb.tenant_id
LEFT JOIN customers c ON c.customer_id = s.customer_id
JOIN inventory_batches ib ON ib.batch_id = slb.batch_id
JOIN product_variants pv ON pv.variant_id = ib.variant_id
JOIN products p ON p.product_id = pv.product_id
WHERE s.status NOT IN ('VOIDED', 'CANCELLED');

COMMENT ON VIEW vw_batch_traceability IS 
  'Trazabilidad completa: qué lotes se vendieron en qué ventas a qué clientes.';

-- =========================
-- FIN FASE 3
-- =========================

DO $$
BEGIN
  RAISE NOTICE '============================================';
  RAISE NOTICE 'FASE 3 COMPLETADA - Lógica FEFO';
  RAISE NOTICE '============================================';
  RAISE NOTICE 'Funciones creadas:';
  RAISE NOTICE '  ✓ fn_allocate_stock_fefo - asignación automática';
  RAISE NOTICE '  ✓ fn_reserve_batch_stock - reservar';
  RAISE NOTICE '  ✓ fn_release_batch_reservation - liberar';
  RAISE NOTICE '  ✓ fn_consume_batch_stock - consumir';
  RAISE NOTICE '';
  RAISE NOTICE 'Tabla sale_line_batches: trazabilidad de ventas';
  RAISE NOTICE '';
  RAISE NOTICE 'PRÓXIMO PASO:';
  RAISE NOTICE '  - Ejecutar PHASE4: actualizar sp_create_sale';
  RAISE NOTICE '============================================';
END;
$$;
