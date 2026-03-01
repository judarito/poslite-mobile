-- ===================================================================
-- Migración: Actualizar fn_create_tenant con Defaults
-- Fecha: 2026-02-20
-- Descripción: Modifica la función de creación de tenant para que:
--   1. NO copie de otro tenant (elimina template copy)
--   2. Cree SIEMPRE impuestos por defecto (IVA 19%, 5%, 0%)
--   3. Cree métodos de pago estándar
--   4. Simplifique el proceso de onboarding
--
-- NOTA: Las unidades de medida NO se crean por tenant, son globales
--       del sistema (tenant_id = NULL en units_of_measure)
-- ===================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '🔧 ACTUALIZANDO fn_create_tenant CON DEFAULTS';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
END $$;

-- ===================================================================
-- ELIMINAR FUNCIÓN ANTIGUA (con 3 parámetros)
-- ===================================================================
DROP FUNCTION IF EXISTS fn_create_tenant(JSONB, JSONB, UUID);

-- ===================================================================
-- FUNCIÓN ACTUALIZADA: fn_create_tenant (con 2 parámetros)
-- ===================================================================
CREATE OR REPLACE FUNCTION fn_create_tenant(
  p_tenant_data JSONB,
  p_admin_data JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id UUID;
  v_user_id UUID;
  v_location_id UUID;
  v_register_id UUID;
  v_role_id UUID;
BEGIN
  -- ============================================================
  -- VALIDACIONES
  -- ============================================================
  IF p_tenant_data->>'name' IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'El nombre del tenant es requerido'
    );
  END IF;
  
  IF p_admin_data->>'email' IS NULL OR p_admin_data->>'full_name' IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Email y nombre del administrador son requeridos'
    );
  END IF;

  -- ============================================================
  -- 1. CREAR TENANT
  -- ============================================================
  INSERT INTO tenants (
    name,
    legal_name,
    tax_id,
    email,
    phone,
    address,
    currency_code,
    is_active
  ) VALUES (
    p_tenant_data->>'name',
    COALESCE(p_tenant_data->>'legal_name', p_tenant_data->>'name'),
    p_tenant_data->>'tax_id',
    p_tenant_data->>'email',
    p_tenant_data->>'phone',
    p_tenant_data->>'address',
    COALESCE(p_tenant_data->>'currency_code', 'COP'),
    COALESCE((p_tenant_data->>'is_active')::BOOLEAN, TRUE)
  )
  RETURNING tenant_id INTO v_tenant_id;

  RAISE NOTICE '✓ Tenant creado: %', v_tenant_id;

  -- ============================================================
  -- 2. CREAR CONFIGURACIONES DEL TENANT
  -- ============================================================
  INSERT INTO tenant_settings (
    tenant_id,
    business_name,
    business_address,
    business_phone,
    default_page_size,
    theme,
    date_format,
    locale,
    invoice_prefix,
    next_invoice_number,
    max_discount_without_auth,
    rounding_method,
    rounding_multiple,
    ai_forecast_days_back,
    ai_purchase_suggestion_days,
    reserve_stock_on_layaway,
    session_timeout_minutes,
    email_alerts_enabled,
    notify_low_stock,
    notify_expiring_products
  ) VALUES (
    v_tenant_id,
    p_tenant_data->>'name',                                         -- business_name
    COALESCE(p_tenant_data->>'address', 'Por definir'),            -- business_address
    p_tenant_data->>'phone',                                        -- business_phone
    20,                                                              -- page_size
    'light',                                                         -- theme
    'DD/MM/YYYY',                                                    -- date_format
    'es-CO',                                                         -- locale
    COALESCE(p_tenant_data->>'invoice_prefix', 'FAC'),             -- invoice_prefix
    1,                                                               -- next_invoice_number
    15.0,                                                            -- max_discount
    'normal',                                                        -- rounding_method
    1,                                                               -- rounding_multiple
    90,                                                              -- ai_forecast_days
    30,                                                              -- ai_purchase_days
    TRUE,                                                            -- reserve_on_layaway
    60,                                                              -- session_timeout
    FALSE,                                                           -- email_alerts
    TRUE,                                                            -- notify_low_stock
    TRUE                                                             -- notify_expiring
  );

  RAISE NOTICE '✓ Configuraciones creadas';

  -- ============================================================
  -- 3. CREAR SEDE PRINCIPAL
  -- ============================================================
  INSERT INTO locations (
    tenant_id,
    name,
    type,
    address,
    is_active
  ) VALUES (
    v_tenant_id,
    'PRINCIPAL',
    'STORE',
    COALESCE(p_tenant_data->>'address', 'Dirección por definir'),
    TRUE
  )
  RETURNING location_id INTO v_location_id;

  RAISE NOTICE '✓ Ubicación principal creada: %', v_location_id;

  -- ============================================================
  -- 4. CREAR CAJA PRINCIPAL
  -- ============================================================
  INSERT INTO cash_registers (
    tenant_id,
    location_id,
    name,
    is_active
  ) VALUES (
    v_tenant_id,
    v_location_id,
    'CAJA PRINCIPAL',
    TRUE
  )
  RETURNING cash_register_id INTO v_register_id;

  RAISE NOTICE '✓ Caja principal creada: %', v_register_id;

  -- ============================================================
  -- 5. CREAR IMPUESTOS POR DEFECTO
  -- ============================================================
  -- Primero crear los impuestos base
  INSERT INTO taxes (tenant_id, code, name, rate, is_active) VALUES
    (v_tenant_id, 'IVA19', 'IVA 19%', 0.1900, TRUE),
    (v_tenant_id, 'IVA5', 'IVA 5%', 0.0500, TRUE),
    (v_tenant_id, 'IVA0', 'IVA 0% (Exento)', 0.0000, TRUE);

  -- Luego crear las reglas a nivel tenant (scope='TENANT')
  INSERT INTO tax_rules (tenant_id, tax_id, scope, priority, is_active)
  SELECT 
    v_tenant_id,
    tax_id,
    'TENANT',
    CASE 
      WHEN code = 'IVA19' THEN 1  -- Mayor prioridad al IVA 19%
      WHEN code = 'IVA5' THEN 2
      ELSE 3
    END,
    TRUE
  FROM taxes
  WHERE tenant_id = v_tenant_id;

  RAISE NOTICE '✓ Impuestos creados (IVA 19%%, 5%%, 0%%)';

  -- ============================================================
  -- 6. CREAR MÉTODOS DE PAGO POR DEFECTO
  -- ============================================================
  INSERT INTO payment_methods (tenant_id, code, name, is_active) VALUES
    (v_tenant_id, 'CASH', 'Efectivo', TRUE),
    (v_tenant_id, 'DEBIT', 'Tarjeta Débito', TRUE),
    (v_tenant_id, 'CREDIT', 'Tarjeta Crédito', TRUE),
    (v_tenant_id, 'TRANSFER', 'Transferencia Bancaria', TRUE),
    (v_tenant_id, 'QR', 'QR / Nequi / Daviplata', TRUE);

  RAISE NOTICE '✓ Métodos de pago creados (5 métodos)';

  -- ============================================================
  -- 7. CREAR ROLES BÁSICOS (sin permisos detallados por ahora)
  -- ============================================================
  
  INSERT INTO roles (tenant_id, name) VALUES
    (v_tenant_id, 'ADMINISTRADOR'),
    (v_tenant_id, 'GERENTE'),
    (v_tenant_id, 'CAJERO'),
    (v_tenant_id, 'BODEGUERO');

  RAISE NOTICE '✓ Roles básicos creados (4 roles)';

  -- ============================================================
  -- 8. ASIGNAR PERMISOS AL ROL ADMINISTRADOR
  -- ============================================================
  SELECT role_id INTO v_role_id
  FROM roles
  WHERE tenant_id = v_tenant_id AND name = 'ADMINISTRADOR';

  -- Asignar TODOS los permisos al rol ADMINISTRADOR
  IF v_role_id IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT v_role_id, p.permission_id
    FROM permissions p
    ON CONFLICT DO NOTHING;
    
    RAISE NOTICE '✓ Permisos asignados al rol ADMINISTRADOR';
  END IF;

  -- ============================================================
  -- 8.5. APLICAR PLANTILLAS DE MENÚ A TODOS LOS ROLES DEL TENANT
  --      (requiere que ROLES_MENUS_SYSTEM.sql haya sido ejecutado)
  -- ============================================================
  IF EXISTS (SELECT 1 FROM information_schema.routines WHERE routine_name = 'fn_apply_role_menu_templates') THEN
    PERFORM fn_apply_role_menu_templates(v_tenant_id);
    RAISE NOTICE '✓ Plantillas de menú aplicadas a los roles del tenant';
  END IF;

  -- ============================================================
  -- 9. CREAR USUARIO ADMINISTRADOR
  -- ============================================================

  INSERT INTO users (
    user_id,
    auth_user_id,
    tenant_id,
    email,
    full_name,
    is_active
  ) VALUES (
    COALESCE((p_admin_data->>'user_id')::UUID, gen_random_uuid()),
    COALESCE((p_admin_data->>'user_id')::UUID, gen_random_uuid()),
    v_tenant_id,
    p_admin_data->>'email',
    p_admin_data->>'full_name',
    TRUE
  )
  RETURNING user_id INTO v_user_id;

  -- Asignar rol
  IF v_role_id IS NOT NULL THEN
    INSERT INTO user_roles (user_id, role_id)
    VALUES (v_user_id, v_role_id);
  END IF;

  RAISE NOTICE '✓ Usuario administrador creado: %', p_admin_data->>'email';

  -- ============================================================
  -- 10. RETORNAR RESULTADO
  -- ============================================================
  RETURN jsonb_build_object(
    'success', TRUE,
    'tenant_id', v_tenant_id,
    'user_id', v_user_id,
    'location_id', v_location_id,
    'cash_register_id', v_register_id,
    'message', 'Tenant creado exitosamente con configuración por defecto completa'
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'message', 'Error creando tenant: ' || SQLERRM
    );
END;
$$;

COMMENT ON FUNCTION fn_create_tenant IS 
  'v2.0: Crea tenant con configuración por defecto (impuestos, pagos, roles). Unidades de medida son globales.';

-- ===================================================================
-- VERIFICACIÓN
-- ===================================================================
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ fn_create_tenant ACTUALIZADA EXITOSAMENTE';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Cambios aplicados:';
  RAISE NOTICE '  ✓ Eliminado parámetro p_copy_from_tenant_id';
  RAISE NOTICE '  ✓ Agregados 3 impuestos por defecto (IVA 19%%, 5%%, 0%%)';
  RAISE NOTICE '  ✓ Agregados 5 métodos de pago por defecto';
  RAISE NOTICE '  ✓ Agregados 4 roles básicos (ADMINISTRADOR, GERENTE, CAJERO, BODEGUERO)';
  RAISE NOTICE '';
  RAISE NOTICE 'Cada nuevo tenant ahora se crea con:';
  RAISE NOTICE '  - Configuraciones básicas completas';
  RAISE NOTICE '  - 1 Ubicación (PRINCIPAL)';
  RAISE NOTICE '  - 1 Caja (CAJA PRINCIPAL)';
  RAISE NOTICE '  - 3 Impuestos + reglas';
  RAISE NOTICE '  - 5 Métodos de pago';
  RAISE NOTICE '  - 4 Roles básicos (ADMINISTRADOR, GERENTE, CAJERO, BODEGUERO)';
  RAISE NOTICE '  - Rol ADMINISTRADOR con TODOS los permisos asignados';
  RAISE NOTICE '  - 1 Usuario administrador';
  RAISE NOTICE '';
  RAISE NOTICE '⚠ NOTA: Las unidades de medida son globales (ya existen)';
  RAISE NOTICE '⚠ NOTA: Los permisos detallados deben configurarse desde la interfaz';
  RAISE NOTICE '';
END $$;
