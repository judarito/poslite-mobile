import { supabase } from '../lib/supabase';

export async function getSales(tenantId, page = 1, pageSize = 20, filters = {}) {
  if (!tenantId) {
    return { success: false, error: 'tenantId es requerido', data: [], total: 0 };
  }

  try {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from('sales')
      .select(
        `
          sale_id,
          sale_number,
          sold_at,
          status,
          subtotal,
          tax_total,
          discount_total,
          total,
          customer:customer_id(customer_id, full_name, document),
          sold_by_user:sold_by(full_name),
          location:location_id(name)
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', tenantId)
      .order('sold_at', { ascending: false })
      .range(from, to);

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.location_id) query = query.eq('location_id', filters.location_id);
    if (filters.from_date) query = query.gte('sold_at', filters.from_date);
    if (filters.to_date) query = query.lte('sold_at', filters.to_date);

    const { data, error, count } = await query;
    if (error) throw error;

    return { success: true, data: data || [], total: count || 0 };
  } catch (error) {
    return { success: false, error: error.message, data: [], total: 0 };
  }
}

export async function getSaleById(tenantId, saleId) {
  if (!tenantId || !saleId) {
    return { success: false, error: 'tenantId y saleId son requeridos', data: null };
  }

  try {
    const { data, error } = await supabase
      .from('sales')
      .select(
        `
          sale_id,
          sale_number,
          sold_at,
          status,
          note,
          subtotal,
          tax_total,
          discount_total,
          total,
          customer:customer_id(customer_id, full_name, document, phone),
          sold_by_user:sold_by(full_name),
          location:location_id(name),
          sale_lines(
            sale_line_id,
            quantity,
            unit_price,
            discount_amount,
            tax_amount,
            line_total,
            variant:variant_id(sku, variant_name, product:product_id(name))
          ),
          sale_payments(
            sale_payment_id,
            amount,
            reference,
            paid_at,
            payment_method:payment_method_id(code, name)
          )
        `,
      )
      .eq('tenant_id', tenantId)
      .eq('sale_id', saleId)
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message, data: null };
  }
}

export async function voidSale(tenantId, saleId) {
  if (!tenantId || !saleId) {
    return { success: false, error: 'tenantId y saleId son requeridos' };
  }

  try {
    const { data, error } = await supabase
      .from('sales')
      .update({ status: 'VOIDED' })
      .eq('tenant_id', tenantId)
      .eq('sale_id', saleId)
      .select('sale_id, status')
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function createReturn(tenantId, returnData) {
  if (!tenantId) {
    return { success: false, error: 'tenantId es requerido' };
  }

  try {
    if (Array.isArray(returnData.refunds) && returnData.refunds.length > 0) {
      const { data, error } = await supabase.rpc('sp_create_return_v2', {
        p_tenant: tenantId,
        p_sale_id: returnData.sale_id,
        p_created_by: returnData.created_by,
        p_lines: returnData.lines,
        p_refunds: returnData.refunds,
        p_reason: returnData.reason || null,
      });

      if (error) throw error;
      return { success: true, data: { return_id: data } };
    }

    const { data, error } = await supabase.rpc('sp_create_return', {
      p_tenant: tenantId,
      p_sale_id: returnData.sale_id,
      p_created_by: returnData.created_by,
      p_lines: returnData.lines,
      p_reason: returnData.reason || null,
    });

    if (error) throw error;
    return { success: true, data: { return_id: data } };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getCompletedReturnQtyByLineIds(saleLineIds = []) {
  if (!Array.isArray(saleLineIds) || saleLineIds.length === 0) {
    return { success: true, data: {} };
  }

  try {
    const { data, error } = await supabase
      .from('sale_return_lines')
      .select('sale_line_id, quantity, return:return_id!inner(status)')
      .eq('return.status', 'COMPLETED')
      .in('sale_line_id', saleLineIds);

    if (error) throw error;

    const grouped = {};
    (data || []).forEach((row) => {
      grouped[row.sale_line_id] = (grouped[row.sale_line_id] || 0) + (Number(row.quantity) || 0);
    });

    return { success: true, data: grouped };
  } catch (error) {
    return { success: false, error: error.message, data: {} };
  }
}
