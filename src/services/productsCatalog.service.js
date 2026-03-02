import { supabase } from '../lib/supabase';

const cols = `
  product_id,
  tenant_id,
  name,
  description,
  category_id,
  unit_id,
  is_active,
  track_inventory,
  requires_expiration,
  inventory_behavior,
  is_component,
  category:category_id(category_id,name),
  unit:unit_id(unit_id,code,name,dian_code,is_system),
  product_variants(variant_id,sku,variant_name,cost,price,min_stock,is_active)
`;

export async function listProducts({
  tenantId,
  search = '',
  limit = 20,
  offset = 0,
  isComponent,
} = {}) {
  try {
    let query = supabase
      .from('products')
      .select(cols, { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true })
      .range(offset, offset + limit - 1);

    if (typeof isComponent === 'boolean') {
      query = query.eq('is_component', isComponent);
    }

    if (search && search.trim()) {
      query = query.or(`name.ilike.%${search.trim()}%,description.ilike.%${search.trim()}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    return { success: true, data: data || [], total: Number(count || 0) };
  } catch (error) {
    return { success: false, error: error.message, data: [], total: 0 };
  }
}

export async function createProduct(payload) {
  try {
    const { data, error } = await supabase
      .from('products')
      .insert(payload)
      .select(cols)
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function updateProduct(productId, tenantId, updates) {
  try {
    const { data, error } = await supabase
      .from('products')
      .update(updates)
      .eq('product_id', productId)
      .eq('tenant_id', tenantId)
      .select(cols)
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function removeProduct(productId, tenantId) {
  try {
    const { error } = await supabase
      .from('products')
      .delete()
      .eq('product_id', productId)
      .eq('tenant_id', tenantId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function listCategoryOptions(tenantId) {
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('category_id,name')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true });

    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}
