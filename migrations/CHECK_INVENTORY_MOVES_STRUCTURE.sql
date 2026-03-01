/* ============================================================================
   Ver estructura de tabla inventory_moves
   ============================================================================ */

SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'inventory_moves'
  AND table_schema = 'public'
ORDER BY ordinal_position;
