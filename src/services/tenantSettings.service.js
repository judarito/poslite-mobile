import { supabase } from '../lib/supabase';
import { getSimpleCache, saveSimpleCache } from './offlineCache.service';

const DEFAULT_PAGE_SIZE = 20;

function normalizeSettings(data) {
  const raw = data || {};
  const pageSize = Number(raw.default_page_size || DEFAULT_PAGE_SIZE);
  const themeRaw = String(raw.theme || '').trim().toLowerCase();
  const theme = themeRaw === 'light' || themeRaw === 'auto' ? themeRaw : 'dark';
  return {
    ...raw,
    theme,
    default_page_size: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : DEFAULT_PAGE_SIZE,
  };
}

export async function setCachedTenantTheme(tenantId, theme) {
  if (!tenantId) return { success: false, error: 'tenantId es requerido' };
  const cacheKey = `tenant-settings:${tenantId}`;
  const cached = await getSimpleCache(cacheKey);
  const normalized = normalizeSettings(cached?.value || {});
  const next = {
    ...normalized,
    theme: theme || 'dark',
  };
  await saveSimpleCache(cacheKey, next);
  return { success: true, data: next };
}

export async function getTenantSettings(tenantId, { offlineMode = false } = {}) {
  if (!tenantId) {
    return {
      success: false,
      error: 'tenantId es requerido',
      data: normalizeSettings(null),
      source: 'default',
    };
  }

  const cacheKey = `tenant-settings:${tenantId}`;

  if (offlineMode) {
    const cached = await getSimpleCache(cacheKey);
    if (cached?.value) {
      return { success: true, data: normalizeSettings(cached.value), source: 'cache' };
    }
    return { success: true, data: normalizeSettings(null), source: 'default' };
  }

  try {
    const { data, error } = await supabase
      .from('tenant_settings')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error) throw error;

    const normalized = normalizeSettings(data);
    await saveSimpleCache(cacheKey, normalized);

    return { success: true, data: normalized, source: 'server' };
  } catch (error) {
    const cached = await getSimpleCache(cacheKey);
    if (cached?.value) {
      return { success: true, data: normalizeSettings(cached.value), source: 'cache' };
    }
    return {
      success: false,
      error: error.message,
      data: normalizeSettings(null),
      source: 'default',
    };
  }
}
