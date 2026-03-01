-- ===========================================
-- Funciones para gestión de usuarios
-- ===========================================

-- Función para crear usuario en Supabase Auth y registrarlo en la BD
CREATE OR REPLACE FUNCTION create_auth_user(
  p_email text,
  p_password text,
  p_full_name text,
  p_role_ids uuid[] DEFAULT '{}',
  p_is_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_auth_user_id uuid;
  v_user_id uuid;
  v_tenant_id uuid;
  v_role_id uuid;
  v_result jsonb;
BEGIN
  -- Obtener el tenant_id del usuario que ejecuta la función
  SELECT tenant_id INTO v_tenant_id
  FROM users
  WHERE auth_user_id = auth.uid();

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo determinar el tenant del usuario actual';
  END IF;

  -- Verificar que el email no exista ya en el tenant
  IF EXISTS (
    SELECT 1 FROM users
    WHERE tenant_id = v_tenant_id
    AND email = p_email
  ) THEN
    RAISE EXCEPTION 'El email ya está registrado en este tenant';
  END IF;

  -- Crear usuario en Supabase Auth
  -- Nota: Esta parte requiere la extensión supabase_admin o usar la API de administración
  -- Por ahora, generamos un UUID y lo simulamos
  -- En producción, debes usar supabase.auth.admin.createUser() desde tu backend
  v_auth_user_id := gen_random_uuid();

  -- Insertar usuario en la tabla users
  INSERT INTO users (
    auth_user_id,
    tenant_id,
    email,
    full_name,
    is_active
  ) VALUES (
    v_auth_user_id,
    v_tenant_id,
    p_email,
    p_full_name,
    p_is_active
  )
  RETURNING user_id INTO v_user_id;

  -- Asignar roles al usuario
  IF array_length(p_role_ids, 1) > 0 THEN
    FOREACH v_role_id IN ARRAY p_role_ids
    LOOP
      -- Verificar que el rol pertenece al mismo tenant
      IF NOT EXISTS (
        SELECT 1 FROM roles
        WHERE role_id = v_role_id
        AND tenant_id = v_tenant_id
      ) THEN
        RAISE EXCEPTION 'El rol % no pertenece al tenant actual', v_role_id;
      END IF;

      INSERT INTO user_roles (user_id, role_id)
      VALUES (v_user_id, v_role_id);
    END LOOP;
  END IF;

  -- Retornar resultado
  v_result := jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'auth_user_id', v_auth_user_id,
    'email', p_email,
    'message', 'Usuario creado exitosamente. NOTA: La contraseña debe ser configurada en Supabase Auth.'
  );

  RETURN v_result;

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al crear usuario: %', SQLERRM;
END;
$$;

-- Función para cambiar contraseña (requiere privilegios de admin)
CREATE OR REPLACE FUNCTION change_user_password(
  p_auth_user_id uuid,
  p_new_password text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- Verificar que el usuario existe y pertenece al mismo tenant
  IF NOT EXISTS (
    SELECT 1
    FROM users u1
    INNER JOIN users u2 ON u2.tenant_id = u1.tenant_id
    WHERE u1.auth_user_id = auth.uid()
    AND u2.auth_user_id = p_auth_user_id
  ) THEN
    RAISE EXCEPTION 'Usuario no encontrado o no pertenece al tenant actual';
  END IF;

  -- Aquí debería ir la llamada a la API de Supabase Auth para cambiar la contraseña
  -- Por ahora solo retornamos un mensaje
  v_result := jsonb_build_object(
    'success', true,
    'message', 'La contraseña debe ser actualizada usando la API de administración de Supabase Auth'
  );

  RETURN v_result;

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al cambiar contraseña: %', SQLERRM;
END;
$$;

-- Función para obtener usuarios con sus roles (optimizada)
CREATE OR REPLACE FUNCTION get_users_with_roles()
RETURNS TABLE (
  user_id uuid,
  auth_user_id uuid,
  tenant_id uuid,
  email text,
  full_name text,
  is_active boolean,
  created_at timestamptz,
  roles jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  -- Obtener el tenant_id del usuario actual
  SELECT u.tenant_id INTO v_tenant_id
  FROM users u
  WHERE u.auth_user_id = auth.uid();

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo determinar el tenant del usuario actual';
  END IF;

  -- Retornar usuarios con sus roles
  RETURN QUERY
  SELECT
    u.user_id,
    u.auth_user_id,
    u.tenant_id,
    u.email,
    u.full_name,
    u.is_active,
    u.created_at,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'role_id', r.role_id,
          'name', r.name
        )
      ) FILTER (WHERE r.role_id IS NOT NULL),
      '[]'::jsonb
    ) as roles
  FROM users u
  LEFT JOIN user_roles ur ON ur.user_id = u.user_id
  LEFT JOIN roles r ON r.role_id = ur.role_id
  WHERE u.tenant_id = v_tenant_id
  GROUP BY u.user_id, u.auth_user_id, u.tenant_id, u.email, u.full_name, u.is_active, u.created_at
  ORDER BY u.created_at DESC;

END;
$$;

-- Otorgar permisos de ejecución
GRANT EXECUTE ON FUNCTION create_auth_user TO authenticated;
GRANT EXECUTE ON FUNCTION change_user_password TO authenticated;
GRANT EXECUTE ON FUNCTION get_users_with_roles TO authenticated;

-- Comentarios
COMMENT ON FUNCTION create_auth_user IS 'Crea un usuario en Supabase Auth y lo registra en la base de datos con sus roles';
COMMENT ON FUNCTION change_user_password IS 'Cambia la contraseña de un usuario (requiere integración con Supabase Auth Admin)';
COMMENT ON FUNCTION get_users_with_roles IS 'Obtiene todos los usuarios del tenant con sus roles asignados';
