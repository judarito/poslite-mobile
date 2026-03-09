import { supabase } from '../lib/supabase';
import {
  discardPendingOp,
  getPendingSaleOpById,
  getPendingSaleOps,
  retryPendingOp,
  updatePendingOpPayload,
} from '../storage/sqlite/database';

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
          third_party_id,
          invoice_type,
          dian_status,
          dian_consecutive,
          cufe,
          qr_url,
          dian_sent_at,
          email_sent_at,
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

export async function getPendingOfflineSales(tenantId, filters = {}) {
  if (!tenantId) return { success: true, data: [] };
  try {
    const rows = await getPendingSaleOps(tenantId, 300);

    const fromDate = filters.from_date ? new Date(filters.from_date) : null;
    const toDate = filters.to_date ? new Date(filters.to_date) : null;
    const statusFilter = String(filters.status || '');
    const locationFilter = String(filters.location_id || '');

    const mapped = rows
      .map((op) => {
        const payload = op.payload || {};
        const payments = Array.isArray(payload.payments) ? payload.payments : [];
        const total = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
        const status = op.status === 'FAILED' ? 'FAILED_SYNC' : 'PENDING_SYNC';
        const rawSyncError = op.lastError || null;
        const syncError = rawSyncError?.startsWith('NO_RETRY:')
          ? rawSyncError.slice('NO_RETRY:'.length)
          : rawSyncError;
        return {
          sale_id: `offline:${op.opId}`,
          sale_number: `OFF-${String(op.opId || '').slice(-6).toUpperCase()}`,
          sold_at: op.createdAt,
          status,
          third_party_id: payload.third_party_id || null,
          invoice_type: payload.third_party_id ? 'FE' : 'FV',
          dian_status: null,
          dian_consecutive: null,
          cufe: null,
          qr_url: null,
          dian_sent_at: null,
          email_sent_at: null,
          subtotal: total,
          tax_total: 0,
          discount_total: 0,
          total,
          location_id: payload.location_id || null,
          location: payload.location_id
            ? { name: `Sede (${String(payload.location_id).slice(0, 8)})` }
            : { name: 'Sin sede' },
          customer: payload.customer_id
            ? { customer_id: payload.customer_id, full_name: 'Cliente pendiente sync' }
            : null,
          sold_by_user: null,
          is_local_pending: true,
          sync_error: syncError,
          operation_id: op.opId,
          local_payload: payload,
        };
      })
      .filter((sale) => {
        if (statusFilter && sale.status !== statusFilter) return false;
        if (locationFilter && sale.location_id !== locationFilter) return false;
        const soldAt = new Date(sale.sold_at);
        if (fromDate && soldAt < fromDate) return false;
        if (toDate && soldAt > toDate) return false;
        return true;
      });

    return { success: true, data: mapped };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

export async function retryPendingOfflineSale(operationId) {
  if (!operationId) return { success: false, error: 'operationId es requerido' };
  try {
    await retryPendingOp(operationId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function discardPendingOfflineSale(operationId) {
  if (!operationId) return { success: false, error: 'operationId es requerido' };
  try {
    await discardPendingOp(operationId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getPendingOfflineSaleByOperationId(operationId) {
  if (!operationId) return { success: true, data: null };
  try {
    const row = await getPendingSaleOpById(operationId);
    if (!row) return { success: true, data: null };
    const rawSyncError = row.lastError || null;
    const syncError = rawSyncError?.startsWith('NO_RETRY:')
      ? rawSyncError.slice('NO_RETRY:'.length)
      : rawSyncError;
    return {
      success: true,
      data: {
        operation_id: row.opId,
        status: row.status === 'FAILED' ? 'FAILED_SYNC' : 'PENDING_SYNC',
        sync_error: syncError,
        payload: row.payload || {},
      },
    };
  } catch (error) {
    return { success: false, error: error.message, data: null };
  }
}

export async function estimatePendingSaleTotal(tenantId, lines = []) {
  if (!tenantId) return { success: false, error: 'tenantId es requerido', total: 0 };
  try {
    let total = 0;
    for (const line of lines) {
      const qty = Number(line.qty || 0);
      const unitPrice = Number(line.unit_price || 0);
      const discount = Number(line.discount || 0);
      if (!qty || qty <= 0) continue;
      const base = Math.max(0, qty * unitPrice - discount);

      let rate = 0;
      if (line.variant_id) {
        const { data, error } = await supabase.rpc('fn_get_tax_info_for_variant', {
          p_tenant: tenantId,
          p_variant: line.variant_id,
        });
        if (!error) rate = Number(data?.rate || 0);
      }

      const lineTotal = Math.round(base + base * rate);
      total += lineTotal;
    }
    return { success: true, total: Math.round(total) };
  } catch (error) {
    return { success: false, error: error.message, total: 0 };
  }
}

export async function updatePendingOfflineSalePayload(operationId, payload) {
  if (!operationId) return { success: false, error: 'operationId es requerido' };
  try {
    await updatePendingOpPayload(operationId, payload);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function validatePendingOfflineSaleStock(tenantId, payload = {}) {
  if (!tenantId) return { success: false, error: 'tenantId es requerido', ok: false, issues: [] };
  const locationId = payload?.location_id || null;
  const lines = Array.isArray(payload?.lines) ? payload.lines : [];

  if (!locationId) {
    return {
      success: true,
      ok: false,
      issues: [{ message: 'La venta offline no tiene sede (location_id).' }],
    };
  }

  const requiredMap = new Map();
  lines.forEach((line) => {
    const variantId = line?.variant_id;
    const qty = Number(line?.qty || 0);
    if (!variantId || qty <= 0) return;
    requiredMap.set(variantId, (requiredMap.get(variantId) || 0) + qty);
  });

  const variantIds = Array.from(requiredMap.keys());
  if (!variantIds.length) {
    return { success: true, ok: false, issues: [{ message: 'La venta offline no tiene lineas validas.' }] };
  }

  try {
    const [{ data: stocks, error: stockErr }, { data: variants, error: variantErr }] = await Promise.all([
      supabase
        .from('stock_balances')
        .select('variant_id,on_hand,reserved')
        .eq('tenant_id', tenantId)
        .eq('location_id', locationId)
        .in('variant_id', variantIds),
      supabase
        .from('product_variants')
        .select('variant_id,sku,variant_name,product:product_id(name)')
        .eq('tenant_id', tenantId)
        .in('variant_id', variantIds),
    ]);

    if (stockErr) throw stockErr;
    if (variantErr) throw variantErr;

    const stockMap = new Map((stocks || []).map((s) => [s.variant_id, s]));
    const variantMap = new Map((variants || []).map((v) => [v.variant_id, v]));
    const issues = [];

    variantIds.forEach((variantId) => {
      const required = Number(requiredMap.get(variantId) || 0);
      const stock = stockMap.get(variantId);
      const available = (Number(stock?.on_hand || 0) - Number(stock?.reserved || 0));
      if (available < required) {
        const v = variantMap.get(variantId);
        issues.push({
          variant_id: variantId,
          sku: v?.sku || '',
          variant_name: v?.variant_name || '',
          product_name: v?.product?.name || '',
          available,
          required,
        });
      }
    });

    return { success: true, ok: issues.length === 0, issues };
  } catch (error) {
    return { success: false, error: error.message, ok: false, issues: [] };
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
          third_party_id,
          invoice_type,
          resolution_id,
          dian_consecutive,
          cufe,
          qr_url,
          xml_path,
          dian_status,
          dian_response,
          dian_sent_at,
          email_sent_at,
          note,
          subtotal,
          tax_total,
          discount_total,
          total,
          customer:customer_id(customer_id, full_name, document, phone),
          third_party:third_party_id(third_party_id, legal_name, document_number, fiscal_email),
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

function isMissingRpcError(error) {
  const msg = String(error?.message || '').toLowerCase();
  return (
    msg.includes('could not find') ||
    msg.includes('does not exist') ||
    msg.includes('function') && msg.includes('not found')
  );
}

export async function retrySaleElectronicInvoicing(tenantId, saleId) {
  if (!tenantId || !saleId) {
    return { success: false, error: 'tenantId y saleId son requeridos' };
  }

  const rpcCandidates = [
    { name: 'sp_retry_sale_fe', args: { p_tenant: tenantId, p_sale_id: saleId } },
    { name: 'sp_retry_sale_electronic_invoice', args: { p_tenant: tenantId, p_sale_id: saleId } },
    { name: 'fn_retry_sale_fe', args: { p_tenant: tenantId, p_sale_id: saleId } },
    { name: 'fn_retry_sale_electronic_invoice', args: { p_tenant: tenantId, p_sale_id: saleId } },
  ];

  let lastError = null;
  for (const candidate of rpcCandidates) {
    const response = await supabase.rpc(candidate.name, candidate.args);
    if (!response.error) {
      return { success: true, data: response.data, mode: 'rpc', rpc: candidate.name };
    }
    if (isMissingRpcError(response.error)) {
      lastError = response.error;
      continue;
    }
    return { success: false, error: response.error.message };
  }

  try {
    const resetPayload = {
      dian_status: 'PENDING',
      dian_sent_at: null,
      dian_response: null,
    };
    const { data, error } = await supabase
      .from('sales')
      .update(resetPayload)
      .eq('tenant_id', tenantId)
      .eq('sale_id', saleId)
      .select('sale_id, dian_status')
      .single();
    if (error) throw error;
    return { success: true, data, mode: 'manual_reset' };
  } catch (error) {
    const fallbackMessage = lastError?.message
      ? `${error.message}. RPC FE no disponible: ${lastError.message}`
      : error.message;
    return { success: false, error: fallbackMessage };
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
