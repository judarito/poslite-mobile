-- ===================================================================
-- Migración: Seguridad para Gestión de Tenants
-- Fecha: 2026-02-13
-- Descripción: Protege el SP fn_create_tenant para que solo Super Admins
--              puedan crear tenants
-- ===================================================================

-- Crear función para validar Super Admin
create or replace function fn_is_super_admin()
returns boolean
language plpgsql
security definer
as $$
declare
  v_user_id uuid;
  v_has_profile boolean := false;
begin
  -- Obtener el user_id del usuario autenticado
  v_user_id := (select auth.uid());
  
  -- Si no hay usuario autenticado, no es super admin
  if v_user_id is null then
    return false;
  end if;
  
  -- Verificar si tiene perfil en tabla users
  select exists(
    select 1 from users 
    where user_id = v_user_id
  ) into v_has_profile;
  
  -- Super Admin = Usuario autenticado SIN perfil en tabla users
  return not v_has_profile;
end;
$$;

-- Modificar fn_create_tenant para incluir validación de seguridad
create or replace function fn_create_tenant(
  p_tenant_data jsonb,
  p_admin_data jsonb,
  p_copy_from_tenant_id uuid default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_tenant_id uuid;
  v_user_id uuid;
  v_location_id uuid;
  v_register_id uuid;
  v_admin_role_id uuid;
  v_cashier_role_id uuid;
  v_result jsonb;
begin
  -- 🔐 VALIDACIÓN DE SEGURIDAD: Solo Super Admins pueden crear tenants
  if not fn_is_super_admin() then
    return jsonb_build_object(
      'success', false,
      'error', 'UNAUTHORIZED',
      'message', 'Solo Super Administradores pueden crear tenants'
    );
  end if;
  
  -- Log de seguridad
  raise notice '🔐 Super Admin creando tenant: % (Usuario: %)', 
    p_tenant_data->>'name', 
    (select auth.email());

  -- Generar IDs
  v_tenant_id := gen_random_uuid();
  v_user_id := gen_random_uuid();
  v_location_id := gen_random_uuid();
  v_register_id := gen_random_uuid();

  -- Crear tenant
  insert into tenants (tenant_id, name, legal_name, tax_id, email, phone, address, is_active)
  values (
    v_tenant_id,
    p_tenant_data->>'name',
    p_tenant_data->>'legal_name',
    p_tenant_data->>'tax_id',
    p_tenant_data->>'email',
    p_tenant_data->>'phone',
    p_tenant_data->>'address',
    true
  );

  -- Crear configuración del tenant
  if p_copy_from_tenant_id is not null then
    -- Copiar configuraciones del tenant origen
    insert into tenant_settings (
      tenant_id,
      invoice_prefix,
      invoice_start_number,
      rounding_method
    )
    select
      v_tenant_id,
      coalesce(p_tenant_data->>'invoice_prefix', 'FAC') || '-',
      coalesce((p_tenant_data->>'invoice_start_number')::int, 1),
      coalesce(ts.rounding_method, 'normal')
    from tenant_settings ts
    where ts.tenant_id = p_copy_from_tenant_id;
  else
    -- Crear configuraciones por defecto
    insert into tenant_settings (
      tenant_id, 
      invoice_prefix, 
      invoice_start_number,
      rounding_method
    )
    values (
      v_tenant_id,
      coalesce(p_tenant_data->>'invoice_prefix', 'FAC') || '-',
      coalesce((p_tenant_data->>'invoice_start_number')::int, 1),
      'normal'
    );
  end if;

  -- Crear sede principal
  insert into locations (location_id, tenant_id, name, is_active)
  values (v_location_id, v_tenant_id, 'PRINCIPAL', true);

  -- Crear caja principal
  insert into cash_registers (cash_register_id, tenant_id, location_id, name, is_active)
  values (v_register_id, v_tenant_id, v_location_id, 'CAJA PRINCIPAL', true);

  -- Métodos de pago por defecto
  if p_copy_from_tenant_id is not null then
    -- Copiar métodos de pago existentes
    insert into payment_methods (tenant_id, payment_method_id, code, name, is_active)
    select v_tenant_id, gen_random_uuid(), code, name, is_active
    from payment_methods 
    where tenant_id = p_copy_from_tenant_id;
  else
    -- Métodos por defecto
    insert into payment_methods (tenant_id, payment_method_id, code, name, is_active)
    values 
      (v_tenant_id, gen_random_uuid(), 'CASH', 'Efectivo', true),
      (v_tenant_id, gen_random_uuid(), 'CARD', 'Tarjeta', true);
  end if;

  -- Crear roles por defecto
  v_admin_role_id := gen_random_uuid();
  v_cashier_role_id := gen_random_uuid();
  
  insert into roles (role_id, tenant_id, name)
  values 
    (v_admin_role_id, v_tenant_id, 'ADMINISTRADOR'),
    (v_cashier_role_id, v_tenant_id, 'CAJERO');

  -- Permisos para rol ADMINISTRADOR (todos)
  insert into role_permissions (role_id, permission_id)
  select v_admin_role_id, permission_id
  from permissions
  where code = any(array[
    'SALES.CREATE', 'SALES.UPDATE', 'SALES.DELETE', 'SALES.VIEW',
    'INVENTORY.VIEW', 'INVENTORY.UPDATE', 'INVENTORY.ADJUST',
    'PRODUCTS.CREATE', 'PRODUCTS.UPDATE', 'PRODUCTS.DELETE', 'PRODUCTS.VIEW',
    'CUSTOMERS.CREATE', 'CUSTOMERS.UPDATE', 'CUSTOMERS.DELETE', 'CUSTOMERS.VIEW',
    'CASH.SESSION.OPEN', 'CASH.SESSION.CLOSE', 'CASH.SESSION.VIEW',
    'CASH.REGISTER.MANAGE', 'CASH.ASSIGN',
    'REPORTS.SALES.VIEW', 'REPORTS.INVENTORY.VIEW', 'REPORTS.CASH.VIEW',
    'SETTINGS.TENANT.MANAGE', 'SETTINGS.LOCATIONS.MANAGE', 
    'SETTINGS.PAYMENT_METHODS.MANAGE', 'SETTINGS.TAXES.MANAGE',
    'SECURITY.USERS.MANAGE', 'SECURITY.ROLES.MANAGE'
  ]);

  -- Permisos para rol CAJERO (básicos)
  insert into role_permissions (role_id, permission_id)
  select v_cashier_role_id, permission_id
  from permissions
  where code = any(array[
    'SALES.CREATE', 'SALES.VIEW',
    'INVENTORY.VIEW',
    'PRODUCTS.VIEW',
    'CUSTOMERS.CREATE', 'CUSTOMERS.VIEW',
    'CASH.SESSION.OPEN', 'CASH.SESSION.CLOSE', 'CASH.SESSION.VIEW'
  ]);

  -- Reglas de impuestos por defecto
  if p_copy_from_tenant_id is not null then
    -- Copiar impuestos existentes
    insert into taxes (tax_id, tenant_id, code, name, rate, is_active)
    select gen_random_uuid(), v_tenant_id, code, name, rate, is_active
    from taxes 
    where tenant_id = p_copy_from_tenant_id;
    
    -- Copiar reglas de impuestos existentes
    insert into tax_rules (tax_rule_id, tenant_id, tax_id, scope, category_id, product_id, variant_id, priority, is_active)
    select gen_random_uuid(), v_tenant_id, 
           (select t2.tax_id from taxes t2 where t2.tenant_id = v_tenant_id and t2.code = t1.code limit 1),
           tr.scope, tr.category_id, tr.product_id, tr.variant_id, tr.priority, tr.is_active
    from tax_rules tr
    join taxes t1 on t1.tax_id = tr.tax_id
    where tr.tenant_id = p_copy_from_tenant_id;
  else
    -- Impuesto por defecto (IVA 19%)
    insert into taxes (tax_id, tenant_id, code, name, rate, is_active)
    values (gen_random_uuid(), v_tenant_id, 'IVA', 'IVA', 19.00, true);
  end if;

  -- Crear usuario administrador
  -- NOTA: El auth_user_id debe ser creado en Supabase Auth usando:
  -- supabase.auth.admin.createUser({ email, password, email_confirm: true })
  -- Por ahora se genera un UUID temporal que debe ser reemplazado
  insert into users (user_id, auth_user_id, tenant_id, full_name, email, is_active)
  values (
    v_user_id,
    gen_random_uuid(), -- UUID temporal - debe ser reemplazado por el auth_user_id real de Supabase
    v_tenant_id,
    p_admin_data->>'full_name',
    p_admin_data->>'email',
    true
  );

  -- Asignar rol ADMINISTRADOR al usuario
  insert into user_roles (user_id, role_id)
  values (v_user_id, v_admin_role_id);

  -- Resultado exitoso
  v_result := jsonb_build_object(
    'success', true,
    'message', 'Tenant creado exitosamente',
    'tenant_id', v_tenant_id,
    'user_id', v_user_id,
    'location_id', v_location_id,
    'cash_register_id', v_register_id,
    'name', p_tenant_data->>'name',
    'superadmin_email', (select auth.email())
  );

  raise notice '✅ Tenant creado: % (ID: %)', p_tenant_data->>'name', v_tenant_id;
  return v_result;

exception
  when others then
    raise exception 'Error creando tenant: %', sqlerrm;
end;
$$;

-- Mensaje de confirmación
DO $$
BEGIN
  RAISE NOTICE '🔐 Seguridad implementada para gestión de tenants';
  RAISE NOTICE '✅ Solo Super Admins pueden ejecutar fn_create_tenant';
  RAISE NOTICE '📝 Función fn_is_super_admin creada';
  RAISE NOTICE '🛡️ Validación agregada a fn_create_tenant';
END $$;