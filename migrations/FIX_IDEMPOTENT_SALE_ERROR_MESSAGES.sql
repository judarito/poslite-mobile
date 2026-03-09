-- =============================================================================
-- FIX_IDEMPOTENT_SALE_ERROR_MESSAGES.sql
-- Objetivo:
--   Mejorar mensajes de error en sp_create_sale_idempotent para que, cuando
--   llegue un UUID de variante desde sp_create_sale, se reemplace por una
--   etiqueta legible: "Producto - Variante (SKU)".
--
-- Alcance:
--   - No cambia lógica de inventario/venta.
--   - Solo cambia la presentación del mensaje y last_error guardado en
--     mobile_sale_operations.
-- =============================================================================

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

  v_raw_error TEXT;
  v_error_pretty TEXT;
  v_variant_id_text TEXT;
  v_variant_id UUID;
  v_product_name TEXT;
  v_variant_name TEXT;
  v_sku TEXT;
  v_variant_label TEXT;
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
      v_raw_error := SQLERRM;
      v_error_pretty := v_raw_error;

      -- Busca primer UUID en el mensaje para mapear variante -> etiqueta legible.
      v_variant_id_text := (regexp_match(
        v_raw_error,
        '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})'
      ))[1];

      IF v_variant_id_text IS NOT NULL THEN
        BEGIN
          v_variant_id := v_variant_id_text::UUID;
        EXCEPTION WHEN OTHERS THEN
          v_variant_id := NULL;
        END;

        IF v_variant_id IS NOT NULL THEN
          SELECT
            p.name,
            pv.variant_name,
            pv.sku
          INTO
            v_product_name,
            v_variant_name,
            v_sku
          FROM product_variants pv
          LEFT JOIN products p
            ON p.product_id = pv.product_id
           AND p.tenant_id = p_tenant
          WHERE pv.tenant_id = p_tenant
            AND pv.variant_id = v_variant_id
          LIMIT 1;

          IF FOUND THEN
            IF COALESCE(TRIM(v_product_name), '') <> '' AND
               COALESCE(TRIM(v_variant_name), '') <> '' AND
               LOWER(TRIM(v_product_name)) <> LOWER(TRIM(v_variant_name)) THEN
              v_variant_label := TRIM(v_product_name) || ' - ' || TRIM(v_variant_name);
            ELSIF COALESCE(TRIM(v_product_name), '') <> '' THEN
              v_variant_label := TRIM(v_product_name);
            ELSIF COALESCE(TRIM(v_variant_name), '') <> '' THEN
              v_variant_label := TRIM(v_variant_name);
            ELSE
              v_variant_label := NULL;
            END IF;

            IF COALESCE(TRIM(v_sku), '') <> '' THEN
              v_variant_label := COALESCE(v_variant_label, 'Variante') || ' (' || TRIM(v_sku) || ')';
            END IF;

            IF COALESCE(v_variant_label, '') <> '' THEN
              v_error_pretty := REPLACE(v_raw_error, v_variant_id_text, v_variant_label);
            END IF;
          END IF;
        END IF;
      END IF;

      UPDATE mobile_sale_operations
      SET status = 'FAILED',
          last_error = v_error_pretty,
          updated_at = NOW()
      WHERE operation_id = p_operation_id;

      RAISE EXCEPTION '%', v_error_pretty;
  END;
END;
$$;

REVOKE ALL ON FUNCTION sp_create_sale_idempotent(TEXT, UUID, UUID, UUID, UUID, UUID, JSONB, JSONB, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sp_create_sale_idempotent(TEXT, UUID, UUID, UUID, UUID, UUID, JSONB, JSONB, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION sp_create_sale_idempotent(TEXT, UUID, UUID, UUID, UUID, UUID, JSONB, JSONB, TEXT, UUID) TO service_role;

COMMENT ON FUNCTION sp_create_sale_idempotent IS
'Wrapper idempotente mobile con mensaje de error legible (producto/variante) en fallas de stock.';
