import { supabase } from '../lib/supabase';

const TAX_RULE_SELECT = `
  tax_rule_id,
  tenant_id,
  tax_id,
  scope,
  category_id,
  product_id,
  variant_id,
  priority,
  is_active,
  tax:tax_id(tax_id,code,name,rate,is_active),
  category:category_id(category_id,name),
  product:product_id(product_id,name),
  variant:variant_id(variant_id,sku,variant_name,product:product_id(name))
`;

function normalizeScopeReferences(scope, payload = {}) {
  const currentScope = String(scope || 'TENANT').toUpperCase();
  return {
    category_id: currentScope === 'CATEGORY' ? payload.category_id || null : null,
    product_id: currentScope === 'PRODUCT' ? payload.product_id || null : null,
    variant_id: currentScope === 'VARIANT' ? payload.variant_id || null : null,
  };
}

function parseNullableBoolean(value) {
  if (value === true || value === false) return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

export async function listTaxRules({
  tenantId,
  scope = '',
  taxId = null,
  isActive = null,
  limit = 20,
  offset = 0,
} = {}) {
  try {
    let query = supabase
      .from('tax_rules')
      .select(TAX_RULE_SELECT, { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('scope', { ascending: true })
      .order('priority', { ascending: false })
      .range(offset, offset + limit - 1);

    if (scope) query = query.eq('scope', String(scope).toUpperCase());
    if (taxId) query = query.eq('tax_id', taxId);

    const normalizedStatus = parseNullableBoolean(isActive);
    if (normalizedStatus !== null) {
      query = query.eq('is_active', normalizedStatus);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    return { success: true, data: data || [], total: Number(count || 0) };
  } catch (error) {
    return { success: false, error: error.message, data: [], total: 0 };
  }
}

export async function createTaxRule(tenantId, payload = {}) {
  try {
    const scope = String(payload.scope || 'TENANT').toUpperCase();
    const refs = normalizeScopeReferences(scope, payload);

    const { data, error } = await supabase
      .from('tax_rules')
      .insert({
        tenant_id: tenantId,
        tax_id: payload.tax_id,
        scope,
        priority: Number(payload.priority || 0),
        is_active: payload.is_active !== false,
        ...refs,
      })
      .select(TAX_RULE_SELECT)
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function updateTaxRule(tenantId, taxRuleId, payload = {}) {
  try {
    const scope = String(payload.scope || 'TENANT').toUpperCase();
    const refs = normalizeScopeReferences(scope, payload);

    const { data, error } = await supabase
      .from('tax_rules')
      .update({
        tax_id: payload.tax_id,
        scope,
        priority: Number(payload.priority || 0),
        is_active: payload.is_active !== false,
        ...refs,
      })
      .eq('tenant_id', tenantId)
      .eq('tax_rule_id', taxRuleId)
      .select(TAX_RULE_SELECT)
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function removeTaxRule(tenantId, taxRuleId) {
  try {
    const { error } = await supabase
      .from('tax_rules')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('tax_rule_id', taxRuleId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function listTaxesForTaxRules(tenantId) {
  try {
    const { data, error } = await supabase
      .from('taxes')
      .select('tax_id,code,name,rate,is_active')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true });

    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

export async function listCategoriesForTaxRules(tenantId) {
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

export async function listProductsForTaxRules(tenantId, search = '', limit = 200) {
  try {
    let query = supabase
      .from('products')
      .select('product_id,name,category:category_id(name)')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('name', { ascending: true })
      .limit(limit);

    if (search.trim()) {
      query = query.ilike('name', `%${search.trim()}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

export async function listVariantsForTaxRules(tenantId, search = '', limit = 250) {
  try {
    let query = supabase
      .from('product_variants')
      .select('variant_id,sku,variant_name,product:product_id(name)')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('sku', { ascending: true })
      .limit(limit);

    if (search.trim()) {
      query = query.or(`sku.ilike.%${search.trim()}%,variant_name.ilike.%${search.trim()}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}
