-- ===================================================================
-- Corregir nombres de roles de inglés a español
-- Fecha: 2026-02-20
-- Descripción: Renombra roles existentes en inglés a español y asigna permisos
-- ===================================================================

DO $$
DECLARE
  v_tenant RECORD;
  v_role_id UUID;
  v_count INTEGER;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '🔧 CORRIGIENDO NOMBRES DE ROLES A ESPAÑOL';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';

  -- Iterar sobre todos los tenants
  FOR v_tenant IN 
    SELECT tenant_id, name FROM tenants WHERE is_active = TRUE
  LOOP
    RAISE NOTICE '📂 Procesando tenant: % (ID: %)', v_tenant.name, v_tenant.tenant_id;
    
    -- 1. Renombrar ADMINISTRATOR → ADMINISTRADOR
    UPDATE roles 
    SET name = 'ADMINISTRADOR'
    WHERE tenant_id = v_tenant.tenant_id 
      AND name = 'ADMINISTRATOR';
    
    IF FOUND THEN
      RAISE NOTICE '  ✓ ADMINISTRATOR → ADMINISTRADOR';
    END IF;
    
    -- 2. Renombrar MANAGER → GERENTE
    UPDATE roles 
    SET name = 'GERENTE'
    WHERE tenant_id = v_tenant.tenant_id 
      AND name = 'MANAGER';
    
    IF FOUND THEN
      RAISE NOTICE '  ✓ MANAGER → GERENTE';
    END IF;
    
    -- 3. Renombrar CASHIER → CAJERO
    UPDATE roles 
    SET name = 'CAJERO'
    WHERE tenant_id = v_tenant.tenant_id 
      AND name = 'CASHIER';
    
    IF FOUND THEN
      RAISE NOTICE '  ✓ CASHIER → CAJERO';
    END IF;
    
    -- 4. Renombrar WAREHOUSE → BODEGUERO
    UPDATE roles 
    SET name = 'BODEGUERO'
    WHERE tenant_id = v_tenant.tenant_id 
      AND name = 'WAREHOUSE';
    
    IF FOUND THEN
      RAISE NOTICE '  ✓ WAREHOUSE → BODEGUERO';
    END IF;
    
    -- 5. Asignar todos los permisos al rol ADMINISTRADOR
    SELECT role_id INTO v_role_id
    FROM roles
    WHERE tenant_id = v_tenant.tenant_id 
      AND name = 'ADMINISTRADOR'
    LIMIT 1;
    
    IF v_role_id IS NOT NULL THEN
      -- Eliminar permisos existentes
      DELETE FROM role_permissions WHERE role_id = v_role_id;
      
      -- Asignar TODOS los permisos
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT v_role_id, p.permission_id
      FROM permissions p
      ON CONFLICT DO NOTHING;
      
      -- Contar permisos asignados
      SELECT COUNT(*) INTO v_count
      FROM role_permissions
      WHERE role_id = v_role_id;
      
      RAISE NOTICE '  ✅ % permisos asignados al rol ADMINISTRADOR', v_count;
    END IF;
    
    RAISE NOTICE '';
    
  END LOOP;

  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ ROLES CORREGIDOS Y PERMISOS ASIGNADOS';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '🔄 Cierra sesión y vuelve a entrar para ver todos los menús';
  RAISE NOTICE '';

END $$;
