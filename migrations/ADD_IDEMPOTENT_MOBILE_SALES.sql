-- =============================================================================
-- ADD_IDEMPOTENT_MOBILE_SALES.sql
-- Objetivo: garantizar idempotencia fuerte para ventas mobile (offline queue)
--
-- Crea:
-- 1) Tabla de control de operaciones de venta por operation_id
-- 2) RPC wrapper sp_create_sale_idempotent(...) que deduplica llamadas
--
-- Importante:
-- - Se apoya en sp_create_sale existente para toda la lógica de inventario.
-- - Si una operación ya fue aplicada, retorna el mismo sale_id sin duplicar movimientos.
-- =============================================================================

CREATE TABLE IF NOT EXISTS mobile_sale_operations (
  operation_id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL,
  sale_id UUID,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED')),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mobile_sale_operations_tenant_created
  ON mobile_sale_operations (tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION sp_create_sale_idempotent(
  p_operation_id TEXT,
  p_tenant UUID,
  p_location UUID,
  p_cash_session UUID,
  p_customer UUID,
  p_sold_by UUID,
  p_lines JSONB,
  p_payments JSONB,
  p_note TEXT,
  p_third_party UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sale_id UUID;
  v_existing mobile_sale_operations%ROWTYPE;
BEGIN
  IF p_operation_id IS NULL OR LENGTH(TRIM(p_operation_id)) = 0 THEN
    RAISE EXCEPTION 'p_operation_id es obligatorio para idempotencia';
  END IF;

  -- Lock por operación para evitar carreras entre reintentos concurrentes
  PERFORM pg_advisory_xact_lock(hashtext(p_operation_id));

  SELECT *
  INTO v_existing
  FROM mobile_sale_operations
  WHERE operation_id = p_operation_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.status = 'SUCCESS' AND v_existing.sale_id IS NOT NULL THEN
      RETURN v_existing.sale_id;
    END IF;
  ELSE
    INSERT INTO mobile_sale_operations (operation_id, tenant_id, status)
    VALUES (p_operation_id, p_tenant, 'PENDING');
  END IF;

  BEGIN
    v_sale_id := sp_create_sale(
      p_tenant,
      p_location,
      p_cash_session,
      p_customer,
      p_sold_by,
      p_lines,
      p_payments,
      p_note,
      p_third_party
    );

    UPDATE mobile_sale_operations
    SET sale_id = v_sale_id,
        status = 'SUCCESS',
        last_error = NULL,
        updated_at = NOW()
    WHERE operation_id = p_operation_id;

    RETURN v_sale_id;
  EXCEPTION
    WHEN OTHERS THEN
      UPDATE mobile_sale_operations
      SET status = 'FAILED',
          last_error = SQLERRM,
          updated_at = NOW()
      WHERE operation_id = p_operation_id;
      RAISE;
  END;
END;
$$;

REVOKE ALL ON FUNCTION sp_create_sale_idempotent(TEXT, UUID, UUID, UUID, UUID, UUID, JSONB, JSONB, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sp_create_sale_idempotent(TEXT, UUID, UUID, UUID, UUID, UUID, JSONB, JSONB, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION sp_create_sale_idempotent(TEXT, UUID, UUID, UUID, UUID, UUID, JSONB, JSONB, TEXT, UUID) TO service_role;

COMMENT ON FUNCTION sp_create_sale_idempotent IS
'Wrapper idempotente para ventas mobile: deduplica por operation_id y retorna mismo sale_id en reintentos.';
