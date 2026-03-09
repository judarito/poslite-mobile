import { supabase } from '../lib/supabase';

const PRICING_RULE_SELECT = `
  pricing_rule_id,
  tenant_id,
  scope,
  location_id,
  category_id,
  product_id,
  variant_id,
  pricing_method,
  markup_percentage,
  price_rounding,
  rounding_to,
  priority,
  is_active,
  created_at,
  updated_at,
  location:location_id(location_id,name),
  category:category_id(category_id,name),
  product:product_id(product_id,name),
  variant:variant_id(variant_id,sku,variant_name,product:product_id(name))
`;

function parseNullableBoolean(value) {
  if (value === true || value === false) return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function normalizeScopeReferences(scope, payload = {}) {
  const currentScope = String(scope || 'TENANT').toUpperCase();
  return {
    location_id: currentScope === 'LOCATION' ? payload.location_id || null : null,
    category_id: currentScope === 'CATEGORY' ? payload.category_id || null : null,
    product_id: currentScope === 'PRODUCT' ? payload.product_id || null : null,
    variant_id: currentScope === 'VARIANT' ? payload.variant_id || null : null,
  };
}

export async function listPricingRules({
  tenantId,
  scope = '',
  isActive = null,
  locationId = null,
  limit = 20,
  offset = 0,
} = {}) {
  try {
    let query = supabase
      .from('pricing_rules')
      .select(PRICING_RULE_SELECT, { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (scope) query = query.eq('scope', String(scope).toUpperCase());
    if (locationId) query = query.eq('location_id', locationId);

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

export async function createPricingRule(tenantId, payload = {}) {
  try {
    const scope = String(payload.scope || 'TENANT').toUpperCase();
    const refs = normalizeScopeReferences(scope, payload);

    const { data, error } = await supabase
      .from('pricing_rules')
      .insert({
        tenant_id: tenantId,
        scope,
        pricing_method: String(payload.pricing_method || 'MARKUP').toUpperCase(),
        markup_percentage: Number(payload.markup_percentage || 0),
        price_rounding: String(payload.price_rounding || 'NONE').toUpperCase(),
        rounding_to: Number(payload.rounding_to || 1),
        priority: Number(payload.priority || 0),
        is_active: payload.is_active !== false,
        ...refs,
      })
      .select(PRICING_RULE_SELECT)
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function updatePricingRule(tenantId, pricingRuleId, payload = {}) {
  try {
    const scope = String(payload.scope || 'TENANT').toUpperCase();
    const refs = normalizeScopeReferences(scope, payload);

    const { data, error } = await supabase
      .from('pricing_rules')
      .update({
        scope,
        pricing_method: String(payload.pricing_method || 'MARKUP').toUpperCase(),
        markup_percentage: Number(payload.markup_percentage || 0),
        price_rounding: String(payload.price_rounding || 'NONE').toUpperCase(),
        rounding_to: Number(payload.rounding_to || 1),
        priority: Number(payload.priority || 0),
        is_active: payload.is_active !== false,
        ...refs,
      })
      .eq('tenant_id', tenantId)
      .eq('pricing_rule_id', pricingRuleId)
      .select(PRICING_RULE_SELECT)
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function removePricingRule(tenantId, pricingRuleId) {
  try {
    const { error } = await supabase
      .from('pricing_rules')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('pricing_rule_id', pricingRuleId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function listLocationsForPricingRules(tenantId) {
  try {
    const { data, error } = await supabase
      .from('locations')
      .select('location_id,name,is_active')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

export async function listCategoriesForPricingRules(tenantId) {
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

export async function listProductsForPricingRules(tenantId, search = '', limit = 200) {
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

export async function listVariantsForPricingRules(tenantId, search = '', limit = 250) {
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
