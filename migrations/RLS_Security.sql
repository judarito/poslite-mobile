-- ===========================================
-- Funciones helper para evitar recursión en RLS
-- ===========================================

-- Función para obtener el tenant_id del usuario actual sin activar RLS
CREATE OR REPLACE FUNCTION get_current_user_tenant_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT tenant_id FROM users WHERE auth_user_id = auth.uid() LIMIT 1;
$$;

-- Función para verificar si el usuario tiene un permiso específico
CREATE OR REPLACE FUNCTION has_permission(permission_code text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users u
    INNER JOIN user_roles ur ON ur.user_id = u.user_id
    INNER JOIN role_permissions rp ON rp.role_id = ur.role_id
    INNER JOIN permissions p ON p.permission_id = rp.permission_id
    WHERE u.auth_user_id = auth.uid()
    AND p.code = permission_code
  );
$$;

-- ===========================================
-- Políticas RLS para tabla users
-- ===========================================

-- Habilitar RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas existentes
DROP POLICY IF EXISTS "users_select_policy" ON users;
DROP POLICY IF EXISTS "users_insert_policy" ON users;
DROP POLICY IF EXISTS "users_update_policy" ON users;

-- Política SELECT: Los usuarios solo ven usuarios de su tenant
CREATE POLICY "users_select_policy" ON users
FOR SELECT
USING (tenant_id = get_current_user_tenant_id());

-- Política INSERT: Solo usuarios con permiso SECURITY.USERS.MANAGE pueden crear usuarios
CREATE POLICY "users_insert_policy" ON users
FOR INSERT
WITH CHECK (
  has_permission('SECURITY.USERS.MANAGE')
  AND tenant_id = get_current_user_tenant_id()
);

-- Política UPDATE: Solo usuarios con permiso pueden actualizar usuarios de su tenant
CREATE POLICY "users_update_policy" ON users
FOR UPDATE
USING (
  has_permission('SECURITY.USERS.MANAGE')
  AND tenant_id = get_current_user_tenant_id()
);

-- Política DELETE: No permitir DELETE directo (solo desactivar vía UPDATE)
-- No se crea política DELETE, por defecto está denegado

-- ===========================================
-- Políticas RLS para tabla user_roles
-- ===========================================

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas existentes
DROP POLICY IF EXISTS "user_roles_select_policy" ON user_roles;
DROP POLICY IF EXISTS "user_roles_insert_policy" ON user_roles;
DROP POLICY IF EXISTS "user_roles_delete_policy" ON user_roles;

-- Política SELECT: Ver roles de usuarios del mismo tenant
CREATE POLICY "user_roles_select_policy" ON user_roles
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM users u
    WHERE u.user_id = user_roles.user_id
    AND u.tenant_id = get_current_user_tenant_id()
  )
);

-- Política INSERT: Solo admins pueden asignar roles
CREATE POLICY "user_roles_insert_policy" ON user_roles
FOR INSERT
WITH CHECK (has_permission('SECURITY.USERS.MANAGE'));

-- Política DELETE: Solo admins pueden remover roles
CREATE POLICY "user_roles_delete_policy" ON user_roles
FOR DELETE
USING (has_permission('SECURITY.USERS.MANAGE'));

-- ===========================================
-- Políticas RLS para tabla roles
-- ===========================================

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas existentes
DROP POLICY IF EXISTS "roles_select_policy" ON roles;
DROP POLICY IF EXISTS "roles_insert_policy" ON roles;
DROP POLICY IF EXISTS "roles_update_policy" ON roles;
DROP POLICY IF EXISTS "roles_delete_policy" ON roles;

-- Política SELECT: Ver roles del tenant
CREATE POLICY "roles_select_policy" ON roles
FOR SELECT
USING (tenant_id = get_current_user_tenant_id());

-- Política INSERT: Solo admins pueden crear roles
CREATE POLICY "roles_insert_policy" ON roles
FOR INSERT
WITH CHECK (
  has_permission('SECURITY.ROLES.MANAGE')
  AND tenant_id = get_current_user_tenant_id()
);

-- Política UPDATE: Solo admins pueden actualizar roles
CREATE POLICY "roles_update_policy" ON roles
FOR UPDATE
USING (
  has_permission('SECURITY.ROLES.MANAGE')
  AND tenant_id = get_current_user_tenant_id()
);

-- Política DELETE: Solo admins pueden eliminar roles
CREATE POLICY "roles_delete_policy" ON roles
FOR DELETE
USING (
  has_permission('SECURITY.ROLES.MANAGE')
  AND tenant_id = get_current_user_tenant_id()
);

-- ===========================================
-- Políticas para permissions (solo lectura)
-- ===========================================

ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas existentes
DROP POLICY IF EXISTS "permissions_select_policy" ON permissions;

-- Todos los usuarios autenticados pueden ver los permisos
CREATE POLICY "permissions_select_policy" ON permissions
FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Solo superadmin puede modificar permisos (gestionar desde SQL)
-- No se crean políticas INSERT/UPDATE/DELETE

-- ===========================================
-- Políticas para role_permissions
-- ===========================================

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas existentes
DROP POLICY IF EXISTS "role_permissions_select_policy" ON role_permissions;
DROP POLICY IF EXISTS "role_permissions_insert_policy" ON role_permissions;
DROP POLICY IF EXISTS "role_permissions_delete_policy" ON role_permissions;

-- Política SELECT: Ver permisos de roles del tenant
CREATE POLICY "role_permissions_select_policy" ON role_permissions
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM roles r
    WHERE r.role_id = role_permissions.role_id
    AND r.tenant_id = get_current_user_tenant_id()
  )
);

-- Política INSERT: Solo admins pueden asignar permisos a roles
CREATE POLICY "role_permissions_insert_policy" ON role_permissions
FOR INSERT
WITH CHECK (has_permission('SECURITY.ROLES.MANAGE'));

-- Política DELETE: Solo admins pueden remover permisos de roles
CREATE POLICY "role_permissions_delete_policy" ON role_permissions
FOR DELETE
USING (has_permission('SECURITY.ROLES.MANAGE'));

-- ===========================================
-- Políticas para cash_registers
-- ===========================================

ALTER TABLE cash_registers ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas existentes
DROP POLICY IF EXISTS "cash_registers_select_policy" ON cash_registers;
DROP POLICY IF EXISTS "cash_registers_insert_policy" ON cash_registers;
DROP POLICY IF EXISTS "cash_registers_update_policy" ON cash_registers;
DROP POLICY IF EXISTS "cash_registers_delete_policy" ON cash_registers;

-- Política SELECT: Ver cajas registradoras del tenant
CREATE POLICY "cash_registers_select_policy" ON cash_registers
FOR SELECT
USING (tenant_id = get_current_user_tenant_id());

-- Política INSERT: Solo usuarios con permiso pueden crear cajas
CREATE POLICY "cash_registers_insert_policy" ON cash_registers
FOR INSERT
WITH CHECK (
  has_permission('CASH.REGISTER.MANAGE')
  AND tenant_id = get_current_user_tenant_id()
);

-- Política UPDATE: Solo usuarios con permiso pueden actualizar cajas
CREATE POLICY "cash_registers_update_policy" ON cash_registers
FOR UPDATE
USING (
  has_permission('CASH.REGISTER.MANAGE')
  AND tenant_id = get_current_user_tenant_id()
);

-- Política DELETE: Solo usuarios con permiso pueden eliminar cajas
CREATE POLICY "cash_registers_delete_policy" ON cash_registers
FOR DELETE
USING (
  has_permission('CASH.REGISTER.MANAGE')
  AND tenant_id = get_current_user_tenant_id()
);

-- ===========================================
-- Políticas para payment_methods
-- ===========================================

ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas existentes
DROP POLICY IF EXISTS "payment_methods_select_policy" ON payment_methods;
DROP POLICY IF EXISTS "payment_methods_insert_policy" ON payment_methods;
DROP POLICY IF EXISTS "payment_methods_update_policy" ON payment_methods;
DROP POLICY IF EXISTS "payment_methods_delete_policy" ON payment_methods;

-- Política SELECT: Ver métodos de pago del tenant
CREATE POLICY "payment_methods_select_policy" ON payment_methods
FOR SELECT
USING (tenant_id = get_current_user_tenant_id());

-- Política INSERT: Solo usuarios con permiso pueden crear métodos de pago
CREATE POLICY "payment_methods_insert_policy" ON payment_methods
FOR INSERT
WITH CHECK (
  has_permission('SETTINGS.PAYMENT_METHODS.MANAGE')
  AND tenant_id = get_current_user_tenant_id()
);

-- Política UPDATE: Solo usuarios con permiso pueden actualizar métodos de pago
CREATE POLICY "payment_methods_update_policy" ON payment_methods
FOR UPDATE
USING (
  has_permission('SETTINGS.PAYMENT_METHODS.MANAGE')
  AND tenant_id = get_current_user_tenant_id()
);

-- Política DELETE: Solo usuarios con permiso pueden eliminar métodos de pago
CREATE POLICY "payment_methods_delete_policy" ON payment_methods
FOR DELETE
USING (
  has_permission('SETTINGS.PAYMENT_METHODS.MANAGE')
  AND tenant_id = get_current_user_tenant_id()
);