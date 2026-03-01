/* ============================================================
   FUNCIÓN HELPER: Verificar estado de RLS
   ============================================================
   Ejecutar este query en Supabase SQL Editor
   ============================================================ */

CREATE OR REPLACE FUNCTION check_rls_enabled()
RETURNS TABLE(table_name text, rls_enabled boolean, policies_count bigint)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 
    tablename::text,
    rowsecurity,
    (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public' AND pg_policies.tablename = pg_tables.tablename)
  FROM pg_tables
  WHERE schemaname = 'public' 
    AND tablename IN ('sales', 'cash_sessions', 'sale_lines', 'sale_payments')
  ORDER BY tablename;
$$;
