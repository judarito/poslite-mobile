import { supabase } from '../lib/supabase';

const cols =
  'third_party_id, tenant_id, type, document_type, document_number, dv, legal_name, trade_name, phone, email, fiscal_email, address, city, city_code, department, postal_code, country_code, tax_regime, is_responsible_for_iva, obligated_accounting, ciiu_code, electronic_invoicing_enabled, max_credit_amount, default_payment_terms, default_currency, is_active, created_at';

export async function listThirdParties({ search = '', limit = 100, offset = 0, type = null } = {}) {
  try {
    let query = supabase
      .from('third_parties')
      .select(cols, { count: 'exact' })
      .order('legal_name', { ascending: true })
      .range(offset, offset + limit - 1);

    if (type) query = query.in('type', [type, 'both']);

    if (search && search.trim() !== '') {
      const q = `%${search.trim()}%`;
      query = supabase
        .from('third_parties')
        .select(cols, { count: 'exact' })
        .or(`legal_name.ilike.${q},document_number.ilike.${q}`)
        .order('legal_name', { ascending: true })
        .range(offset, offset + limit - 1);
      if (type) query = query.in('type', [type, 'both']);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    return { success: true, data: data || [], total: count || 0 };
  } catch (error) {
    return { success: false, error: error.message, data: [], total: 0 };
  }
}

export async function createThirdParty(payload) {
  try {
    const plain = JSON.parse(JSON.stringify(payload));
    const { data, error } = await supabase.rpc('fn_upsert_third_party', { p_data: plain });
    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function updateThirdParty(id, payload) {
  try {
    const plain = JSON.parse(JSON.stringify(payload));
    if (!plain.third_party_id) plain.third_party_id = id;

    const { data, error } = await supabase.rpc('fn_upsert_third_party', { p_data: plain });
    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function removeThirdParty(id, tenantId) {
  try {
    const { data, error } = await supabase.rpc('fn_delete_third_party', {
      p_id: id,
      p_tenant_id: tenantId,
    });

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
