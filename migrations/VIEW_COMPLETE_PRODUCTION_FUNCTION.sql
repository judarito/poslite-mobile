/* ============================================================================
   Ver código fuente completo de fn_complete_production
   ============================================================================ */

SELECT pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'fn_complete_production';
