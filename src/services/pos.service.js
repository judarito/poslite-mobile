import { supabase } from '../lib/supabase';
import { getSimpleCache, saveSimpleCache } from './offlineCache.service';

function catalogCacheKey(tenantId, locationId) {
  return `pos-catalog:${tenantId}:${locationId || 'na'}`;
}

function paymentMethodsCacheKey(tenantId) {
  return `pos-payment-methods:${tenantId}`;
}

function customersCacheKey(tenantId) {
  return `pos-customers:${tenantId}`;
}

function sessionCacheKey(tenantId, userId) {
  return `pos-open-session:${tenantId}:${userId}`;
}

function taxInfoCacheKey(tenantId, variantId) {
  return `pos-tax-info:${tenantId}:${variantId}`;
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase();
}

export async function getPaymentMethodsForDropdown(tenantId, { offlineMode = false } = {}) {
  const cacheKey = paymentMethodsCacheKey(tenantId);
  if (offlineMode) {
    const cached = await getSimpleCache(cacheKey);
    return { success: true, data: cached?.value || [] };
  }

  try {
    const { data, error } = await supabase
      .from('payment_methods')
      .select('payment_method_id, code, name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .not('code', 'in', '(LAYAWAY)')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) throw error;
    const list = data || [];
    await saveSimpleCache(cacheKey, list);
    return { success: true, data: list };
  } catch (error) {
    const cached = await getSimpleCache(cacheKey);
    if (cached?.value) {
      return {
        success: true,
        data: cached.value,
        source: 'cache',
        warning: error.message,
      };
    }
    return { success: false, error: error.message, data: [] };
  }
}

export async function getCurrentUserOpenSession(tenantId, userId, { offlineMode = false } = {}) {
  const cacheKey = sessionCacheKey(tenantId, userId);
  if (offlineMode) {
    const cached = await getSimpleCache(cacheKey);
    return { success: true, data: cached?.value || null };
  }

  try {
    const { data, error } = await supabase
      .from('cash_sessions')
      .select(
        `
          cash_session_id,
          opened_at,
          cash_register:cash_register_id(
            cash_register_id,
            name,
            location_id,
            location:location_id(name)
          )
        `,
      )
      .eq('tenant_id', tenantId)
      .eq('opened_by', userId)
      .eq('status', 'OPEN')
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    await saveSimpleCache(cacheKey, data || null);
    return { success: true, data: data || null };
  } catch (error) {
    const cached = await getSimpleCache(cacheKey);
    if (cached?.value) {
      return {
        success: true,
        data: cached.value,
        source: 'cache',
        warning: error.message,
      };
    }
    return { success: false, error: error.message, data: null };
  }
}

export async function searchVariants(tenantId, search, limit = 20, locationId = null) {
  try {
    const { data: byVariant, error: e1 } = await supabase
      .from('product_variants')
      .select(
        `
          variant_id, sku, variant_name, cost, price, price_includes_tax, is_active, is_component,
          product:product_id(product_id, name, is_component)
        `,
      )
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .or('is_component.is.null,is_component.eq.false')
      .or(`sku.ilike.%${search}%,variant_name.ilike.%${search}%`)
      .limit(limit);

    if (e1) throw e1;

    const { data: byProduct, error: e2 } = await supabase
      .from('product_variants')
      .select(
        `
          variant_id, sku, variant_name, cost, price, price_includes_tax, is_active, is_component,
          product:product_id!inner(product_id, name, is_component)
        `,
      )
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .or('is_component.is.null,is_component.eq.false')
      .ilike('product.name', `%${search}%`)
      .limit(limit);

    if (e2) throw e2;

    const map = new Map();
    [...(byVariant || []), ...(byProduct || [])].forEach((v) => {
      const effectiveIsComponent =
        v.is_component !== null ? v.is_component : (v.product?.is_component || false);
      if (!effectiveIsComponent && !map.has(v.variant_id)) {
        map.set(v.variant_id, v);
      }
    });

    let results = Array.from(map.values()).slice(0, limit);

    if (locationId && results.length > 0) {
      const variantIds = results.map((v) => v.variant_id);
      const { data: stockData, error: stockError } = await supabase
        .from('stock_balances')
        .select('variant_id, on_hand, reserved')
        .eq('tenant_id', tenantId)
        .eq('location_id', locationId)
        .in('variant_id', variantIds);

      if (!stockError && stockData) {
        const stockMap = new Map(stockData.map((s) => [s.variant_id, s]));
        results = results.map((v) => ({
          ...v,
          stock_on_hand: stockMap.get(v.variant_id)?.on_hand || 0,
          stock_reserved: stockMap.get(v.variant_id)?.reserved || 0,
          stock_available:
            (stockMap.get(v.variant_id)?.on_hand || 0) - (stockMap.get(v.variant_id)?.reserved || 0),
        }));
      }
    }

    return { success: true, data: results };
  } catch (error) {
    const fallback = await searchVariantsOffline(tenantId, search, limit, locationId);
    if (fallback.success && fallback.data.length > 0) {
      return {
        success: true,
        data: fallback.data,
        source: 'cache',
        warning: error.message,
      };
    }
    return { success: false, error: error.message, data: [] };
  }
}

export async function warmPosCatalog(tenantId, locationId = null, limit = 2000) {
  try {
    const { data: base, error } = await supabase
      .from('product_variants')
      .select(
        `
          variant_id, sku, variant_name, cost, price, price_includes_tax, is_active, is_component,
          product:product_id(product_id, name, is_component)
        `,
      )
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .or('is_component.is.null,is_component.eq.false')
      .order('variant_name', { ascending: true })
      .limit(limit);

    if (error) throw error;

    let results = (base || []).filter((v) => {
      const effectiveIsComponent =
        v.is_component !== null ? v.is_component : (v.product?.is_component || false);
      return !effectiveIsComponent;
    });

    if (locationId && results.length > 0) {
      const ids = results.map((v) => v.variant_id);
      const { data: stock } = await supabase
        .from('stock_balances')
        .select('variant_id, on_hand, reserved')
        .eq('tenant_id', tenantId)
        .eq('location_id', locationId)
        .in('variant_id', ids);

      const stockMap = new Map((stock || []).map((s) => [s.variant_id, s]));
      results = results.map((v) => ({
        ...v,
        stock_on_hand: stockMap.get(v.variant_id)?.on_hand || 0,
        stock_reserved: stockMap.get(v.variant_id)?.reserved || 0,
        stock_available:
          (stockMap.get(v.variant_id)?.on_hand || 0) - (stockMap.get(v.variant_id)?.reserved || 0),
      }));
    }

    await saveSimpleCache(catalogCacheKey(tenantId, locationId), results);
    return { success: true, data: results };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

export async function listCatalogForInvoiceMatching(tenantId, locationId = null, limit = 3000) {
  try {
    const warm = await warmPosCatalog(tenantId, locationId, limit);
    if (warm.success && Array.isArray(warm.data)) {
      return { success: true, data: warm.data };
    }

    const [cachedByLocation, cachedGeneric] = await Promise.all([
      getSimpleCache(catalogCacheKey(tenantId, locationId)),
      getSimpleCache(catalogCacheKey(tenantId, null)),
    ]);

    const list = (cachedByLocation?.value || []).length
      ? cachedByLocation.value
      : (cachedGeneric?.value || []);

    if (list.length > 0) {
      return { success: true, data: list, source: 'cache' };
    }

    return {
      success: false,
      error: warm.error || 'No fue posible cargar catalogo para matching de factura.',
      data: [],
    };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

export async function searchVariantsOffline(tenantId, search, limit = 20, locationId = null) {
  try {
    const [cachedByLocation, cachedGeneric] = await Promise.all([
      getSimpleCache(catalogCacheKey(tenantId, locationId)),
      getSimpleCache(catalogCacheKey(tenantId, null)),
    ]);
    const list = (cachedByLocation?.value || []).length
      ? cachedByLocation.value
      : (cachedGeneric?.value || []);
    const q = String(search || '').trim().toLowerCase();
    if (!q) return { success: true, data: [] };

    const filtered = list
      .filter((item) => {
        const sku = String(item.sku || '').toLowerCase();
        const variantName = String(item.variant_name || '').toLowerCase();
        const productName = String(item.product?.name || '').toLowerCase();
        return sku.includes(q) || variantName.includes(q) || productName.includes(q);
      })
      .slice(0, limit);

    return { success: true, data: filtered };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

export async function searchCustomers(tenantId, search, limit = 20) {
  const q = String(search || '').trim();
  try {
    const { data, error } = await supabase
      .from('customers')
      .select('customer_id, full_name, document, phone')
      .eq('tenant_id', tenantId)
      .or(`full_name.ilike.%${q}%,document.ilike.%${q}%,phone.ilike.%${q}%`)
      .order('full_name', { ascending: true })
      .limit(limit);

    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (error) {
    const fallback = await searchCustomersOffline(tenantId, q, limit);
    if (fallback.success && fallback.data.length > 0) {
      return {
        success: true,
        data: fallback.data,
        source: 'cache',
        warning: error.message,
      };
    }
    return { success: false, error: error.message, data: [] };
  }
}

export async function warmCustomersCatalog(tenantId, limit = 5000) {
  try {
    const { data, error } = await supabase
      .from('customers')
      .select('customer_id, full_name, document, phone')
      .eq('tenant_id', tenantId)
      .order('full_name', { ascending: true })
      .limit(limit);

    if (error) throw error;
    const list = data || [];
    await saveSimpleCache(customersCacheKey(tenantId), list);
    return { success: true, data: list };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

export async function searchCustomersOffline(tenantId, search, limit = 20) {
  try {
    const cached = await getSimpleCache(customersCacheKey(tenantId));
    const list = cached?.value || [];
    const q = String(search || '').trim().toLowerCase();
    if (!q) return { success: true, data: [] };

    const filtered = list
      .filter((item) => {
        const fullName = String(item.full_name || '').toLowerCase();
        const document = String(item.document || '').toLowerCase();
        const phone = String(item.phone || '').toLowerCase();
        return fullName.includes(q) || document.includes(q) || phone.includes(q);
      })
      .slice(0, limit);

    return { success: true, data: filtered };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

export async function getTaxInfoForVariant(tenantId, variantId) {
  const cacheKey = taxInfoCacheKey(tenantId, variantId);
  try {
    const { data, error } = await supabase.rpc('fn_get_tax_info_for_variant', {
      p_tenant: tenantId,
      p_variant: variantId,
    });
    if (error) throw error;
    const normalized = {
      rate: Number(data?.rate || 0),
      code: data?.code || null,
      name: data?.name || null,
    };
    await saveSimpleCache(cacheKey, normalized);
    return {
      success: true,
      ...normalized,
      source: 'server',
    };
  } catch (error) {
    const cached = await getSimpleCache(cacheKey);
    if (cached?.value) {
      return {
        success: true,
        rate: Number(cached.value.rate || 0),
        code: cached.value.code || null,
        name: cached.value.name || null,
        source: 'cache',
        warning: error.message,
      };
    }
    return { success: false, rate: 0, code: null, name: null, error: error.message };
  }
}

export async function findVariantByCode(tenantId, code, locationId = null, { offlineMode = false } = {}) {
  const query = String(code || '').trim();
  if (!query) return { success: false, error: 'Codigo vacio', data: null };

  const normalizedCode = normalizeSearchText(query);
  const matchByFields = (list = []) => {
    const exact = list.find((item) => normalizeSearchText(item?.sku) === normalizedCode);
    if (exact) return exact;
    return list[0] || null;
  };

  if (offlineMode) {
    const cachedResult = await searchVariantsOffline(tenantId, query, 25, locationId);
    if (!cachedResult.success || !cachedResult.data?.length) {
      return { success: false, error: 'No se encontro variante por codigo en cache local.', data: null };
    }
    const found = matchByFields(cachedResult.data);
    return found
      ? { success: true, data: found, source: cachedResult.source || 'cache' }
      : { success: false, error: 'No se encontro variante por codigo en cache local.', data: null };
  }

  try {
    const { data: barcodeHit, error: barcodeErr } = await supabase
      .from('product_barcodes')
      .select('variant_id')
      .eq('tenant_id', tenantId)
      .eq('barcode', query)
      .maybeSingle();
    if (barcodeErr) throw barcodeErr;

    if (barcodeHit?.variant_id) {
      const { data: variant, error: variantErr } = await supabase
        .from('product_variants')
        .select(
          `
            variant_id, sku, variant_name, cost, price, price_includes_tax, is_active, is_component,
            product:product_id(product_id, name, is_component)
          `,
        )
        .eq('tenant_id', tenantId)
        .eq('variant_id', barcodeHit.variant_id)
        .eq('is_active', true)
        .maybeSingle();
      if (variantErr) throw variantErr;
      if (variant) return { success: true, data: variant };
    }

    const searchResult = await searchVariants(tenantId, query, 25, locationId);
    if (!searchResult.success || !searchResult.data?.length) {
      return { success: false, error: 'No se encontro variante por codigo.', data: null };
    }
    const found = matchByFields(searchResult.data);
    if (!found) {
      return { success: false, error: 'No se encontro variante por codigo.', data: null };
    }
    return { success: true, data: found, source: searchResult.source || 'server' };
  } catch (error) {
    const cachedResult = await searchVariantsOffline(tenantId, query, 25, locationId);
    if (cachedResult.success && cachedResult.data?.length) {
      const found = matchByFields(cachedResult.data);
      if (found) {
        return {
          success: true,
          data: found,
          source: 'cache',
          warning: error.message,
        };
      }
    }
    return { success: false, error: error.message, data: null };
  }
}

export async function createSale(tenantId, saleData) {
  try {
    const operationId = saleData.operation_id || null;
    let data;
    let error;

    if (operationId) {
      const idempotentResult = await supabase.rpc('sp_create_sale_idempotent', {
        p_operation_id: operationId,
        p_tenant: tenantId,
        p_location: saleData.location_id,
        p_cash_session: saleData.cash_session_id || null,
        p_customer: saleData.customer_id || null,
        p_sold_by: saleData.sold_by,
        p_lines: saleData.lines,
        p_payments: saleData.payments,
        p_note: saleData.note || null,
        p_third_party: saleData.third_party_id || null,
      });
      data = idempotentResult.data;
      error = idempotentResult.error;
    } else {
      const regularResult = await supabase.rpc('sp_create_sale', {
        p_tenant: tenantId,
        p_location: saleData.location_id,
        p_cash_session: saleData.cash_session_id || null,
        p_customer: saleData.customer_id || null,
        p_sold_by: saleData.sold_by,
        p_lines: saleData.lines,
        p_payments: saleData.payments,
        p_note: saleData.note || null,
        p_third_party: saleData.third_party_id || null,
      });
      data = regularResult.data;
      error = regularResult.error;
    }

    if (error) throw error;
    return { success: true, data: { sale_id: data } };
  } catch (error) {
    const msg = String(error?.message || '');
    if (
      saleData?.operation_id &&
      (msg.includes('sp_create_sale_idempotent') || msg.toLowerCase().includes('does not exist'))
    ) {
      return {
        success: false,
        error:
          'Falta RPC sp_create_sale_idempotent en la base de datos. Ejecuta la migracion ADD_IDEMPOTENT_MOBILE_SALES.sql.',
      };
    }
    return { success: false, error: error.message };
  }
}
