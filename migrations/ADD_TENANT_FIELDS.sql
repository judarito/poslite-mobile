-- ===================================================================
-- Migración: Agregar campos adicionales para gestión de tenants
-- Fecha: 2026-02-13  
-- Descripción: Asegura que todas las tablas tengan los campos necesarios
--              para el sistema completo de gestión de tenants
-- ===================================================================

-- =====================================================
-- TABLA TENANTS: Agregar campos de información completa
-- =====================================================
alter table tenants add column if not exists legal_name text;
alter table tenants add column if not exists email text;
alter table tenants add column if not exists phone text;
alter table tenants add column if not exists address text;

-- =====================================================
-- TABLA USERS: Agregar role_id para asignación de roles
-- =====================================================
alter table users add column if not exists role_id uuid references roles(role_id);

-- =====================================================
-- TABLA TENANT_SETTINGS: Asegurar campos de facturación
-- =====================================================
alter table tenant_settings add column if not exists invoice_prefix text default 'FAC';
alter table tenant_settings add column if not exists invoice_start_number integer default 1;

-- =====================================================
-- COMENTARIOS Y DOCUMENTACIÓN
-- =====================================================
comment on column tenants.legal_name is 'Razón social o nombre legal del tenant';
comment on column tenants.email is 'Email de contacto del tenant';
comment on column tenants.phone is 'Teléfono de contacto del tenant';
comment on column tenants.address is 'Dirección física del tenant';
comment on column users.role_id is 'Rol asignado al usuario en su tenant';
comment on column tenant_settings.invoice_prefix is 'Prefijo para numeración de facturas';
comment on column tenant_settings.invoice_start_number is 'Número inicial para secuencia de facturas';

-- =====================================================
-- ÍNDICES PARA OPTIMIZAR CONSULTAS
-- =====================================================
create index if not exists ix_tenants_email on tenants(email) where email is not null;
create index if not exists ix_tenants_legal_name on tenants(legal_name) where legal_name is not null;
create index if not exists ix_users_role_id on users(role_id) where role_id is not null;

-- =====================================================
-- VERIFICACIÓN COMPLETA DE MIGRACIÓN
-- =====================================================
DO $$
DECLARE
  tenants_col_count integer;
  users_col_count integer;
  settings_col_count integer;
BEGIN
  -- Verificar columnas en tenants
  SELECT count(*) INTO tenants_col_count 
  FROM information_schema.columns 
  WHERE table_name = 'tenants' 
    AND column_name IN ('legal_name', 'email', 'phone', 'address');
  
  -- Verificar columnas en users  
  SELECT count(*) INTO users_col_count
  FROM information_schema.columns 
  WHERE table_name = 'users' 
    AND column_name = 'role_id';
    
  -- Verificar columnas en tenant_settings
  SELECT count(*) INTO settings_col_count
  FROM information_schema.columns 
  WHERE table_name = 'tenant_settings' 
    AND column_name IN ('invoice_prefix', 'invoice_start_number');
  
  -- Reportar resultados detallados
  RAISE NOTICE '====================================================';
  RAISE NOTICE '🔍 VERIFICACIÓN DE ESTRUCTURA DE BASE DE DATOS';
  RAISE NOTICE '====================================================';
  
  IF tenants_col_count = 4 THEN
    RAISE NOTICE '✅ TENANTS: % columnas OK (legal_name, email, phone, address)', tenants_col_count;
  ELSE
    RAISE WARNING '⚠️ TENANTS: Solo % de 4 columnas encontradas', tenants_col_count;
  END IF;
  
  IF users_col_count = 1 THEN  
    RAISE NOTICE '✅ USERS: role_id columna agregada exitosamente';
  ELSE
    RAISE WARNING '⚠️ USERS: Columna role_id faltante';
  END IF;
  
  IF settings_col_count = 2 THEN
    RAISE NOTICE '✅ TENANT_SETTINGS: % columnas OK (invoice_prefix, invoice_start_number)', settings_col_count;
  ELSE
    RAISE WARNING '⚠️ TENANT_SETTINGS: Solo % de 2 columnas de facturación', settings_col_count;
  END IF;
  
  IF tenants_col_count = 4 AND users_col_count = 1 AND settings_col_count = 2 THEN
    RAISE NOTICE '🚀 MIGRACIÓN EXITOSA: Sistema listo para crear tenants';
    RAISE NOTICE '💡 Puedes ejecutar fn_create_tenant() sin errores';
  ELSE
    RAISE WARNING '🔧 ESTRUCTURA INCOMPLETA: Revisar columnas faltantes arriba';
  END IF;
  
  RAISE NOTICE '====================================================';
END $$;