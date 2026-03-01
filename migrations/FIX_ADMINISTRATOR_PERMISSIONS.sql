-- ===================================================================
-- Arreglar permisos del rol ADMINISTRATOR en tenants existentes
-- Fecha: 2026-02-20
-- Descripción: Asigna TODOS los permisos al rol ADMINISTRATOR de cada tenant
-- ===================================================================

DO $$
DECLARE
  v_tenant RECORD;
  v_role_id UUID;
  v_count INTEGER;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '🔧 ASIGNANDO PERMISOS A ROLES ADMINISTRADOR';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';

  -- Iterar sobre todos los tenants
  FOR v_tenant IN 
    SELECT tenant_id, name FROM tenants WHERE is_active = TRUE
  LOOP
    RAISE NOTICE '📂 Procesando tenant: % (ID: %)', v_tenant.name, v_tenant.tenant_id;
    
    -- Buscar el rol ADMINISTRADOR de este tenant
    SELECT role_id INTO v_role_id
    FROM roles
    WHERE tenant_id = v_tenant.tenant_id 
      AND name = 'ADMINISTRADOR'
    LIMIT 1;
    
    IF v_role_id IS NULL THEN
      RAISE NOTICE '  ⚠ No se encontró rol ADMINISTRADOR para este tenant';
      CONTINUE;
    END IF;
    
    RAISE NOTICE '  ✓ Rol ADMINISTRADOR encontrado: %', v_role_id;
    
    -- Eliminar permisos existentes (por si acaso hay algunos)
    DELETE FROM role_permissions WHERE role_id = v_role_id;
    
    -- Asignar TODOS los permisos al rol ADMINISTRATOR
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT v_role_id, p.permission_id
    FROM permissions p
    ON CONFLICT DO NOTHING;
    
    -- Contar permisos asignados
    SELECT COUNT(*) INTO v_count
    FROM role_permissions
    WHERE role_id = v_role_id;
    
    RAISE NOTICE '  ✅ % permisos asignados al rol ADMINISTRADOR', v_count;
    RAISE NOTICE '';
    
  END LOOP;

  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ PERMISOS ASIGNADOS EXITOSAMENTE';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '🔄 Cierra sesión y vuelve a entrar para ver todos los menús';
  RAISE NOTICE '';

END $$;
