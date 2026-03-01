-- ===================================================================
-- Migración: Stored Procedure para Crear Nuevo Tenant
-- Fecha: 2026-02-13
-- Descripción: SP que crea un nuevo tenant completo con toda su
--              estructura base copiando configuraciones de un tenant existente
-- ===================================================================

-- ===================================================================
-- FUNCIÓN: fn_create_tenant
-- Descripción: Crea un tenant completo con estructura base
-- Parámetros:
--   p_tenant_data: JSON con datos del tenant
--   p_admin_data: JSON con datos del usuario administrador
--   p_copy_from_tenant_id: UUID del tenant origen para copiar configs (opcional)
-- Retorna: JSON con { success, tenant_id, user_id, message }
-- ===================================================================
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
  v_role_id uuid;
  v_config_json jsonb;
  v_copy_from_tenant_id uuid;
  v_pm record;
  v_role record;
  v_perm record;
  v_pricing_rule record;
  v_tax_rule record;
begin
  -- Validar datos requeridos del tenant
  if p_tenant_data->>'name' is null then
    return jsonb_build_object(
      'success', false,
      'message', 'El nombre del tenant es requerido'
    );
  end if;
  
  -- Validar datos requeridos del admin
  if p_admin_data->>'email' is null or p_admin_data->>'full_name' is null then
    return jsonb_build_object(
      'success', false,
      'message', 'Email y nombre del administrador son requeridos'
    );
  end if;

  -- Determinar tenant origen (si no se proporciona, buscar uno por defecto)
  if p_copy_from_tenant_id is null then
    -- Buscar el primer tenant activo como template
    select tenant_id into v_copy_from_tenant_id
    from tenants
    where is_active = true
    order by created_at asc
    limit 1;
  else
    v_copy_from_tenant_id := p_copy_from_tenant_id;
  end if;

  -- ============================================================
  -- 1. CREAR TENANT
  -- ============================================================
  insert into tenants (
    name,
    legal_name,
    tax_id,
    email,
    phone,
    address,
    is_active
  ) values (
    p_tenant_data->>'name',
    coalesce(p_tenant_data->>'legal_name', p_tenant_data->>'name'),
    p_tenant_data->>'tax_id',
    p_tenant_data->>'email',
    p_tenant_data->>'phone',
    p_tenant_data->>'address',
    coalesce((p_tenant_data->>'is_active')::boolean, true)
  )
  returning tenant_id into v_tenant_id;

  -- ============================================================
  -- 2. CREAR CONFIGURACIONES DEL TENANT
  -- ============================================================
  if v_copy_from_tenant_id is not null then
    -- Copiar configuraciones del tenant origen
    insert into tenant_settings (
      tenant_id,
      default_page_size,
      default_theme,
      default_currency,
      default_locale,
      date_format,
      invoice_prefix,
      invoice_start_number,
      max_discount_without_auth,
      rounding_method,
      rounding_multiple,
      ai_forecast_days_back,
      ai_purchase_suggestion_days,
      low_stock_threshold,
      reserve_stock_on_layaway,
      layaway_expiration_warning_days,
      session_timeout_minutes,
      email_on_sale,
      email_on_low_stock,
      email_on_layaway_expiration
    )
    select
      v_tenant_id,
      ts.default_page_size,
      ts.default_theme,
      ts.default_currency,
      ts.default_locale,
      ts.date_format,
      p_tenant_data->>'invoice_prefix' || '-', -- Nuevo prefijo
      coalesce((p_tenant_data->>'invoice_start_number')::integer, 1),
      ts.max_discount_without_auth,
      ts.rounding_method,
      ts.rounding_multiple,
      ts.ai_forecast_days_back,
      ts.ai_purchase_suggestion_days,
      ts.low_stock_threshold,
      ts.reserve_stock_on_layaway,
      ts.layaway_expiration_warning_days,
      ts.session_timeout_minutes,
      ts.email_on_sale,
      ts.email_on_low_stock,
      ts.email_on_layaway_expiration
    from tenant_settings ts
    where ts.tenant_id = v_copy_from_tenant_id;
  else
    -- Crear configuraciones por defecto
    insert into tenant_settings (
      tenant_id,
      default_page_size,
      default_theme,
      default_currency,
      default_locale,
      invoice_prefix,
      invoice_start_number,
      max_discount_without_auth,
      rounding_method,
      rounding_multiple
    ) values (
      v_tenant_id,
      10,
      'light',
      'COP',
      'es-CO',
      coalesce(p_tenant_data->>'invoice_prefix', 'FAC') || '-',
      coalesce((p_tenant_data->>'invoice_start_number')::integer, 1),
      15.0,
      'normal',
      1
    );
  end if;

  -- ============================================================
  -- 3. CREAR SEDE PRINCIPAL
  -- ============================================================
  insert into locations (
    tenant_id,
    name,
    code,
    address,
    phone,
    is_active
  ) values (
    v_tenant_id,
    'PRINCIPAL',
    'PRIN-001',
    coalesce(p_tenant_data->>'address', 'Dirección por definir'),
    p_tenant_data->>'phone',
    true
  )
  returning location_id into v_location_id;

  -- ============================================================
  -- 4. CREAR CAJA PRINCIPAL
  -- ============================================================
  insert into registers (
    tenant_id,
    location_id,
    name,
    code,
    is_active
  ) values (
    v_tenant_id,
    v_location_id,
    'CAJA PRINCIPAL',
    'REG-001',
    true
  )
  returning register_id into v_register_id;

  -- ============================================================
  -- 5. COPIAR MÉTODOS DE PAGO
  -- ============================================================
  if v_copy_from_tenant_id is not null then
    for v_pm in 
      select name, code, is_active
      from payment_methods
      where tenant_id = v_copy_from_tenant_id
    loop
      insert into payment_methods (tenant_id, name, code, is_active)
      values (v_tenant_id, v_pm.name, v_pm.code, v_pm.is_active);
    end loop;
  else
    -- Crear métodos de pago por defecto
    insert into payment_methods (tenant_id, name, code, is_active) values
      (v_tenant_id, 'Efectivo', 'CASH', true),
      (v_tenant_id, 'Tarjeta Débito', 'DEBIT', true),
      (v_tenant_id, 'Tarjeta Crédito', 'CREDIT', true),
      (v_tenant_id, 'Transferencia', 'TRANSFER', true);
  end if;

  -- ============================================================
  -- 6. COPIAR ROLES Y PERMISOS
  -- ============================================================
  if v_copy_from_tenant_id is not null then
    for v_role in
      select name, description, is_system_role
      from roles
      where tenant_id = v_copy_from_tenant_id
    loop
      -- Crear el rol
      insert into roles (tenant_id, name, description, is_system_role)
      values (v_tenant_id, v_role.name, v_role.description, v_role.is_system_role)
      returning role_id into v_role_id;

      -- Copiar permisos del rol
      insert into role_permissions (role_id, permission_name, can_create, can_read, can_update, can_delete)
      select 
        v_role_id,
        rp.permission_name,
        rp.can_create,
        rp.can_read,
        rp.can_update,
        rp.can_delete
      from role_permissions rp
      join roles r on r.role_id = rp.role_id
      where r.tenant_id = v_copy_from_tenant_id
        and r.name = v_role.name;
    end loop;
  else
    -- Crear roles por defecto
    -- ROL: ADMINISTRATOR
    insert into roles (tenant_id, name, description, is_system_role)
    values (v_tenant_id, 'ADMINISTRATOR', 'Administrador con acceso completo', true)
    returning role_id into v_role_id;
    
    insert into role_permissions (role_id, permission_name, can_create, can_read, can_update, can_delete)
    values
      (v_role_id, 'users', true, true, true, true),
      (v_role_id, 'roles', true, true, true, true),
      (v_role_id, 'products', true, true, true, true),
      (v_role_id, 'inventory', true, true, true, true),
      (v_role_id, 'sales', true, true, true, true),
      (v_role_id, 'purchases', true, true, true, true),
      (v_role_id, 'reports', true, true, true, true),
      (v_role_id, 'customers', true, true, true, true),
      (v_role_id, 'categories', true, true, true, true),
      (v_role_id, 'locations', true, true, true, true),
      (v_role_id, 'registers', true, true, true, true),
      (v_role_id, 'payment_methods', true, true, true, true),
      (v_role_id, 'pricing_rules', true, true, true, true),
      (v_role_id, 'tax_rules', true, true, true, true),
      (v_role_id, 'layaway', true, true, true, true),
      (v_role_id, 'settings', true, true, true, true);
  end if;

  -- ============================================================
  -- 7. COPIAR REGLAS DE PRECIOS (si existen)
  -- ============================================================
  if v_copy_from_tenant_id is not null then
    for v_pricing_rule in
      select name, rule_type, value_type, value, min_quantity, priority, is_active
      from pricing_rules
      where tenant_id = v_copy_from_tenant_id
    loop
      insert into pricing_rules (
        tenant_id, name, rule_type, value_type, value, 
        min_quantity, priority, is_active
      )
      values (
        v_tenant_id, v_pricing_rule.name, v_pricing_rule.rule_type,
        v_pricing_rule.value_type, v_pricing_rule.value,
        v_pricing_rule.min_quantity, v_pricing_rule.priority, v_pricing_rule.is_active
      );
    end loop;
  end if;

  -- ============================================================
  -- 8. COPIAR REGLAS DE IMPUESTOS
  -- ============================================================
  if v_copy_from_tenant_id is not null then
    for v_tax_rule in
      select name, tax_rate, is_default, is_active
      from tax_rules
      where tenant_id = v_copy_from_tenant_id
    loop
      insert into tax_rules (tenant_id, name, tax_rate, is_default, is_active)
      values (v_tenant_id, v_tax_rule.name, v_tax_rule.tax_rate, v_tax_rule.is_default, v_tax_rule.is_active);
    end loop;
  else
    -- Crear impuesto IVA por defecto (19% Colombia)
    insert into tax_rules (tenant_id, name, tax_rate, is_default, is_active)
    values (v_tenant_id, 'IVA 19%', 19.0, true, true);
  end if;

  -- ============================================================
  -- 9. CREAR USUARIO ADMINISTRADOR
  -- ============================================================
  -- Nota: El password debe ser hasheado por Supabase Auth
  -- Este insert asume que el user_id ya fue creado en auth.users
  insert into users (
    user_id,
    tenant_id,
    email,
    full_name,
    role,
    is_active
  ) values (
    coalesce((p_admin_data->>'user_id')::uuid, gen_random_uuid()),
    v_tenant_id,
    p_admin_data->>'email',
    p_admin_data->>'full_name',
    'ADMINISTRATOR',
    true
  )
  returning user_id into v_user_id;

  -- Asignar rol ADMINISTRATOR al usuario
  select role_id into v_role_id
  from roles
  where tenant_id = v_tenant_id and name = 'ADMINISTRATOR';

  if v_role_id is not null then
    insert into user_roles (user_id, role_id)
    values (v_user_id, v_role_id);
  end if;

  -- ============================================================
  -- 10. RETORNAR RESULTADO
  -- ============================================================
  return jsonb_build_object(
    'success', true,
    'tenant_id', v_tenant_id,
    'user_id', v_user_id,
    'location_id', v_location_id,
    'register_id', v_register_id,
    'message', 'Tenant creado exitosamente con estructura completa'
  );

exception
  when others then
    return jsonb_build_object(
      'success', false,
      'message', 'Error creando tenant: ' || sqlerrm
    );
end;
$$;

-- ===================================================================
-- FUNCIÓN AUXILIAR: fn_get_tenant_template_json
-- Descripción: Genera JSON con configuraciones de un tenant para usar como template
-- ===================================================================
create or replace function fn_get_tenant_template_json(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_template jsonb;
begin
  select jsonb_build_object(
    'tenant_settings', (
      select row_to_json(ts.*)
      from tenant_settings ts
      where ts.tenant_id = p_tenant_id
    ),
    'payment_methods', (
      select jsonb_agg(row_to_json(pm.*))
      from payment_methods pm
      where pm.tenant_id = p_tenant_id
    ),
    'roles', (
      select jsonb_agg(
        jsonb_build_object(
          'role', row_to_json(r.*),
          'permissions', (
            select jsonb_agg(row_to_json(rp.*))
            from role_permissions rp
            where rp.role_id = r.role_id
          )
        )
      )
      from roles r
      where r.tenant_id = p_tenant_id
    ),
    'pricing_rules', (
      select jsonb_agg(row_to_json(pr.*))
      from pricing_rules pr
      where pr.tenant_id = p_tenant_id
    ),
    'tax_rules', (
      select jsonb_agg(row_to_json(tr.*))
      from tax_rules tr
      where tr.tenant_id = p_tenant_id
    )
  ) into v_template;

  return v_template;
end;
$$;

-- ===================================================================
-- COMENTARIOS Y DOCUMENTACIÓN
-- ===================================================================
comment on function fn_create_tenant is 'Crea un tenant completo con estructura base copiando configuraciones de un tenant existente';
comment on function fn_get_tenant_template_json is 'Genera JSON con todas las configuraciones de un tenant para usar como template';

-- ===================================================================
-- EJEMPLO DE USO
-- ===================================================================
/*
-- 1. Obtener template de configuración de tenant existente
select fn_get_tenant_template_json('uuid-del-tenant-actual');

-- 2. Crear nuevo tenant con datos mínimos
select fn_create_tenant(
  '{"name": "Mi Nueva Empresa", "tax_id": "900123456-7", "email": "contacto@nuevaempresa.com", "phone": "3001234567", "address": "Calle 123 #45-67", "invoice_prefix": "FAC"}',
  '{"email": "admin@nuevaempresa.com", "full_name": "Administrador Principal"}',
  'uuid-del-tenant-origen'
);

-- 3. Crear tenant sin origen (usa configuraciones por defecto)
select fn_create_tenant(
  '{"name": "Empresa Nueva", "tax_id": "900111222-3", "email": "info@empresa.com"}',
  '{"email": "admin@empresa.com", "full_name": "Juan Pérez"}',
  null
);
*/

-- Mensaje de confirmación
DO $$
BEGIN
  RAISE NOTICE '✅ Stored Procedure fn_create_tenant creado exitosamente';
  RAISE NOTICE '📋 Función fn_get_tenant_template_json creada';
  RAISE NOTICE '📖 Ver comentarios en el archivo para ejemplos de uso';
END $$;
