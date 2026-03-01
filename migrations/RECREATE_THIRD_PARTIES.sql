-- ===================================================================
-- Fix: Recrear tabla third_parties para limpiar schema cache de PostgREST
-- Causa: PostgREST tiene en cache una columna virtual _vts que no existe
-- Solución: DROP + CREATE fuerza rebuild del schema cache sin _vts
-- ===================================================================

BEGIN;

-- 1) Guardar datos existentes en tabla temporal
CREATE TEMP TABLE third_parties_backup AS
SELECT * FROM third_parties;

DO $$ BEGIN 
  RAISE NOTICE '✓ Backup: % filas guardadas', (SELECT COUNT(*) FROM third_parties_backup);
END $$;

-- 2) Eliminar políticas RLS primero
DROP POLICY IF EXISTS "third_parties_read_tenant"  ON third_parties;
DROP POLICY IF EXISTS "third_parties_write_policy" ON third_parties;

-- 3) Eliminar índices
DROP INDEX IF EXISTS idx_third_parties_tenant_name;
DROP INDEX IF EXISTS idx_third_parties_tenant_document;
DROP INDEX IF EXISTS idx_third_parties_doc;

-- 4) Eliminar tabla
DROP TABLE third_parties;

-- 5) Recrear tabla limpia
CREATE TABLE third_parties (
  third_party_id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID        REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  type                      TEXT        NOT NULL DEFAULT 'both',
  document_type             TEXT,
  document_number           TEXT,
  dv                        TEXT,
  legal_name                TEXT,
  trade_name                TEXT,
  address                   JSONB,
  city                      TEXT,
  department                TEXT,
  country_code              TEXT        DEFAULT 'CO',
  postal_code               TEXT,
  phone                     TEXT,
  email                     TEXT,
  fiscal_email              TEXT,
  tax_regime                TEXT,
  tax_responsibilities      TEXT[],
  is_responsible_for_iva    BOOLEAN     DEFAULT FALSE,
  obligated_accounting      BOOLEAN     DEFAULT FALSE,
  ciiu_code                 TEXT,
  contributor_type          TEXT,
  electronic_invoicing_enabled BOOLEAN  DEFAULT FALSE,
  electronic_invoicing_id   TEXT,
  default_payment_terms     INT,
  default_currency          TEXT        DEFAULT 'COP',
  max_credit_amount         NUMERIC(14,2),
  is_active                 BOOLEAN     DEFAULT TRUE,
  created_at                TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE third_parties IS 'Tabla unificada de clientes y proveedores con campos fiscales para facturación electrónica (Colombia)';

-- 6) Recrear índices
CREATE INDEX idx_third_parties_tenant_name     ON third_parties (tenant_id, lower(legal_name));
CREATE INDEX idx_third_parties_tenant_document ON third_parties (tenant_id, document_number);
CREATE INDEX idx_third_parties_doc             ON third_parties (document_number);

-- 7) Restaurar datos
INSERT INTO third_parties (
  third_party_id, tenant_id, type, document_type, document_number, dv,
  legal_name, trade_name, address, city, department, country_code, postal_code,
  phone, email, fiscal_email, tax_regime, tax_responsibilities,
  is_responsible_for_iva, obligated_accounting, ciiu_code, contributor_type,
  electronic_invoicing_enabled, electronic_invoicing_id,
  default_payment_terms, default_currency, max_credit_amount, is_active, created_at
)
SELECT
  third_party_id, tenant_id, type, document_type, document_number, dv,
  legal_name, trade_name, address, city, department, country_code, postal_code,
  phone, email, fiscal_email, tax_regime, tax_responsibilities,
  is_responsible_for_iva, obligated_accounting, ciiu_code, contributor_type,
  electronic_invoicing_enabled, electronic_invoicing_id,
  default_payment_terms, default_currency, max_credit_amount, is_active, created_at
FROM third_parties_backup;

DO $$ BEGIN 
  RAISE NOTICE '✓ Datos restaurados: % filas', (SELECT COUNT(*) FROM third_parties);
END $$;

-- 8) Habilitar RLS
ALTER TABLE third_parties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "third_parties_read_tenant" ON third_parties
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM users u WHERE u.auth_user_id = auth.uid() AND u.tenant_id = third_parties.tenant_id)
    OR NOT EXISTS (SELECT 1 FROM users u WHERE u.auth_user_id = auth.uid())
  );

CREATE POLICY "third_parties_write_policy" ON third_parties
  FOR ALL USING (
    NOT EXISTS (SELECT 1 FROM users u WHERE u.auth_user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM users u
      JOIN user_roles ur ON ur.user_id = u.user_id
      JOIN role_permissions rp ON rp.role_id = ur.role_id
      JOIN permissions p ON p.permission_id = rp.permission_id
      WHERE u.auth_user_id = auth.uid()
        AND p.code = 'THIRD_PARTIES.MANAGE'
        AND u.tenant_id = third_parties.tenant_id
    )
  );

-- 9) Confirmar que NO está en el publication de realtime
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'third_parties'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE third_parties;
    RAISE NOTICE 'third_parties removida de supabase_realtime';
  END IF;
END $$;

-- 10) Forzar recarga del schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;

DO $$ BEGIN 
  RAISE NOTICE '';
  RAISE NOTICE '✅ third_parties recreada correctamente. Schema cache recargado.';
  RAISE NOTICE '';
END $$;
