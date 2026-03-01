-- ============================================================
-- CREATE_BULK_IMPORT_TRACKING.sql
-- Tablas auxiliares para seguimiento de cargas masivas desde Excel.
-- Incluye APIs de producto/variante y terceros por separado.
-- ============================================================

-- Tabla base para importaciones masivas (productos/variantes y terceros en una sola tabla)
CREATE TABLE IF NOT EXISTS bulk_imports (
  import_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  import_type text NOT NULL CHECK (import_type IN ('product_variants','third_parties')),
  file_key text NOT NULL,
  file_name text NOT NULL,
  uploaded_by uuid REFERENCES users(user_id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('pending','processing','completed','completed_with_errors','failed')) DEFAULT 'pending',
  row_count integer DEFAULT 0,
  processed_count integer DEFAULT 0,
  error_count integer DEFAULT 0,
  summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bulk_import_errors (
  error_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES bulk_imports(import_id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  detail text NOT NULL,
  raw_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_bulk_imports_tenant ON bulk_imports(tenant_id, import_type, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_bulk_import_errors_import ON bulk_import_errors(import_id);

-- RLS para bulk_imports
ALTER TABLE bulk_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bulk_imports_tenant_select" ON bulk_imports;
CREATE POLICY "bulk_imports_tenant_select" ON bulk_imports
  FOR SELECT USING (tenant_id = fn_current_user_tenant_id());

DROP POLICY IF EXISTS "bulk_imports_tenant_insert" ON bulk_imports;
CREATE POLICY "bulk_imports_tenant_insert" ON bulk_imports
  FOR INSERT WITH CHECK (tenant_id = fn_current_user_tenant_id());

DROP POLICY IF EXISTS "bulk_imports_tenant_update" ON bulk_imports;
CREATE POLICY "bulk_imports_tenant_update" ON bulk_imports
  FOR UPDATE USING (tenant_id = fn_current_user_tenant_id());

-- RLS para bulk_import_errors
ALTER TABLE bulk_import_errors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bulk_import_errors_tenant_select" ON bulk_import_errors;
CREATE POLICY "bulk_import_errors_tenant_select" ON bulk_import_errors
  FOR SELECT USING (
    import_id IN (
      SELECT import_id FROM bulk_imports WHERE tenant_id = fn_current_user_tenant_id()
    )
  );

DROP POLICY IF EXISTS "bulk_import_errors_tenant_insert" ON bulk_import_errors;
CREATE POLICY "bulk_import_errors_tenant_insert" ON bulk_import_errors
  FOR INSERT WITH CHECK (
    import_id IN (
      SELECT import_id FROM bulk_imports WHERE tenant_id = fn_current_user_tenant_id()
    )
  );
