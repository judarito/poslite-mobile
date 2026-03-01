-- ============================================================
-- ADD_FE_COMPLEMENTARY.sql
-- Complemento a ADD_ELECTRONIC_INVOICING.sql.
-- Cubre brechas detectadas en el análisis post-implementación:
--
--  1) Dirección completa del emisor en tenants (requerida en XML FE)
--  2) Código DANE municipio en third_parties (requerido en XML FE)
--  3) Código forma de pago DIAN en payment_methods
--  4) Corrige dian_status default a NULL (FV no debe quedar como PENDING)
--  5) Actualiza fn_upsert_third_party para incluir city_code
--
-- IDEMPOTENTE: seguro ejecutar múltiples veces.
-- PRERREQUISITO: ADD_ELECTRONIC_INVOICING.sql ya ejecutado.
-- ============================================================


-- ============================================================
-- 1) DIRECCIÓN FISCAL DEL EMISOR → tabla tenants
--    El XML UBL 2.1 exige dirección completa del emisor.
-- ============================================================
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS address      TEXT,           -- Dirección fiscal completa
  ADD COLUMN IF NOT EXISTS city         TEXT,           -- Nombre de la ciudad
  ADD COLUMN IF NOT EXISTS department   TEXT,           -- Nombre del departamento
  ADD COLUMN IF NOT EXISTS country_code TEXT DEFAULT 'CO', -- Código ISO 3166-1 (Colombia = CO)
  ADD COLUMN IF NOT EXISTS postal_code  TEXT,           -- Código postal
  ADD COLUMN IF NOT EXISTS city_code    TEXT;           -- Código DANE 5 dígitos (ej: 11001 = Bogotá)

COMMENT ON COLUMN tenants.address      IS 'Dirección fiscal del emisor para XML FE (ej: Calle 68 # 95 - 30 Piso 2)';
COMMENT ON COLUMN tenants.city         IS 'Nombre del municipio del emisor';
COMMENT ON COLUMN tenants.department   IS 'Nombre del departamento del emisor';
COMMENT ON COLUMN tenants.country_code IS 'Código ISO 3166-1 alpha-2 del país del emisor (defecto CO)';
COMMENT ON COLUMN tenants.postal_code  IS 'Código postal del emisor';
COMMENT ON COLUMN tenants.city_code    IS 'Código DANE 5 dígitos del municipio emisor (ej: 11001 = Bogotá D.C.)';


-- ============================================================
-- 2) CÓDIGO DANE MUNICIPIO → tabla third_parties
--    Requerido en el XML FE para identificar municipio del receptor.
-- ============================================================
ALTER TABLE third_parties
  ADD COLUMN IF NOT EXISTS city_code     TEXT;          -- Código DANE 5 dígitos del municipio

COMMENT ON COLUMN third_parties.city_code IS 'Código DANE 5 dígitos del municipio del receptor fiscal (ej: 11001 = Bogotá D.C.)';


-- ============================================================
-- 3) CÓDIGO DIAN FORMA DE PAGO → tabla payment_methods
--    El XML FE requiere el código numérico de forma de pago DIAN.
--    Referencia de códigos comunes DIAN:
--      10 = Efectivo
--      20 = Cheque
--      22 = Transferencia bancaria
--      42 = Consignación bancaria
--      48 = Tarjeta crédito
--      49 = Tarjeta débito
--      ZZZ = Otro
-- ============================================================
ALTER TABLE payment_methods
  ADD COLUMN IF NOT EXISTS dian_payment_code TEXT DEFAULT '10';

COMMENT ON COLUMN payment_methods.dian_payment_code IS 'Código DIAN de forma de pago para XML FE: 10=Efectivo, 20=Cheque, 22=Transferencia, 42=Consignación, 48=Tarjeta Crédito, 49=Tarjeta Débito, ZZZ=Otro';

-- Actualizar los métodos de pago más comunes automáticamente (si existen con esos code)
UPDATE payment_methods SET dian_payment_code = '10'  WHERE LOWER(code) IN ('cash','efectivo','cash_efectivo') AND dian_payment_code IS NULL;
UPDATE payment_methods SET dian_payment_code = '48'  WHERE LOWER(code) IN ('card','tarjeta','credit_card','credito') AND dian_payment_code IS NULL;
UPDATE payment_methods SET dian_payment_code = '49'  WHERE LOWER(code) IN ('debit','debito','debit_card') AND dian_payment_code IS NULL;
UPDATE payment_methods SET dian_payment_code = '22'  WHERE LOWER(code) IN ('transfer','transferencia','nequi','daviplata','pse') AND dian_payment_code IS NULL;


-- ============================================================
-- 4) CORREGIR DEFAULT dian_status
--    Las ventas FV (tiquete POS) no deben quedar como PENDING.
--    Al cambiar el default a NULL → solo las ventas FE activas
--    muestran un estado de procesamiento.
-- ============================================================
DO $$
BEGIN
  -- Solo corregir si la columna existe (ADD_ELECTRONIC_INVOICING.sql ya fue ejecutado)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sales' AND column_name = 'dian_status'
  ) THEN
    ALTER TABLE sales ALTER COLUMN dian_status SET DEFAULT NULL;
    -- Limpiar las ventas PENDING que nunca tuvieron intento FE
    UPDATE sales
      SET dian_status = NULL
    WHERE dian_status = 'PENDING'
      AND dian_sent_at IS NULL
      AND (invoice_type = 'FV' OR invoice_type IS NULL);
    RAISE NOTICE '✓ dian_status default corregido a NULL; ventas FV limpiadas';
  ELSE
    RAISE NOTICE '⚠  Columna sales.dian_status no encontrada - ejecutar ADD_ELECTRONIC_INVOICING.sql primero';
  END IF;
END;
$$;


-- ============================================================
-- 5) ACTUALIZAR fn_upsert_third_party PARA INCLUIR city_code
-- ============================================================
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
  IF p_data->>'third_party_id' IS NOT NULL THEN
    v_id := (p_data->>'third_party_id')::UUID;
    UPDATE third_parties SET
      document_type               = COALESCE(p_data->>'document_type',               document_type),
      document_number             = COALESCE(p_data->>'document_number',             document_number),
      dv                          = COALESCE(p_data->>'dv',                          dv),
      legal_name                  = COALESCE(p_data->>'legal_name',                  legal_name),
      trade_name                  = COALESCE(p_data->>'trade_name',                  trade_name),
      phone                       = COALESCE(p_data->>'phone',                       phone),
      email                       = COALESCE(p_data->>'email',                       email),
      fiscal_email                = COALESCE(p_data->>'fiscal_email',                fiscal_email),
      address                     = COALESCE(to_jsonb(p_data->>'address'),           address),
      city                        = COALESCE(p_data->>'city',                        city),
      department                  = COALESCE(p_data->>'department',                  department),
      country_code                = COALESCE(p_data->>'country_code',                country_code),
      postal_code                 = COALESCE(p_data->>'postal_code',                 postal_code),
      city_code                   = COALESCE(p_data->>'city_code',                   city_code),   -- NUEVO
      tax_regime                  = COALESCE(p_data->>'tax_regime',                  tax_regime),
      is_responsible_for_iva      = COALESCE((p_data->>'is_responsible_for_iva')::BOOLEAN,  is_responsible_for_iva),
      obligated_accounting        = COALESCE((p_data->>'obligated_accounting')::BOOLEAN,    obligated_accounting),
      ciiu_code                   = COALESCE(p_data->>'ciiu_code',                   ciiu_code),
      contributor_type            = COALESCE(p_data->>'contributor_type',            contributor_type),
      electronic_invoicing_enabled = COALESCE((p_data->>'electronic_invoicing_enabled')::BOOLEAN, electronic_invoicing_enabled),
      electronic_invoicing_id     = COALESCE(p_data->>'electronic_invoicing_id',    electronic_invoicing_id),
      default_payment_terms       = COALESCE((p_data->>'default_payment_terms')::INT,       default_payment_terms),
      default_currency            = COALESCE(p_data->>'default_currency',            default_currency),
      max_credit_amount           = COALESCE((p_data->>'max_credit_amount')::NUMERIC,        max_credit_amount),
      is_active                   = COALESCE((p_data->>'is_active')::BOOLEAN,                is_active),
      type                        = COALESCE(p_data->>'type',                        type)
    WHERE third_party_id = v_id
      AND tenant_id = (p_data->>'tenant_id')::UUID;
  ELSE
    INSERT INTO third_parties (
      tenant_id, type, document_type, document_number, dv,
      legal_name, trade_name, phone, email, fiscal_email,
      address, city, department, country_code, postal_code, city_code,  -- NUEVO: city_code
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
      p_data->>'city_code',                                              -- NUEVO: city_code
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

  SELECT to_jsonb(t) INTO v_result
  FROM (
    SELECT third_party_id, tenant_id, type, document_type, document_number, dv,
           legal_name, trade_name, phone, email, fiscal_email, address,
           city, department, country_code, postal_code, city_code,       -- NUEVO: city_code
           max_credit_amount, default_payment_terms, default_currency, is_active, created_at
    FROM third_parties
    WHERE third_party_id = v_id
  ) t;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_upsert_third_party(JSONB) TO authenticated;

COMMENT ON FUNCTION fn_upsert_third_party IS 'Crea o actualiza un tercero (cliente/proveedor). Versión 2.0: incluye city_code DANE.';


-- ============================================================
-- FIN
-- ============================================================
NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ ADD_FE_COMPLEMENTARY.sql ejecutado';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '  ✓ tenants: address, city, department, country_code, postal_code, city_code';
  RAISE NOTICE '  ✓ third_parties: city_code';
  RAISE NOTICE '  ✓ payment_methods: dian_payment_code (default 10=Efectivo)';
  RAISE NOTICE '  ✓ sales.dian_status: default cambiado a NULL';
  RAISE NOTICE '  ✓ fn_upsert_third_party: incluye city_code';
  RAISE NOTICE '';
  RAISE NOTICE 'SIGUIENTE PASO: Ejecutar UPDATE_SP_CREATE_SALE_FE.sql';
  RAISE NOTICE '════════════════════════════════════════════════════════';
END;
$$ LANGUAGE plpgsql;
