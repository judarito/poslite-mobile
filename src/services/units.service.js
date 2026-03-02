import { supabase } from '../lib/supabase';

const cols =
  'unit_id, tenant_id, code, dian_code, name, description, is_active, is_system, created_at';

export async function listUnits({ tenantId, search = '', limit = 20, offset = 0 } = {}) {
  try {
    let query = supabase
      .from('units_of_measure')
      .select(cols, { count: 'exact' })
      .order('is_system', { ascending: false })
      .order('name', { ascending: true })
      .range(offset, offset + limit - 1);

    if (tenantId) {
      query = query.or(`tenant_id.is.null,tenant_id.eq.${tenantId}`);
    }

    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      query = query.or(`code.ilike.${q},name.ilike.${q},description.ilike.${q},dian_code.ilike.${q}`);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    return { success: true, data: data || [], total: Number(count || 0) };
  } catch (error) {
    return { success: false, error: error.message, data: [], total: 0 };
  }
}

export async function listActiveUnits(tenantId) {
  try {
    let query = supabase
      .from('units_of_measure')
      .select('unit_id, code, name, dian_code, is_system')
      .eq('is_active', true)
      .order('is_system', { ascending: false })
      .order('name', { ascending: true });

    if (tenantId) {
      query = query.or(`tenant_id.is.null,tenant_id.eq.${tenantId}`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

export async function createUnit(payload) {
  try {
    const next = {
      ...payload,
      code: String(payload.code || '').trim().toUpperCase(),
      dian_code: payload.dian_code ? String(payload.dian_code).trim().toUpperCase() : null,
      is_system: false,
    };

    const { data, error } = await supabase
      .from('units_of_measure')
      .insert(next)
      .select(cols)
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function updateUnit(unitId, tenantId, updates) {
  try {
    const next = {
      ...updates,
      code: String(updates.code || '').trim().toUpperCase(),
      dian_code: updates.dian_code ? String(updates.dian_code).trim().toUpperCase() : null,
    };

    const { data, error } = await supabase
      .from('units_of_measure')
      .update(next)
      .eq('unit_id', unitId)
      .eq('tenant_id', tenantId)
      .eq('is_system', false)
      .select(cols)
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function checkUnitUsage(unitId) {
  try {
    const [{ count: productCount, error: e1 }, { count: variantCount, error: e2 }] = await Promise.all([
      supabase
        .from('products')
        .select('product_id', { head: true, count: 'exact' })
        .eq('unit_id', unitId),
      supabase
        .from('product_variants')
        .select('variant_id', { head: true, count: 'exact' })
        .eq('unit_id', unitId),
    ]);

    if (e1) throw e1;
    if (e2) throw e2;

    const usage = {
      products: Number(productCount || 0),
      variants: Number(variantCount || 0),
    };

    return {
      success: true,
      inUse: usage.products + usage.variants > 0,
      usage,
    };
  } catch (error) {
    return { success: false, inUse: false, usage: { products: 0, variants: 0 }, error: error.message };
  }
}

export async function removeUnit(unitId, tenantId) {
  try {
    const usage = await checkUnitUsage(unitId);
    if (!usage.success) {
      return { success: false, error: usage.error || 'No se pudo validar uso de la unidad' };
    }

    if (usage.inUse) {
      return {
        success: false,
        error: `No se puede eliminar: en uso por ${usage.usage.products} productos y ${usage.usage.variants} variantes.`,
      };
    }

    const { error } = await supabase
      .from('units_of_measure')
      .delete()
      .eq('unit_id', unitId)
      .eq('tenant_id', tenantId)
      .eq('is_system', false);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
