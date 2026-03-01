/* ============================================================
   RLS POLICIES: Tax Rules
   ============================================================
   
   Políticas de seguridad para tax_rules
   Solo usuarios con permiso SETTINGS.TAXES.MANAGE pueden gestionar
   
   ============================================================ */

-- Habilitar RLS
ALTER TABLE tax_rules ENABLE ROW LEVEL SECURITY;

-- Limpiar políticas existentes
DROP POLICY IF EXISTS "Users can view tax rules of their tenant" ON tax_rules;
DROP POLICY IF EXISTS "Users can manage tax rules of their tenant" ON tax_rules;

-- Política de lectura: Ver reglas del tenant
CREATE POLICY "Users can view tax rules of their tenant"
ON tax_rules FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = tax_rules.tenant_id
  )
);

-- Política de escritura: Solo con permiso SETTINGS.TAXES.MANAGE
CREATE POLICY "Users can manage tax rules of their tenant"
ON tax_rules FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM users u
    JOIN user_roles ur ON ur.user_id = u.user_id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.permission_id = rp.permission_id
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = tax_rules.tenant_id
      AND p.code = 'SETTINGS.TAXES.MANAGE'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u
    JOIN user_roles ur ON ur.user_id = u.user_id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.permission_id = rp.permission_id
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = tax_rules.tenant_id
      AND p.code = 'SETTINGS.TAXES.MANAGE'
  )
);

-- También asegurar que taxes tiene RLS
ALTER TABLE taxes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view taxes of their tenant" ON taxes;
DROP POLICY IF EXISTS "Users can manage taxes of their tenant" ON taxes;

CREATE POLICY "Users can view taxes of their tenant"
ON taxes FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = taxes.tenant_id
  )
);

CREATE POLICY "Users can manage taxes of their tenant"
ON taxes FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM users u
    JOIN user_roles ur ON ur.user_id = u.user_id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.permission_id = rp.permission_id
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = taxes.tenant_id
      AND p.code = 'SETTINGS.TAXES.MANAGE'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users u
    JOIN user_roles ur ON ur.user_id = u.user_id
    JOIN role_permissions rp ON rp.role_id = ur.role_id
    JOIN permissions p ON p.permission_id = rp.permission_id
    WHERE u.auth_user_id = auth.uid()
      AND u.tenant_id = taxes.tenant_id
      AND p.code = 'SETTINGS.TAXES.MANAGE'
  )
);

-- =========================
-- MENSAJE FINAL
-- =========================
DO $$
BEGIN
  RAISE NOTICE '✅ Políticas RLS configuradas para taxes y tax_rules';
  RAISE NOTICE '📝 Usuarios pueden ver impuestos de su tenant';
  RAISE NOTICE '📝 Solo usuarios con permiso SETTINGS.TAXES.MANAGE pueden gestionar';
END $$;
