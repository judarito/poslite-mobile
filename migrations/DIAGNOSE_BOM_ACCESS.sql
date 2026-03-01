-- ============================================================================
-- DIAGNÓSTICO: Por qué no se muestran los BOMs en la UI
-- ============================================================================

-- 1. Ver el BOM completo con tenant_id
SELECT 
  bom_id,
  bom_name,
  tenant_id,
  product_id,
  variant_id,
  is_active,
  created_at
FROM bill_of_materials
ORDER BY created_at DESC
LIMIT 5;

-- 2. Verificar políticas RLS activas en bill_of_materials
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual
FROM pg_policies
WHERE tablename = 'bill_of_materials';

-- 3. Ver si hay RLS habilitado
SELECT 
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE tablename = 'bill_of_materials';

-- 4. Contar BOMs por tenant
SELECT 
  tenant_id,
  COUNT(*) as total_boms
FROM bill_of_materials
GROUP BY tenant_id;

-- 5. Ver el tenant_id del usuario actual (si estás usando Supabase auth)
-- Ejecuta esto DESPUÉS de autenticarte en Supabase:
-- SELECT auth.uid(), auth.jwt()->>'tenant_id';
