-- ============================================================
-- ADD_ELECTRONIC_INVOICING.sql
-- Sistema dual de facturación: POS normal + Facturación Electrónica DIAN.
-- Todas las columnas nuevas en sales/sale_lines/product_variants son NULLABLE
-- para no romper el flujo existente cuando FE está deshabilitado.
-- ============================================================

-- ============================================================
-- 1) DATOS FISCALES DEL EMISOR → tabla tenants
-- ============================================================
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS dv                    TEXT,           -- Dígito de verificación del NIT
  ADD COLUMN IF NOT EXISTS trade_name            TEXT,           -- Nombre comercial (distinto de name=razón social)
  ADD COLUMN IF NOT EXISTS tax_regime            TEXT,           -- Régimen tributario DIAN
  ADD COLUMN IF NOT EXISTS is_responsible_for_iva BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS obligated_accounting  BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ciiu_code             TEXT,           -- Código actividad económica CIIU
  ADD COLUMN IF NOT EXISTS fiscal_email          TEXT,           -- Email para envío de FE
  ADD COLUMN IF NOT EXISTS fiscal_phone          TEXT;           -- Teléfono para datos emisor XML

COMMENT ON COLUMN tenants.dv                    IS 'Dígito de verificación del NIT (DIAN)';
COMMENT ON COLUMN tenants.trade_name            IS 'Nombre comercial del emisor';
COMMENT ON COLUMN tenants.tax_regime            IS 'Régimen tributario: 48=Responsable IVA, 49=No Responsable, Z=Simplificado';
COMMENT ON COLUMN tenants.is_responsible_for_iva IS 'El emisor es responsable de IVA ante la DIAN';
COMMENT ON COLUMN tenants.obligated_accounting  IS 'Obligado a llevar contabilidad';
COMMENT ON COLUMN tenants.ciiu_code             IS 'Código de actividad económica CIIU Rev.4';
COMMENT ON COLUMN tenants.fiscal_email          IS 'Email del emisor para encabezado XML de FE';
COMMENT ON COLUMN tenants.fiscal_phone          IS 'Teléfono del emisor para encabezado XML de FE';


-- ============================================================
-- 2) CONFIGURACIÓN DEL PROVEEDOR TECNOLÓGICO
--    Un proveedor tecnológico por tenant (habilitación o producción)
-- ============================================================
CREATE TABLE IF NOT EXISTS fe_provider_config (
  config_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  provider_name    TEXT NOT NULL DEFAULT '',       -- Nombre del proveedor (ej: "Gosocket", "SIIGO", propio)
  base_url         TEXT NOT NULL DEFAULT '',       -- URL base de la API del proveedor
  auth_type        TEXT NOT NULL DEFAULT 'apikey' CHECK (auth_type IN ('apikey','bearer','basic')),
  auth_header      TEXT NOT NULL DEFAULT 'X-API-Key', -- Nombre del header de autenticación
  api_key          TEXT,                           -- Clave / token (guardar cifrado en producción)
  software_id      TEXT,                           -- ID de software habilitado ante DIAN
  software_pin     TEXT,                           -- PIN del software ante DIAN
  environment      TEXT NOT NULL DEFAULT 'habilitacion' CHECK (environment IN ('habilitacion','produccion')),
  test_set_id      TEXT,                           -- ID del set de pruebas (solo ambiente habilitación)
  timeout_seconds  INTEGER NOT NULL DEFAULT 30,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id)                               -- un solo proveedor activo por tenant
);

COMMENT ON TABLE fe_provider_config IS 'Configuración del proveedor tecnológico de FE por tenant';
COMMENT ON COLUMN fe_provider_config.base_url    IS 'URL base sin barra final, ej: https://api.proveedor.co/v1';
COMMENT ON COLUMN fe_provider_config.auth_type   IS 'Método de autenticación: apikey (header), bearer (Authorization), basic (user:pass)';
COMMENT ON COLUMN fe_provider_config.api_key     IS 'Credencial principal. Para basic: almacenar como user:password';
COMMENT ON COLUMN fe_provider_config.software_id IS 'Identificador del software registrado ante DIAN';
COMMENT ON COLUMN fe_provider_config.test_set_id IS 'ID del set de pruebas asignado por DIAN para habilitación';

ALTER TABLE fe_provider_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fe_provider_config_tenant_all" ON fe_provider_config;
CREATE POLICY "fe_provider_config_tenant_all" ON fe_provider_config
  USING (tenant_id = fn_current_user_tenant_id())
  WITH CHECK (tenant_id = fn_current_user_tenant_id());


-- ============================================================
-- 3) RESOLUCIONES DIAN
--    Una o más resoluciones por tenant (FV tiquete, FE factura, NC, ND)
-- ============================================================
CREATE TABLE IF NOT EXISTS invoice_resolutions (
  resolution_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  document_type     TEXT NOT NULL DEFAULT 'FE' CHECK (document_type IN ('FV','FE','NC','ND')),
  prefix            TEXT NOT NULL DEFAULT '',      -- Prefijo autorizado (ej: SETP, FE, LETF)
  from_number       BIGINT NOT NULL DEFAULT 1,     -- Rango inicio
  to_number         BIGINT NOT NULL DEFAULT 1000,  -- Rango fin
  current_number    BIGINT NOT NULL DEFAULT 0,     -- Último consecutivo usado
  resolution_number TEXT,                          -- Número de la resolución DIAN
  resolution_date   DATE,                          -- Fecha de la resolución
  valid_from        DATE,                          -- Vigencia desde
  valid_to          DATE,                          -- Vigencia hasta
  technical_key     TEXT,                          -- Clave técnica para cálculo de CUFE (64 chars hex)
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_invoice_resolutions_tenant
  ON invoice_resolutions (tenant_id, document_type, is_active);

COMMENT ON TABLE invoice_resolutions IS 'Resoluciones DIAN autorizadas por tenant para FE';
COMMENT ON COLUMN invoice_resolutions.technical_key IS 'Clave técnica entregada por DIAN, usada para calcular el CUFE';
COMMENT ON COLUMN invoice_resolutions.current_number IS 'Consecutivo del último documento emitido, incrementar atómicamente al emitir';

ALTER TABLE invoice_resolutions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoice_resolutions_tenant_all" ON invoice_resolutions;
CREATE POLICY "invoice_resolutions_tenant_all" ON invoice_resolutions
  USING (tenant_id = fn_current_user_tenant_id())
  WITH CHECK (tenant_id = fn_current_user_tenant_id());


-- ============================================================
-- 4) COLUMNAS FE EN TABLA sales (todas NULLABLE → compatibilidad dual)
-- ============================================================
ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS third_party_id   UUID REFERENCES third_parties(third_party_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invoice_type     TEXT DEFAULT 'FV' CHECK (invoice_type IN ('FV','FE','NC','ND')),
  ADD COLUMN IF NOT EXISTS resolution_id    UUID REFERENCES invoice_resolutions(resolution_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dian_consecutive BIGINT,           -- Consecutivo asignado dentro de la resolución
  ADD COLUMN IF NOT EXISTS cufe             TEXT,             -- Código Único de Factura Electrónica (CUFE SHA-384)
  ADD COLUMN IF NOT EXISTS qr_url           TEXT,             -- URL QR de validación DIAN
  ADD COLUMN IF NOT EXISTS xml_path         TEXT,             -- Ruta/referencia del XML UBL 2.1 archivado
  ADD COLUMN IF NOT EXISTS dian_status      TEXT DEFAULT 'PENDING' CHECK (dian_status IN ('PENDING','PROCESSING','ACCEPTED','REJECTED','ERROR')),
  ADD COLUMN IF NOT EXISTS dian_response    JSONB,            -- Respuesta completa del proveedor / DIAN
  ADD COLUMN IF NOT EXISTS dian_sent_at     TIMESTAMPTZ,      -- Cuándo se envió al proveedor
  ADD COLUMN IF NOT EXISTS email_sent_at    TIMESTAMPTZ;      -- Cuándo se envió al receptor por email

COMMENT ON COLUMN sales.third_party_id   IS 'Receptor fiscal (de third_parties); reemplaza/complementa customer_id para FE';
COMMENT ON COLUMN sales.invoice_type     IS 'Tipo de documento: FV=Tiquete POS, FE=Factura Electrónica, NC=Nota Crédito, ND=Nota Débito';
COMMENT ON COLUMN sales.dian_consecutive IS 'Consecutivo dentro de la resolución DIAN autorizada';
COMMENT ON COLUMN sales.cufe             IS 'Hash SHA-384 del CUFE según algoritmo DIAN (calculado por proveedor tecnológico)';
COMMENT ON COLUMN sales.dian_status      IS 'Estado ante DIAN: PENDING=no enviado, PROCESSING=enviado, ACCEPTED=acusado, REJECTED=rechazado';
COMMENT ON COLUMN sales.dian_response    IS 'JSON con respuesta completa del proveedor tecnológico (útil para reintentos y auditoría)';

CREATE INDEX IF NOT EXISTS ix_sales_third_party ON sales (tenant_id, third_party_id) WHERE third_party_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_sales_dian_status  ON sales (tenant_id, dian_status) WHERE dian_status != 'ACCEPTED';


-- ============================================================
-- 5) COLUMNAS FE EN sale_lines (NULLABLE → compatibilidad dual)
-- ============================================================
ALTER TABLE sale_lines
  ADD COLUMN IF NOT EXISTS unit_id          UUID REFERENCES units_of_measure(unit_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS standard_code    TEXT,             -- Código UNSPSC del producto
  ADD COLUMN IF NOT EXISTS standard_code_type TEXT DEFAULT 'UNSPSC'; -- UNSPSC | EAN | GTIN | PARTNUM

COMMENT ON COLUMN sale_lines.unit_id          IS 'Unidad DIAN por línea (requerido en XML FE)';
COMMENT ON COLUMN sale_lines.standard_code    IS 'Código estándar del producto (UNSPSC por defecto)';
COMMENT ON COLUMN sale_lines.standard_code_type IS 'Tipo del código estándar: UNSPSC, EAN, GTIN, PARTNUM';


-- ============================================================
-- 6) COLUMNAS FE EN product_variants (NULLABLE → compatibilidad dual)
-- ============================================================
ALTER TABLE product_variants
  ADD COLUMN IF NOT EXISTS unit_id          UUID REFERENCES units_of_measure(unit_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS standard_code    TEXT,             -- Código UNSPSC
  ADD COLUMN IF NOT EXISTS standard_code_type TEXT DEFAULT 'UNSPSC';

COMMENT ON COLUMN product_variants.unit_id         IS 'Unidad de medida DIAN por defecto para esta variante';
COMMENT ON COLUMN product_variants.standard_code   IS 'Código estándar del producto (UNSPSC)';
COMMENT ON COLUMN product_variants.standard_code_type IS 'Tipo del código estándar';


-- ============================================================
-- 7) FUNCIÓN HELPER: obtener siguiente consecutivo (atómico)
-- ============================================================
CREATE OR REPLACE FUNCTION fn_next_invoice_consecutive(p_resolution_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next BIGINT;
  v_to   BIGINT;
BEGIN
  SELECT current_number + 1, to_number
    INTO v_next, v_to
    FROM invoice_resolutions
   WHERE resolution_id = p_resolution_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Resolución no encontrada: %', p_resolution_id;
  END IF;

  IF v_next > v_to THEN
    RAISE EXCEPTION 'La resolución % ha agotado su rango de consecutivos (hasta %)', p_resolution_id, v_to;
  END IF;

  UPDATE invoice_resolutions
     SET current_number = v_next,
         updated_at     = NOW()
   WHERE resolution_id  = p_resolution_id;

  RETURN v_next;
END;
$$;

COMMENT ON FUNCTION fn_next_invoice_consecutive IS 'Obtiene y reserva atómicamente el siguiente consecutivo de una resolución DIAN';

NOTIFY pgrst, 'reload schema';
