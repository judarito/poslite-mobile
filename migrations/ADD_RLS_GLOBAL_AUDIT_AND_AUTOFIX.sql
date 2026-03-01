-- ===================================================================
-- Security v3: Global RLS audit + optional autofix (tenant scoped)
-- ===================================================================
--
-- WHAT THIS SCRIPT DOES
-- 1) Creates a reusable audit view for all tables in public schema.
-- 2) Creates function sp_audit_rls_and_optionally_apply(p_apply boolean).
-- 3) If p_apply = false (default): only reports status, no changes.
-- 4) If p_apply = true: for tables with tenant_id and zero policies,
--    it enables RLS and creates base tenant policies (SELECT/INSERT/UPDATE/DELETE).
--    For tables without tenant_id and without policies, it does NOT enable RLS.
--
-- IMPORTANT
-- - It does NOT modify tables that already have at least one policy.
-- - It does NOT create policies for tables without tenant_id.
-- - Keep your role/location/cash-box specific policies as higher-level hardening.
--

CREATE OR REPLACE VIEW vw_rls_audit_public AS
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced,
  EXISTS (
    SELECT 1
    FROM information_schema.columns ic
    WHERE ic.table_schema = n.nspname
      AND ic.table_name = c.relname
      AND ic.column_name = 'tenant_id'
  ) AS has_tenant_id,
  (
    SELECT COUNT(*)::int
    FROM pg_policies p
    WHERE p.schemaname = n.nspname
      AND p.tablename = c.relname
  ) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r';

COMMENT ON VIEW vw_rls_audit_public IS
  'RLS audit for public tables: rls flags, tenant_id presence, and policy count.';

CREATE OR REPLACE FUNCTION sp_audit_rls_and_optionally_apply(
  p_apply boolean DEFAULT false
)
RETURNS TABLE (
  schema_name text,
  table_name text,
  rls_enabled boolean,
  has_tenant_id boolean,
  policy_count int,
  action text,
  detail text
)
LANGUAGE plpgsql
AS $$
DECLARE
  v record;
  v_table regclass;
BEGIN
  FOR v IN
    SELECT *
    FROM vw_rls_audit_public
    ORDER BY table_name
  LOOP
    v_table := format('%I.%I', v.schema_name, v.table_name)::regclass;

    -- Default row: report only
    schema_name := v.schema_name;
    table_name := v.table_name;
    rls_enabled := v.rls_enabled;
    has_tenant_id := v.has_tenant_id;
    policy_count := v.policy_count;
    action := 'AUDIT_ONLY';
    detail := 'No changes requested';

    IF p_apply THEN
      -- Step 1: enable RLS when missing, only if safe to do so
      -- Safe cases:
      --   a) table already has policies, or
      --   b) table has tenant_id (we can auto-create baseline policies)
      IF NOT v.rls_enabled THEN
        IF v.policy_count > 0 OR v.has_tenant_id THEN
          EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', v.schema_name, v.table_name);
          rls_enabled := true;
          action := 'RLS_ENABLED';
          detail := 'Enabled RLS';
        ELSE
          action := 'NO_AUTOFIX';
          detail := 'Skipped: table without tenant_id and without policies';
        END IF;
      END IF;

      -- Step 2: create baseline policies only when table has tenant_id and zero policies
      IF v.has_tenant_id AND v.policy_count = 0 THEN
        EXECUTE format(
          'CREATE POLICY %I ON %I.%I FOR SELECT USING (tenant_id = get_current_user_tenant_id())',
          'rls_auto_' || v.table_name || '_select',
          v.schema_name,
          v.table_name
        );

        EXECUTE format(
          'CREATE POLICY %I ON %I.%I FOR INSERT WITH CHECK (tenant_id = get_current_user_tenant_id())',
          'rls_auto_' || v.table_name || '_insert',
          v.schema_name,
          v.table_name
        );

        EXECUTE format(
          'CREATE POLICY %I ON %I.%I FOR UPDATE USING (tenant_id = get_current_user_tenant_id()) WITH CHECK (tenant_id = get_current_user_tenant_id())',
          'rls_auto_' || v.table_name || '_update',
          v.schema_name,
          v.table_name
        );

        EXECUTE format(
          'CREATE POLICY %I ON %I.%I FOR DELETE USING (tenant_id = get_current_user_tenant_id())',
          'rls_auto_' || v.table_name || '_delete',
          v.schema_name,
          v.table_name
        );

        policy_count := 4;
        action := CASE WHEN action = 'RLS_ENABLED' THEN 'RLS_ENABLED_AND_POLICIES_CREATED' ELSE 'POLICIES_CREATED' END;
        detail := 'Created 4 baseline tenant policies (auto)';
      ELSIF NOT v.has_tenant_id AND v.policy_count = 0 THEN
        action := 'NO_AUTOFIX';
        detail := 'Table has no tenant_id; manual policy design required (RLS not auto-enabled)';
      ELSIF v.policy_count > 0 THEN
        IF action = 'AUDIT_ONLY' THEN
          action := 'NO_CHANGE';
          detail := 'Existing policies detected; no autofix applied';
        END IF;
      END IF;
    END IF;

    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION sp_audit_rls_and_optionally_apply(boolean) IS
  'Audit all public tables for RLS/policies. Optional autofix for tenant_id tables without policies.';

-- -------------------------------------------------------------------
-- Usage
-- -------------------------------------------------------------------
-- 1) Audit only (safe):
--    SELECT * FROM sp_audit_rls_and_optionally_apply(false);
--
-- 2) Apply baseline autofix where safe:
--    SELECT * FROM sp_audit_rls_and_optionally_apply(true);
--
-- 3) Final status:
--    SELECT * FROM vw_rls_audit_public ORDER BY table_name;

NOTIFY pgrst, 'reload schema';
