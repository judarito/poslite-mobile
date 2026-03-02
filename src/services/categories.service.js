import { supabase } from '../lib/supabase';

const cols = 'category_id, tenant_id, name, parent_category_id, parent:parent_category_id(category_id,name)';

export async function listCategories({ tenantId, search = '', limit = 20, offset = 0 } = {}) {
  try {
    let query = supabase
      .from('categories')
      .select(cols, { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true })
      .range(offset, offset + limit - 1);

    if (search && search.trim()) {
      query = query.ilike('name', `%${search.trim()}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    return { success: true, data: data || [], total: Number(count || 0) };
  } catch (error) {
    return { success: false, error: error.message, data: [], total: 0 };
  }
}

export async function listAllCategories(tenantId) {
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('category_id, name, parent_category_id')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true });

    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

export async function createCategory(payload) {
  try {
    const { data, error } = await supabase
      .from('categories')
      .insert(payload)
      .select('category_id, tenant_id, name, parent_category_id')
      .single();
    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function updateCategory(categoryId, tenantId, updates) {
  try {
    const { data, error } = await supabase
      .from('categories')
      .update(updates)
      .eq('category_id', categoryId)
      .eq('tenant_id', tenantId)
      .select('category_id, tenant_id, name, parent_category_id')
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function removeCategory(categoryId, tenantId) {
  try {
    const { error } = await supabase
      .from('categories')
      .delete()
      .eq('category_id', categoryId)
      .eq('tenant_id', tenantId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
