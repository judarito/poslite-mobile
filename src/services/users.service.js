import { supabase } from '../lib/supabase';

const USER_SELECT = `
  user_id,
  auth_user_id,
  tenant_id,
  email,
  full_name,
  is_active,
  created_at,
  user_roles(
    role_id,
    roles:role_id(role_id,name)
  )
`;

function mapUser(user) {
  const roles = (user?.user_roles || [])
    .map((item) => item?.roles)
    .filter(Boolean);

  return {
    ...user,
    roles,
    roleIds: roles.map((role) => role.role_id),
  };
}

export async function listUsers({ tenantId, search = '', limit = 20, offset = 0 } = {}) {
  try {
    let query = supabase
      .from('users')
      .select(USER_SELECT, { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (search.trim()) {
      const text = search.trim();
      query = query.or(`full_name.ilike.%${text}%,email.ilike.%${text}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    return {
      success: true,
      data: (data || []).map(mapUser),
      total: Number(count || 0),
    };
  } catch (error) {
    return { success: false, error: error.message, data: [], total: 0 };
  }
}

export async function listRolesForUsers(tenantId) {
  try {
    const { data, error } = await supabase
      .from('roles')
      .select('role_id,name')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true });

    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

export async function createTenantUser({
  email,
  password,
  full_name,
  roleIds = [],
  is_active = true,
} = {}) {
  try {
    const { data, error } = await supabase.rpc('create_auth_user', {
      p_email: String(email || '').trim().toLowerCase(),
      p_password: String(password || ''),
      p_full_name: String(full_name || '').trim(),
      p_role_ids: Array.isArray(roleIds) ? roleIds : [],
      p_is_active: is_active !== false,
    });

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function updateTenantUser(
  tenantId,
  userId,
  { full_name, is_active, roleIds = [] } = {},
) {
  try {
    const { error: updateError } = await supabase
      .from('users')
      .update({
        full_name: String(full_name || '').trim(),
        is_active: is_active !== false,
      })
      .eq('tenant_id', tenantId)
      .eq('user_id', userId);

    if (updateError) throw updateError;

    if (Array.isArray(roleIds) && roleIds.length > 0) {
      const { data: validRoles, error: roleCheckError } = await supabase
        .from('roles')
        .select('role_id')
        .eq('tenant_id', tenantId)
        .in('role_id', roleIds);

      if (roleCheckError) throw roleCheckError;

      if ((validRoles || []).length !== roleIds.length) {
        throw new Error('Uno o mas roles no pertenecen al tenant actual.');
      }
    }

    const { error: deleteError } = await supabase
      .from('user_roles')
      .delete()
      .eq('user_id', userId);

    if (deleteError) throw deleteError;

    if (Array.isArray(roleIds) && roleIds.length > 0) {
      const rows = roleIds.map((roleId) => ({ user_id: userId, role_id: roleId }));
      const { error: insertError } = await supabase
        .from('user_roles')
        .insert(rows);

      if (insertError) throw insertError;
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function toggleTenantUserStatus(tenantId, userId, isActive) {
  try {
    const { error } = await supabase
      .from('users')
      .update({ is_active: isActive !== false })
      .eq('tenant_id', tenantId)
      .eq('user_id', userId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function changeTenantUserPassword(authUserId, newPassword) {
  try {
    const { data, error } = await supabase.rpc('change_user_password', {
      p_auth_user_id: authUserId,
      p_new_password: String(newPassword || ''),
    });

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
