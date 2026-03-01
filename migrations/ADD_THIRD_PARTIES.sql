-- ===================================================================
-- Migración: Tabla `third_parties` (Terceros) - Clientes / Proveedores
-- Fecha: 2026-02-21
-- Objetivo: crear tabla idempotente con todos los campos relevantes
--           para facturación electrónica (Colombia / DIAN) y RLS/Permisos.
-- ===================================================================

DO $$ BEGIN RAISE NOTICE '' ; RAISE NOTICE '✅ CREANDO MIGRACIÓN third_parties'; END $$;

-- 1) Crear tabla principal (idempotente)
CREATE TABLE IF NOT EXISTS third_parties (
  third_party_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID REFERENCES tenants(tenant_id) ON DELETE CASCADE,

  -- Tipología
  type           TEXT NOT NULL DEFAULT 'both', -- 'customer' | 'supplier' | 'both'

  -- Identificación y nombres (obligatorios para facturación)
  document_type  TEXT,    -- Código DIAN: e.g. '13' = NIT, '31' = CC, etc.
  document_number TEXT,   -- Número de identificación (NIT, CC, etc.)
  dv             TEXT,    -- Dígito de verificación (si aplica)
  legal_name     TEXT,    -- Razón social (para facturación)
  trade_name     TEXT,    -- Nombre comercial / nombre de mostrador

  -- Contacto y dirección (address JSONB para flexibilidad)
  address        JSONB,   -- {street, city, department, postal_code, neighborhood}
  city           TEXT,
  department     TEXT,
  country_code   TEXT DEFAULT 'CO', -- ISO country code
  postal_code    TEXT,
  phone          TEXT,
  email          TEXT,
  fiscal_email   TEXT,    -- correo usado para facturación electrónica

  -- Fiscal / DIAN fields
  tax_regime     TEXT,    -- e.g. 'Régimen Común', 'Régimen Simplificado'
  tax_responsibilities TEXT[], -- lista de códigos de responsabilidades fiscales (p.ej. 'R-99-PN')
  is_responsible_for_iva BOOLEAN DEFAULT FALSE,
  obligated_accounting BOOLEAN DEFAULT FALSE, -- obligado a llevar contabilidad
  ciiu_code      TEXT,    -- CIIU / actividad económica principal
  contributor_type TEXT,  -- tipo de contribuyente (si aplica)

  -- Electronic invoicing flags
  electronic_invoicing_enabled BOOLEAN DEFAULT FALSE,
  electronic_invoicing_id TEXT, -- identificador DIAN / proveedor de servicios

  -- Defaults / comercial
  default_payment_terms INT, -- días
  default_currency TEXT DEFAULT 'COP',

  -- Límite de crédito máximo aplicable a cliente/proveedor
  max_credit_amount NUMERIC(14,2),

  is_active      BOOLEAN DEFAULT TRUE,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE third_parties IS 'Tabla unificada de clientes y proveedores con campos fiscales para facturación electrónica (Colombia)';

-- 2) Índices prácticos
CREATE INDEX IF NOT EXISTS idx_third_parties_tenant_name ON third_parties (tenant_id, lower(legal_name));
CREATE INDEX IF NOT EXISTS idx_third_parties_tenant_document ON third_parties (tenant_id, document_number);
CREATE INDEX IF NOT EXISTS idx_third_parties_doc ON third_parties (document_number);

-- Asegurar columna max_credit_amount si la tabla ya existía
ALTER TABLE third_parties ADD COLUMN IF NOT EXISTS max_credit_amount NUMERIC(14,2);

-- 3) Idempotencia: si existía una tabla "clientes", añadir columnas faltantes
-- (si el equipo ya tiene `clientes`, el siguiente bloque permite una
-- migración incremental copiando columnas comunes — opcional y segura).

-- Detectar tablas posibles (`customer`, `customers`, `clientes`) y migrar datos básicos si existe
DO $$
DECLARE
  src TEXT;
  src_exists BOOLEAN;
  has_document BOOLEAN;
  has_document_number BOOLEAN;
  has_dv BOOLEAN;
  has_full_name BOOLEAN;
  has_name BOOLEAN;
  has_legal_name BOOLEAN;
  has_trade_name BOOLEAN;
  has_display_name BOOLEAN;
  has_email BOOLEAN;
  has_phone BOOLEAN;
  has_address BOOLEAN;
  has_is_active BOOLEAN;
  addr_col TEXT;
  doc_expr TEXT;
  dv_expr TEXT;
  full_expr TEXT;
  trade_expr TEXT;
  email_expr TEXT;
  phone_expr TEXT;
  address_expr TEXT;
  is_active_expr TEXT;
  sql TEXT;
BEGIN
  FOR src IN SELECT unnest(ARRAY['customer','customers','clientes']) LOOP
    SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = src) INTO src_exists;
    IF src_exists THEN
      -- detectar columnas disponibles en la tabla fuente
      SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = src AND column_name = 'document') INTO has_document;
      SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = src AND column_name = 'document_number') INTO has_document_number;
      SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = src AND column_name = 'dv') INTO has_dv;
      SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = src AND column_name = 'full_name') INTO has_full_name;
      SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = src AND column_name = 'name') INTO has_name;
      SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = src AND column_name = 'legal_name') INTO has_legal_name;
      SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = src AND column_name = 'trade_name') INTO has_trade_name;
      SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = src AND column_name = 'display_name') INTO has_display_name;
      SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = src AND column_name = 'email') INTO has_email;
      SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = src AND column_name = 'phone') INTO has_phone;
      SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = src AND column_name = 'address') INTO has_address;
      SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = src AND column_name = 'is_active') INTO has_is_active;

      -- construir expresiones solo con columnas existentes
      IF has_document THEN
        doc_expr := 't.document';
      ELSIF has_document_number THEN
        doc_expr := 't.document_number';
      ELSE
        doc_expr := '''''';
      END IF;

      IF has_dv THEN
        dv_expr := 't.dv';
      ELSE
        dv_expr := '''''';
      END IF;

      IF has_full_name THEN
        full_expr := 't.full_name';
      ELSIF has_name THEN
        full_expr := 't.name';
      ELSIF has_legal_name THEN
        full_expr := 't.legal_name';
      ELSE
        full_expr := '''''';
      END IF;

      IF has_trade_name THEN
        trade_expr := 't.trade_name';
      ELSIF has_display_name THEN
        trade_expr := 't.display_name';
      ELSE
        trade_expr := full_expr;
      END IF;

      IF has_email THEN
        email_expr := 't.email';
      ELSE
        email_expr := 'NULL';
      END IF;

      IF has_phone THEN
        phone_expr := 't.phone';
      ELSE
        phone_expr := 'NULL';
      END IF;

      IF has_address THEN
        addr_col := 'address';
        -- Asegurar que ambas ramas devuelvan JSONB: castear la rama THEN a jsonb
        address_expr := format(
          'CASE WHEN pg_typeof(t.%1$I)::text = ''jsonb'' THEN t.%1$I::jsonb ELSE jsonb_build_object(''street'', t.%1$I::text) END',
          addr_col
        );
      ELSE
        address_expr := 'NULL';
      END IF;

      IF has_is_active THEN
        is_active_expr := 'COALESCE(t.is_active, TRUE)';
      ELSE
        is_active_expr := 'TRUE';
      END IF;

      sql := format($q$
        INSERT INTO third_parties (tenant_id, type, document_number, dv, legal_name, trade_name, email, phone, address, is_active, created_at, max_credit_amount)
        SELECT
          t.tenant_id,
          'customer',
          COALESCE(%s, ''),
          COALESCE(%s, ''),
          COALESCE(%s, ''),
          COALESCE(%s, ''),
          %s,
          %s,
          %s,
          %s,
          NOW(),
          NULL
        FROM %I t
        WHERE NOT EXISTS (
          SELECT 1 FROM third_parties tp
          WHERE tp.tenant_id = t.tenant_id
            AND tp.document_number = COALESCE(%s, '')
        );
      $q$, doc_expr, dv_expr, full_expr, trade_expr, email_expr, phone_expr, address_expr, is_active_expr, src, doc_expr);

      EXECUTE sql;
      RAISE NOTICE 'Migrated basic rows from table %', src;
      EXIT; -- solo migramos de la primera tabla encontrada
    END IF;
  END LOOP;
END $$;

-- 4) Permisos: insertar códigos de permiso necesarios (si no existen)
INSERT INTO permissions (permission_id, code, description)
SELECT gen_random_uuid(), pc.code, pc.description
FROM (VALUES
  ('THIRD_PARTIES.VIEW', 'Ver terceros (clientes/proveedores)'),
  ('THIRD_PARTIES.MANAGE', 'Crear/Editar/Borrar terceros'),
  ('THIRD_PARTIES.CREATE', 'Crear terceros')
) AS pc(code, description)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.code = pc.code);

DO $$ BEGIN RAISE NOTICE '✓ Permisos THIRD_PARTIES.* verificados/creados'; END $$;

-- 5) RLS: permitir lectura a usuarios del mismo tenant, escritura a Superadmin
ALTER TABLE third_parties ENABLE ROW LEVEL SECURITY;

-- SELECT policy: tenant users can read their tenant rows; Superadmin can read all
DROP POLICY IF EXISTS "third_parties_read_tenant" ON third_parties;
CREATE POLICY "third_parties_read_tenant" ON third_parties
  FOR SELECT USING (
    (
      EXISTS (
        SELECT 1 FROM users u WHERE u.auth_user_id = auth.uid() AND u.tenant_id = third_parties.tenant_id
      )
    )
    OR
    NOT EXISTS (SELECT 1 FROM users u WHERE u.auth_user_id = auth.uid()) -- Superadmin
  );

-- WRITE policy: Superadmin OR tenant users with THIRD_PARTIES.MANAGE permission
DROP POLICY IF EXISTS "third_parties_write_policy" ON third_parties;
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

DO $$ BEGIN RAISE NOTICE '✓ RLS configurado para third_parties (lectura tenant, escritura Superadmin/permiso)'; END $$;

-- 6) Helper opcional: migrar datos básicos desde `clientes` hacia `third_parties` si existe
-- Nota: se copia solo si third_parties vacío; revisar manualmente antes de ejecutar en producción.

DO $$
DECLARE v_exists INT := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'clientes') THEN
    SELECT COUNT(*) INTO v_exists FROM third_parties;
    IF v_exists = 0 THEN
      RAISE NOTICE '=> Migrando datos básicos desde clientes a third_parties (sólo si third_parties está vacío)';
      INSERT INTO third_parties (tenant_id, type, document_type, document_number, legal_name, trade_name, email, phone, city, department, address, is_active, created_at)
      SELECT
        c.tenant_id,
        'customer',
        COALESCE(c.document_type, ''),
        COALESCE(c.document_number, ''),
        COALESCE(c.legal_name, c.name),
        COALESCE(c.trade_name, c.name),
        c.email,
        c.phone,
        c.city,
        c.department,
        jsonb_build_object('street', c.address, 'postal_code', c.postal_code),
        COALESCE(c.is_active, TRUE),
        NOW()
      FROM clientes c
      ON CONFLICT (tenant_id, document_number) DO NOTHING;
    ELSE
      RAISE NOTICE 'third_parties no está vacío: omitiendo migración automática desde clientes';
    END IF;
  ELSE
    RAISE NOTICE 'No se detectó tabla clientes: no hay migración automática a ejecutar';
  END IF;
END $$;

-- ----------------------------------------------------------------
-- Excluir third_parties de supabase_realtime publication.
-- La extensión Walrus/Realtime inyecta una columna virtual _vts en
-- las tablas del publication; PostgREST no puede resolverla en el
-- schema cache y devuelve "Could not find the '_vts' column".
-- ----------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'third_parties'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE third_parties;
    RAISE NOTICE 'third_parties removida de supabase_realtime (fix _vts)';
  ELSE
    RAISE NOTICE 'third_parties no estaba en supabase_realtime — OK';
  END IF;
END $$;

DO $$ BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '══════════════════════════════════════════════════════';
  RAISE NOTICE '✅ third_parties: tabla y RLS creados (revisar migración opcional)';
  RAISE NOTICE '══════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;
