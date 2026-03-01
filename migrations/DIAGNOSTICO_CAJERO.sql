/* ============================================================
   DIAGNÓSTICO: Verificar mapeo de usuario cajero
   ============================================================
   Ejecutar estos queries como usuario CAJERO en Supabase
   ============================================================ */

-- 1) Verificar el auth.uid() actual
SELECT auth.uid() as mi_auth_user_id;

-- 2) Buscar si existe en la tabla users
SELECT 
  user_id,
  auth_user_id,
  name,
  email,
  tenant_id,
  active
FROM users 
WHERE auth_user_id = auth.uid();

-- 3) Verificar roles asignados al usuario
SELECT 
  u.name as usuario,
  u.email,
  r.name as rol
FROM users u
JOIN user_roles ur ON ur.user_id = u.user_id
JOIN roles r ON r.role_id = ur.role_id
WHERE u.auth_user_id = auth.uid();

-- 4) Verificar si el usuario tiene sesiones de caja abiertas
SELECT 
  cs.cash_session_id,
  cs.cash_register_id,
  cs.opened_at,
  cs.status,
  u.name as cajero
FROM cash_sessions cs
JOIN users u ON u.user_id = cs.opened_by
WHERE u.auth_user_id = auth.uid();

-- 5) Verificar asignaciones de caja del usuario
SELECT 
  cra.user_id,
  u.name as cajero,
  cr.name as caja,
  l.name as ubicacion,
  cra.assigned_at
FROM cash_register_assignments cra
JOIN users u ON u.user_id = cra.user_id
JOIN cash_registers cr ON cr.cash_register_id = cra.cash_register_id
JOIN locations l ON l.location_id = cr.location_id
WHERE u.auth_user_id = auth.uid();

-- 6) Verificar todas las ventas (sin RLS - ejecutar como admin o desactivar RLS temporalmente)
-- Este query solo funcionará si lo ejecutas como ADMINISTRADOR
SELECT 
  s.sale_id,
  s.cash_session_id,
  s.created_at,
  u.name as cajero,
  cs.status as estado_sesion
FROM sales s
LEFT JOIN cash_sessions cs ON cs.cash_session_id = s.cash_session_id
LEFT JOIN users u ON u.user_id = cs.opened_by
ORDER BY s.created_at DESC
LIMIT 10;
