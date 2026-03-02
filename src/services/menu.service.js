import { supabase } from '../lib/supabase';

export const MENU_CACHE_TTL_MS = 5 * 60 * 1000;

export function buildMenuTree(items) {
  const rows = Array.isArray(items) ? items : [];
  const childrenMap = new Map();

  rows.forEach((item) => {
    if (!item?.parent_code) return;
    if (!childrenMap.has(item.parent_code)) {
      childrenMap.set(item.parent_code, []);
    }
    childrenMap.get(item.parent_code).push(item);
  });

  return rows
    .filter((item) => !item?.parent_code)
    .map((root) => ({
      ...root,
      children: (childrenMap.get(root.code) || []).sort(
        (a, b) => (a?.sort_order || 0) - (b?.sort_order || 0),
      ),
    }))
    .sort((a, b) => (a?.sort_order || 0) - (b?.sort_order || 0));
}

export async function fetchUserMenus(authUserId) {
  if (!authUserId) {
    throw new Error('authUserId es requerido para cargar menus');
  }

  const { data, error } = await supabase.rpc('fn_get_user_menus', {
    p_auth_user_id: authUserId,
  });

  if (error) throw error;

  const flat = data || [];
  return {
    flat,
    tree: buildMenuTree(flat),
  };
}

export function isFreshCache(isoDate, ttlMs = MENU_CACHE_TTL_MS) {
  if (!isoDate) return false;
  const age = Date.now() - new Date(isoDate).getTime();
  return Number.isFinite(age) && age >= 0 && age <= ttlMs;
}
