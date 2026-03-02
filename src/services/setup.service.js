import { supabase } from '../lib/supabase';
import { getSimpleCache, saveSimpleCache } from './offlineCache.service';

const DEFAULT_PAGE_SIZE = 20;

const DEFAULT_SETTINGS = {
  business_name: '',
  business_address: '',
  business_phone: '',
  logo_url: '',
  receipt_footer: '',
  default_tax_included: false,
  default_page_size: DEFAULT_PAGE_SIZE,
  theme: 'light',
  date_format: 'DD/MM/YYYY',
  locale: 'es-CO',
  session_timeout_minutes: 60,
  ai_forecast_days_back: 90,
  ai_purchase_suggestion_days: 14,
  ai_purchase_advisor_enabled: true,
  ai_sales_forecast_enabled: true,
  expiry_alert_days: 30,
  reserve_stock_on_layaway: true,
  max_discount_without_auth: 5,
  rounding_method: 'normal',
  rounding_multiple: 100,
  cash_session_max_hours: 24,
  invoice_prefix: 'FAC',
  next_invoice_number: 1,
  electronic_invoicing_enabled: false,
  print_format: 'thermal',
  thermal_paper_width: 80,
  email_alerts_enabled: false,
  alert_email: '',
  notify_low_stock: true,
  notify_expiring_products: true,
};

const DEFAULT_TENANT = {
  name: '',
  tax_id: '',
  currency_code: 'COP',
  dv: '',
  trade_name: '',
  tax_regime: '',
  is_responsible_for_iva: false,
  obligated_accounting: false,
  ciiu_code: '',
  fiscal_email: '',
  fiscal_phone: '',
  address: '',
  city: '',
  department: '',
  country_code: 'CO',
  postal_code: '',
  city_code: '',
};

function parseMissingColumn(errorMessage = '') {
  const text = String(errorMessage || '');
  const match = text.match(/Could not find the '([^']+)' column/i);
  return match?.[1] || null;
}

function normalizeTenantSettings(data = {}) {
  const raw = { ...DEFAULT_SETTINGS, ...(data || {}) };
  const pageSize = Number(raw.default_page_size || DEFAULT_PAGE_SIZE);
  return {
    ...raw,
    default_page_size: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : DEFAULT_PAGE_SIZE,
  };
}

function normalizeTenantData(data = {}) {
  return {
    ...DEFAULT_TENANT,
    ...(data || {}),
  };
}

export async function getTenantConfig(tenantId, { offlineMode = false } = {}) {
  if (!tenantId) {
    return {
      success: false,
      error: 'tenantId es requerido',
      data: { settings: normalizeTenantSettings(), tenant: normalizeTenantData() },
    };
  }
  const cacheKey = `tenant-config:${tenantId}`;

  if (offlineMode) {
    const cached = await getSimpleCache(cacheKey);
    if (cached?.value) {
      return {
        success: true,
        data: {
          settings: normalizeTenantSettings(cached.value.settings),
          tenant: normalizeTenantData(cached.value.tenant),
        },
        source: 'cache',
      };
    }
    return {
      success: true,
      data: { settings: normalizeTenantSettings(), tenant: normalizeTenantData() },
      source: 'default',
    };
  }

  try {
    const [{ data: settings, error: settingsError }, { data: tenant, error: tenantError }] =
      await Promise.all([
        supabase.from('tenant_settings').select('*').eq('tenant_id', tenantId).maybeSingle(),
        supabase.from('tenants').select('*').eq('tenant_id', tenantId).single(),
      ]);

    if (settingsError) throw settingsError;
    if (tenantError) throw tenantError;

    const normalized = {
      settings: normalizeTenantSettings(settings),
      tenant: normalizeTenantData(tenant),
    };
    await saveSimpleCache(cacheKey, normalized);
    return { success: true, data: normalized, source: 'server' };
  } catch (error) {
    const cached = await getSimpleCache(cacheKey);
    if (cached?.value) {
      return {
        success: true,
        data: {
          settings: normalizeTenantSettings(cached.value.settings),
          tenant: normalizeTenantData(cached.value.tenant),
        },
        source: 'cache',
      };
    }
    return {
      success: false,
      error: error.message,
      data: { settings: normalizeTenantSettings(), tenant: normalizeTenantData() },
    };
  }
}

export async function saveTenantConfig(tenantId, payload) {
  try {
    const settingsBody = {
      tenant_id: tenantId,
      business_name: payload.settings?.business_name || null,
      business_address: payload.settings?.business_address || null,
      business_phone: payload.settings?.business_phone || null,
      logo_url: payload.settings?.logo_url || null,
      receipt_footer: payload.settings?.receipt_footer || null,
      default_tax_included: Boolean(payload.settings?.default_tax_included),
      default_page_size: Number(payload.settings?.default_page_size || DEFAULT_PAGE_SIZE),
      theme: payload.settings?.theme || 'light',
      date_format: payload.settings?.date_format || 'DD/MM/YYYY',
      locale: payload.settings?.locale || 'es-CO',
      session_timeout_minutes: Number(payload.settings?.session_timeout_minutes || 60),
      ai_forecast_days_back: Number(payload.settings?.ai_forecast_days_back || 90),
      ai_purchase_suggestion_days: Number(payload.settings?.ai_purchase_suggestion_days || 14),
      ai_purchase_advisor_enabled: payload.settings?.ai_purchase_advisor_enabled !== false,
      ai_sales_forecast_enabled: payload.settings?.ai_sales_forecast_enabled !== false,
      expiry_alert_days: Number(payload.settings?.expiry_alert_days || 30),
      reserve_stock_on_layaway: payload.settings?.reserve_stock_on_layaway !== false,
      max_discount_without_auth: Number(payload.settings?.max_discount_without_auth || 5),
      rounding_method: payload.settings?.rounding_method || 'normal',
      rounding_multiple: Number(payload.settings?.rounding_multiple || 100),
      cash_session_max_hours: Number(payload.settings?.cash_session_max_hours || 24),
      invoice_prefix: payload.settings?.invoice_prefix || 'FAC',
      next_invoice_number: Number(payload.settings?.next_invoice_number || 1),
      electronic_invoicing_enabled: Boolean(payload.settings?.electronic_invoicing_enabled),
      print_format: payload.settings?.print_format || 'thermal',
      thermal_paper_width: Number(payload.settings?.thermal_paper_width || 80),
      email_alerts_enabled: Boolean(payload.settings?.email_alerts_enabled),
      alert_email: payload.settings?.alert_email || null,
      notify_low_stock: payload.settings?.notify_low_stock !== false,
      notify_expiring_products: payload.settings?.notify_expiring_products !== false,
      updated_at: new Date().toISOString(),
    };

    const tenantBody = {
      name: payload.tenant?.name || '',
      tax_id: payload.tenant?.tax_id || null,
      currency_code: payload.tenant?.currency_code || 'COP',
      dv: payload.tenant?.dv || null,
      trade_name: payload.tenant?.trade_name || null,
      tax_regime: payload.tenant?.tax_regime || null,
      is_responsible_for_iva: Boolean(payload.tenant?.is_responsible_for_iva),
      obligated_accounting: Boolean(payload.tenant?.obligated_accounting),
      ciiu_code: payload.tenant?.ciiu_code || null,
      fiscal_email: payload.tenant?.fiscal_email || null,
      fiscal_phone: payload.tenant?.fiscal_phone || null,
      address: payload.tenant?.address || null,
      city: payload.tenant?.city || null,
      department: payload.tenant?.department || null,
      country_code: payload.tenant?.country_code || 'CO',
      postal_code: payload.tenant?.postal_code || null,
      city_code: payload.tenant?.city_code || null,
      updated_at: new Date().toISOString(),
    };

    // Compatibilidad con instalaciones donde faltan columnas nuevas en tenant_settings.
    // Si PostgREST devuelve "Could not find the 'x' column", quitamos ese campo y reintentamos.
    const settingsPayload = { ...settingsBody };
    let settingsSaved = null;
    let settingsError = null;
    const missingColumns = new Set();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await supabase
        .from('tenant_settings')
        .upsert(settingsPayload, { onConflict: 'tenant_id' })
        .select('*')
        .single();
      settingsSaved = response.data || null;
      settingsError = response.error || null;
      if (!settingsError) break;

      const missingColumn = parseMissingColumn(settingsError.message);
      if (!missingColumn || missingColumns.has(missingColumn) || !(missingColumn in settingsPayload)) {
        break;
      }
      missingColumns.add(missingColumn);
      delete settingsPayload[missingColumn];
    }

    const tenantPayload = { ...tenantBody };
    let tenantSaved = null;
    let tenantError = null;
    const tenantMissingColumns = new Set();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await supabase
        .from('tenants')
        .update(tenantPayload)
        .eq('tenant_id', tenantId)
        .select('*')
        .single();
      tenantSaved = response.data || null;
      tenantError = response.error || null;
      if (!tenantError) break;

      const missingColumn = parseMissingColumn(tenantError.message);
      if (!missingColumn || tenantMissingColumns.has(missingColumn) || !(missingColumn in tenantPayload)) {
        break;
      }
      tenantMissingColumns.add(missingColumn);
      delete tenantPayload[missingColumn];
    }

    if (settingsError) throw settingsError;
    if (tenantError) throw tenantError;

    const normalized = {
      settings: normalizeTenantSettings(settingsSaved),
      tenant: normalizeTenantData(tenantSaved),
    };
    await saveSimpleCache(`tenant-config:${tenantId}`, normalized);
    return { success: true, data: normalized };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getAboutSummary(tenantId) {
  if (!tenantId) return { success: false, error: 'tenantId es requerido', data: null };

  try {
    const [
      { count: productsCount, error: pErr },
      { count: salesCount, error: sErr },
      { count: customersCount, error: cErr },
      { count: locationsCount, error: lErr },
    ] = await Promise.all([
      supabase.from('products').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      supabase.from('sales').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      supabase.from('customers').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      supabase.from('locations').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    ]);

    if (pErr) throw pErr;
    if (sErr) throw sErr;
    if (cErr) throw cErr;
    if (lErr) throw lErr;

    return {
      success: true,
      data: {
        products: Number(productsCount || 0),
        sales: Number(salesCount || 0),
        customers: Number(customersCount || 0),
        locations: Number(locationsCount || 0),
      },
    };
  } catch (error) {
    return { success: false, error: error.message, data: null };
  }
}

export async function listLocationsConfig({ tenantId, search = '', limit = 20, offset = 0 } = {}) {
  try {
    let query = supabase
      .from('locations')
      .select('location_id,tenant_id,name,type,address,is_active', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true })
      .range(offset, offset + limit - 1);

    if (search?.trim()) {
      const text = search.trim();
      query = query.or(`name.ilike.%${text}%,address.ilike.%${text}%,type.ilike.%${text}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    return { success: true, data: data || [], total: Number(count || 0) };
  } catch (error) {
    return { success: false, error: error.message, data: [], total: 0 };
  }
}

export async function createLocationConfig(payload) {
  try {
    const { data, error } = await supabase
      .from('locations')
      .insert({
        tenant_id: payload.tenant_id,
        name: payload.name,
        type: payload.type || 'STORE',
        address: payload.address || null,
        is_active: payload.is_active !== false,
      })
      .select('location_id,tenant_id,name,type,address,is_active')
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function updateLocationConfig(locationId, tenantId, updates) {
  try {
    const { data, error } = await supabase
      .from('locations')
      .update({
        name: updates.name,
        type: updates.type || 'STORE',
        address: updates.address || null,
        is_active: updates.is_active !== false,
      })
      .eq('tenant_id', tenantId)
      .eq('location_id', locationId)
      .select('location_id,tenant_id,name,type,address,is_active')
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function removeLocationConfig(locationId, tenantId) {
  try {
    const { error } = await supabase
      .from('locations')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('location_id', locationId);
    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function listTaxesConfig({ tenantId, search = '', limit = 20, offset = 0 } = {}) {
  try {
    let query = supabase
      .from('taxes')
      .select('tax_id,tenant_id,code,name,rate,is_active', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true })
      .range(offset, offset + limit - 1);

    if (search?.trim()) {
      const text = search.trim();
      query = query.or(`name.ilike.%${text}%,code.ilike.%${text}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    return { success: true, data: data || [], total: Number(count || 0) };
  } catch (error) {
    return { success: false, error: error.message, data: [], total: 0 };
  }
}

export async function createTaxConfig(payload) {
  try {
    const { data, error } = await supabase
      .from('taxes')
      .insert({
        tenant_id: payload.tenant_id,
        code: String(payload.code || '').toUpperCase(),
        name: payload.name,
        rate: Number(payload.rate || 0),
        is_active: payload.is_active !== false,
      })
      .select('tax_id,tenant_id,code,name,rate,is_active')
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function updateTaxConfig(taxId, tenantId, updates) {
  try {
    const { data, error } = await supabase
      .from('taxes')
      .update({
        code: String(updates.code || '').toUpperCase(),
        name: updates.name,
        rate: Number(updates.rate || 0),
        is_active: updates.is_active !== false,
      })
      .eq('tenant_id', tenantId)
      .eq('tax_id', taxId)
      .select('tax_id,tenant_id,code,name,rate,is_active')
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function removeTaxConfig(taxId, tenantId) {
  try {
    const { error } = await supabase
      .from('taxes')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('tax_id', taxId);
    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
