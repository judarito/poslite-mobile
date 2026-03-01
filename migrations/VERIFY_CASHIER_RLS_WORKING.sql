/* ============================================================
   VERIFICACIÓN: Políticas RLS funcionando correctamente
   ============================================================
   Ejecutar como ADMINISTRADOR en Supabase SQL Editor
   ============================================================ */

-- 1. Ver el tenant del cajero Angel Ricardo
SELECT user_id, full_name, email, tenant_id 
FROM users 
WHERE email = 'angelr@gmail.com';

-- 2. Ver TODAS las ventas del tenant (esto debe mostrar MÁS de 6 ventas si hay otras)
SELECT 
  s.sale_id,
  s.sale_number,
  s.cash_session_id,
  s.total,
  s.sold_at,
  cs.opened_by,
  u.full_name as cajero
FROM sales s
LEFT JOIN cash_sessions cs ON cs.cash_session_id = s.cash_session_id
LEFT JOIN users u ON u.user_id = cs.opened_by
WHERE s.tenant_id = '5cc9b7b7-e023-4126-918e-9748d232fc14'
ORDER BY s.sold_at DESC;

-- 3. Contar ventas por cajero
SELECT 
  u.full_name as cajero,
  COUNT(*) as total_ventas,
  SUM(s.total) as total_monto
FROM sales s
LEFT JOIN cash_sessions cs ON cs.cash_session_id = s.cash_session_id
LEFT JOIN users u ON u.user_id = cs.opened_by
WHERE s.tenant_id = '5cc9b7b7-e023-4126-918e-9748d232fc14'
GROUP BY u.full_name
ORDER BY total_ventas DESC;

-- 4. Verificar si hay ventas sin cash_session_id (estas NO serían visibles para cajeros)
SELECT 
  COUNT(*) as ventas_sin_sesion,
  SUM(total) as monto_total
FROM sales
WHERE tenant_id = '5cc9b7b7-e023-4126-918e-9748d232fc14'
  AND cash_session_id IS NULL;

-- 5. Ver las políticas activas en sales
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies 
WHERE tablename = 'sales';
