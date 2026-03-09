import { supabase } from '../lib/supabase';

const ROLE_SELECT = `
  role_id,
  tenant_id,
  name,
  role_permissions(
    permission_id,
    permission:permission_id(permission_id,code,description)
  )
`;

export async function listRoles({ tenantId, search = '', limit = 20, offset = 0 } = {}) {
  try {
    let query = supabase
      .from('roles')
      .select(ROLE_SELECT, { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true })
      .range(offset, offset + limit - 1);

    if (search.trim()) {
      query = query.ilike('name', `%${search.trim()}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    return { success: true, data: data || [], total: Number(count || 0) };
  } catch (error) {
    return { success: false, error: error.message, data: [], total: 0 };
  }
}

export async function createRole(tenantId, name) {
  try {
    const { data, error } = await supabase
      .from('roles')
      .insert({
        tenant_id: tenantId,
        name: String(name || '').trim().toUpperCase(),
      })
      .select('role_id,tenant_id,name')
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function updateRole(tenantId, roleId, name) {
  try {
    const { data, error } = await supabase
      .from('roles')
      .update({ name: String(name || '').trim().toUpperCase() })
      .eq('tenant_id', tenantId)
      .eq('role_id', roleId)
      .select('role_id,tenant_id,name')
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function removeRole(tenantId, roleId) {
  try {
    const { error } = await supabase
      .from('roles')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('role_id', roleId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function listPermissions() {
  try {
    const { data, error } = await supabase
      .from('permissions')
      .select('permission_id,code,description')
      .order('code', { ascending: true });

    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

export async function listMenuItems({ includeInactive = false } = {}) {
  try {
    let query = supabase
      .from('menu_items')
      .select('menu_item_id,code,label,icon,route,action,parent_code,sort_order,is_superadmin_only,is_active')
      .order('sort_order', { ascending: true })
      .order('code', { ascending: true });

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

export async function getRolePermissionIds(tenantId, roleId) {
  try {
    const { data, error } = await supabase
      .from('role_permissions')
      .select('permission_id,role:role_id!inner(role_id,tenant_id)')
      .eq('role.tenant_id', tenantId)
      .eq('role_id', roleId);

    if (error) throw error;

    return {
      success: true,
      data: (data || []).map((row) => row.permission_id),
    };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

export async function setRolePermissionIds(tenantId, roleId, permissionIds = []) {
  try {
    const { data: role, error: roleError } = await supabase
      .from('roles')
      .select('tenant_id')
      .eq('role_id', roleId)
      .single();

    if (roleError) throw roleError;
    if (!role || role.tenant_id !== tenantId) {
      throw new Error('El rol no pertenece al tenant actual.');
    }

    const { error: deleteError } = await supabase
      .from('role_permissions')
      .delete()
      .eq('role_id', roleId);

    if (deleteError) throw deleteError;

    if (permissionIds.length > 0) {
      const rows = permissionIds.map((permissionId) => ({
        role_id: roleId,
        permission_id: permissionId,
      }));

      const { error: insertError } = await supabase
        .from('role_permissions')
        .insert(rows);

      if (insertError) throw insertError;
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getRoleMenuItems(roleId) {
  try {
    const { data, error } = await supabase
      .from('role_menus')
      .select(`
        menu_item_id,
        menu_item:menu_item_id(
          menu_item_id,
          code,
          label,
          route,
          action,
          parent_code,
          sort_order,
          is_superadmin_only,
          is_active
        )
      `)
      .eq('role_id', roleId);

    if (error) throw error;

    const menuItems = (data || []).map((item) => item.menu_item).filter(Boolean);
    return {
      success: true,
      data: {
        menuItemIds: menuItems.map((item) => item.menu_item_id),
        menuItems,
      },
    };
  } catch (error) {
    return { success: false, error: error.message, data: { menuItemIds: [], menuItems: [] } };
  }
}

export async function setRoleMenuItems(tenantId, roleId, menuItemIds = []) {
  try {
    const { data: role, error: roleError } = await supabase
      .from('roles')
      .select('tenant_id')
      .eq('role_id', roleId)
      .single();

    if (roleError) throw roleError;
    if (!role || role.tenant_id !== tenantId) {
      throw new Error('El rol no pertenece al tenant actual.');
    }

    const { error: deleteError } = await supabase
      .from('role_menus')
      .delete()
      .eq('role_id', roleId);

    if (deleteError) throw deleteError;

    if (menuItemIds.length > 0) {
      const rows = menuItemIds.map((menuItemId) => ({
        role_id: roleId,
        menu_item_id: menuItemId,
      }));

      const { error: insertError } = await supabase
        .from('role_menus')
        .insert(rows);

      if (insertError) throw insertError;
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function createGlobalRoleForAllTenants(roleName, permissionIds = [], menuCodes = []) {
  try {
    const { data, error } = await supabase.rpc('fn_superadmin_create_role_for_all_tenants', {
      p_role_name: String(roleName || '').trim().toUpperCase(),
      p_permission_ids: permissionIds,
      p_menu_codes: menuCodes,
    });

    if (error) throw error;

    if (!data?.success) {
      throw new Error(data?.message || 'No fue posible crear el rol global.');
    }

    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function syncGlobalRoleMenus(roleName, menuCodes = []) {
  try {
    const { data, error } = await supabase.rpc('fn_superadmin_sync_menus_to_role_all_tenants', {
      p_role_name: String(roleName || '').trim().toUpperCase(),
      p_menu_codes: menuCodes,
    });

    if (error) throw error;

    if (!data?.success) {
      throw new Error(data?.message || 'No fue posible sincronizar menus globales.');
    }

    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
