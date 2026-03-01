-- ===================================================================
-- Fix definitivo: funciones RPC para mutaciones en third_parties
-- Evita el endpoint REST /rest/v1/third_parties en INSERT/UPDATE/DELETE
-- que falla con el error "_vts column not found in schema cache".
-- El endpoint /rest/v1/rpc/* no usa el schema cache de tablas.
-- ===================================================================

-- UPSERT (crea o actualiza)
CREATE OR REPLACE FUNCTION fn_upsert_third_party(p_data JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_result JSONB;
BEGIN
  -- Si viene third_party_id es un UPDATE, si no es INSERT
  IF p_data->>'third_party_id' IS NOT NULL THEN
    v_id := (p_data->>'third_party_id')::UUID;
    UPDATE third_parties SET
      document_type             = COALESCE(p_data->>'document_type',             document_type),
      document_number           = COALESCE(p_data->>'document_number',           document_number),
      dv                        = COALESCE(p_data->>'dv',                        dv),
      legal_name                = COALESCE(p_data->>'legal_name',                legal_name),
      trade_name                = COALESCE(p_data->>'trade_name',                trade_name),
      phone                     = COALESCE(p_data->>'phone',                     phone),
      email                     = COALESCE(p_data->>'email',                     email),
      fiscal_email              = COALESCE(p_data->>'fiscal_email',              fiscal_email),
      address                   = COALESCE(to_jsonb(p_data->>'address'),          address),
      city                      = COALESCE(p_data->>'city',                      city),
      department                = COALESCE(p_data->>'department',                department),
      country_code              = COALESCE(p_data->>'country_code',              country_code),
      postal_code               = COALESCE(p_data->>'postal_code',               postal_code),
      tax_regime                = COALESCE(p_data->>'tax_regime',                tax_regime),
      is_responsible_for_iva    = COALESCE((p_data->>'is_responsible_for_iva')::BOOLEAN,  is_responsible_for_iva),
      obligated_accounting      = COALESCE((p_data->>'obligated_accounting')::BOOLEAN,    obligated_accounting),
      ciiu_code                 = COALESCE(p_data->>'ciiu_code',                 ciiu_code),
      contributor_type          = COALESCE(p_data->>'contributor_type',          contributor_type),
      electronic_invoicing_enabled = COALESCE((p_data->>'electronic_invoicing_enabled')::BOOLEAN, electronic_invoicing_enabled),
      electronic_invoicing_id   = COALESCE(p_data->>'electronic_invoicing_id',  electronic_invoicing_id),
      default_payment_terms     = COALESCE((p_data->>'default_payment_terms')::INT,       default_payment_terms),
      default_currency          = COALESCE(p_data->>'default_currency',          default_currency),
      max_credit_amount         = COALESCE((p_data->>'max_credit_amount')::NUMERIC,        max_credit_amount),
      is_active                 = COALESCE((p_data->>'is_active')::BOOLEAN,                is_active),
      type                      = COALESCE(p_data->>'type',                      type)
    WHERE third_party_id = v_id
      AND tenant_id = (p_data->>'tenant_id')::UUID;
  ELSE
    INSERT INTO third_parties (
      tenant_id, type, document_type, document_number, dv,
      legal_name, trade_name, phone, email, fiscal_email,
      address, city, department, country_code, postal_code,
      tax_regime, is_responsible_for_iva, obligated_accounting,
      ciiu_code, contributor_type, electronic_invoicing_enabled,
      electronic_invoicing_id, default_payment_terms,
      default_currency, max_credit_amount, is_active
    ) VALUES (
      (p_data->>'tenant_id')::UUID,
      COALESCE(p_data->>'type', 'both'),
      p_data->>'document_type',
      p_data->>'document_number',
      p_data->>'dv',
      p_data->>'legal_name',
      p_data->>'trade_name',
      p_data->>'phone',
      p_data->>'email',
      p_data->>'fiscal_email',
      to_jsonb(p_data->>'address'),
      p_data->>'city',
      p_data->>'department',
      COALESCE(p_data->>'country_code', 'CO'),
      p_data->>'postal_code',
      p_data->>'tax_regime',
      COALESCE((p_data->>'is_responsible_for_iva')::BOOLEAN, FALSE),
      COALESCE((p_data->>'obligated_accounting')::BOOLEAN, FALSE),
      p_data->>'ciiu_code',
      p_data->>'contributor_type',
      COALESCE((p_data->>'electronic_invoicing_enabled')::BOOLEAN, FALSE),
      p_data->>'electronic_invoicing_id',
      (p_data->>'default_payment_terms')::INT,
      COALESCE(p_data->>'default_currency', 'COP'),
      (p_data->>'max_credit_amount')::NUMERIC,
      COALESCE((p_data->>'is_active')::BOOLEAN, TRUE)
    )
    RETURNING third_party_id INTO v_id;
  END IF;

  -- Retornar la fila resultante como JSONB
  SELECT to_jsonb(t) INTO v_result
  FROM (
    SELECT third_party_id, tenant_id, type, document_type, document_number, dv,
           legal_name, trade_name, phone, email, fiscal_email, address,
           city, department, country_code, postal_code, max_credit_amount,
           default_payment_terms, default_currency, is_active, created_at
    FROM third_parties
    WHERE third_party_id = v_id
  ) t;

  RETURN v_result;
END;
$$;

-- DELETE
CREATE OR REPLACE FUNCTION fn_delete_third_party(p_id UUID, p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM third_parties
  WHERE third_party_id = p_id AND tenant_id = p_tenant_id;
  RETURN FOUND;
END;
$$;

-- Permisos para que los usuarios autenticados puedan llamar las funciones
GRANT EXECUTE ON FUNCTION fn_upsert_third_party(JSONB)    TO authenticated;
GRANT EXECUTE ON FUNCTION fn_delete_third_party(UUID, UUID) TO authenticated;

DO $$ BEGIN
  RAISE NOTICE '✅ Funciones RPC fn_upsert_third_party y fn_delete_third_party creadas';
END $$;
