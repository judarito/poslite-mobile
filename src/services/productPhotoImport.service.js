import { supabase } from '../lib/supabase';

const PHOTO_PARSER_EDGE_FUNCTION =
  process.env.EXPO_PUBLIC_PRODUCT_PHOTO_PARSER_EDGE_FUNCTION || 'product-photo-parser';

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeBool(value, defaultValue = false) {
  if (value === true || value === 'TRUE' || value === 'true' || value === 1) return true;
  if (value === false || value === 'FALSE' || value === 'false' || value === 0) return false;
  return defaultValue;
}

function normalizeInventoryBehavior(value) {
  const raw = String(value || 'REVENTA').trim().toUpperCase();
  const map = {
    RESELL: 'RESELL',
    REVENTA: 'RESELL',
    MANUFACTURED: 'MANUFACTURED',
    MANUFACTURA: 'MANUFACTURED',
    SERVICE: 'SERVICE',
    SERVICIO: 'SERVICE',
    BUNDLE: 'BUNDLE',
    COMBO: 'BUNDLE',
  };
  return map[raw] || 'RESELL';
}

function normalizeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function findOrCreateCategoryByName(tenantId, categoryName) {
  const name = normalizeText(categoryName);
  if (!name) return null;

  const { data: existing, error: searchError } = await supabase
    .from('categories')
    .select('category_id')
    .eq('tenant_id', tenantId)
    .ilike('name', name)
    .limit(1);

  if (searchError) throw searchError;
  if (existing?.length) return existing[0].category_id;

  const { data: created, error: createError } = await supabase
    .from('categories')
    .insert({
      tenant_id: tenantId,
      name,
      parent_category_id: null,
    })
    .select('category_id')
    .single();

  if (createError) throw createError;
  return created?.category_id || null;
}

async function resolveUnitId(tenantId, unitCode) {
  const code = normalizeText(unitCode).toUpperCase();
  if (!code) return null;

  const { data, error } = await supabase
    .from('units_of_measure')
    .select('unit_id')
    .eq('is_active', true)
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
    .ilike('code', code)
    .order('is_system', { ascending: false })
    .limit(1);

  if (error) throw error;
  return data?.[0]?.unit_id || null;
}

async function resolveLocationIdByName(tenantId, locationName) {
  const value = normalizeText(locationName);
  if (!value) return null;

  const { data, error } = await supabase
    .from('locations')
    .select('location_id')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .ilike('name', value)
    .limit(1);

  if (error) throw error;
  return data?.[0]?.location_id || null;
}

function generateSku(value) {
  const normalized = String(value || 'PRD')
    .trim()
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 3)
    .toUpperCase();
  const suffix = Math.floor(Math.random() * 900000) + 100000;
  return `${normalized || 'PRD'}-${suffix}`;
}

async function upsertSimpleProduct(tenantId, row, defaults = {}) {
  const productName = normalizeText(row.product_name);
  if (!productName) {
    throw new Error('product_name es obligatorio');
  }

  const variantName = normalizeText(row.variant_name || defaults.variant_name || 'Predeterminada');
  const description = normalizeText(row.description || row.notes || null) || null;
  const isActive = normalizeBool(row.is_active, true);
  const requiresExpiration = normalizeBool(row.control_expiration, false);
  const isComponent = normalizeBool(row.is_component, false);
  const unitPrice = normalizeNumber(row.unit_price, 0);
  const unitCost = normalizeNumber(row.unit_cost, 0);
  const initialStock = normalizeNumber(row.initial_stock, 0);
  const priceIncludesTax = normalizeBool(row.price_includes_tax, false);
  const inventoryBehavior = normalizeInventoryBehavior(row.inventory_type || defaults.inventory_type || 'REVENTA');
  const unitCode = normalizeText(row.unit_code || defaults.unit_code || '');
  const locationCode = normalizeText(row.location_code || defaults.location_code || '');

  const [categoryId, unitId] = await Promise.all([
    findOrCreateCategoryByName(tenantId, row.category_name || defaults.category_name || null),
    resolveUnitId(tenantId, unitCode),
  ]);

  const { data: existingProducts, error: findProductError } = await supabase
    .from('products')
    .select('product_id')
    .eq('tenant_id', tenantId)
    .ilike('name', productName)
    .limit(1);

  if (findProductError) throw findProductError;

  const productPayload = {
    name: productName,
    description,
    category_id: categoryId,
    unit_id: unitId,
    is_active: isActive,
    track_inventory: true,
    requires_expiration: requiresExpiration,
    inventory_behavior: inventoryBehavior,
    is_component: isComponent,
  };

  let productId = existingProducts?.[0]?.product_id || null;
  let productCreated = false;

  if (productId) {
    const { error: updateProductError } = await supabase
      .from('products')
      .update(productPayload)
      .eq('tenant_id', tenantId)
      .eq('product_id', productId);
    if (updateProductError) throw updateProductError;
  } else {
    const { data: createdProduct, error: createProductError } = await supabase
      .from('products')
      .insert({
        tenant_id: tenantId,
        ...productPayload,
      })
      .select('product_id')
      .single();
    if (createProductError) throw createProductError;
    productId = createdProduct?.product_id || null;
    productCreated = true;
  }

  if (!productId) {
    throw new Error(`No se pudo resolver product_id para "${productName}"`);
  }

  let variantQuery = await supabase
    .from('product_variants')
    .select('variant_id, sku')
    .eq('tenant_id', tenantId)
    .eq('product_id', productId)
    .ilike('variant_name', variantName)
    .limit(1);

  if (variantQuery.error) throw variantQuery.error;
  if (!variantQuery.data?.length) {
    variantQuery = await supabase
      .from('product_variants')
      .select('variant_id, sku')
      .eq('tenant_id', tenantId)
      .eq('product_id', productId)
      .limit(1);
    if (variantQuery.error) throw variantQuery.error;
  }

  const variantPayload = {
    variant_name: variantName,
    cost: unitCost,
    price: unitPrice,
    price_includes_tax: priceIncludesTax,
    is_active: isActive,
    requires_expiration: requiresExpiration,
    unit_id: unitId,
  };

  let variantId = variantQuery.data?.[0]?.variant_id || null;
  if (variantId) {
    const { error: updateVariantError } = await supabase
      .from('product_variants')
      .update({
        ...variantPayload,
        sku: variantQuery.data?.[0]?.sku || generateSku(productName),
      })
      .eq('tenant_id', tenantId)
      .eq('variant_id', variantId);
    if (updateVariantError) throw updateVariantError;
  } else {
    const { data: createdVariant, error: createVariantError } = await supabase
      .from('product_variants')
      .insert({
        tenant_id: tenantId,
        product_id: productId,
        sku: generateSku(productName),
        ...variantPayload,
      })
      .select('variant_id')
      .single();
    if (createVariantError) throw createVariantError;
    variantId = createdVariant?.variant_id || null;
  }

  const warnings = [];
  if (initialStock > 0 && locationCode && variantId) {
    const locationId = await resolveLocationIdByName(tenantId, locationCode);
    if (!locationId) {
      warnings.push(`Ubicacion "${locationCode}" no encontrada para stock inicial.`);
    } else {
      const { error: moveError } = await supabase
        .from('inventory_moves')
        .insert({
          tenant_id: tenantId,
          move_type: 'INITIAL_STOCK',
          location_id: locationId,
          variant_id: variantId,
          quantity: initialStock,
          unit_cost: unitCost,
          source: 'BULK_IMPORT',
          note: 'Stock inicial via carga por foto',
        });
      if (moveError) throw moveError;

      const { error: rpcError } = await supabase.rpc('fn_apply_stock_delta', {
        p_tenant: tenantId,
        p_location: locationId,
        p_variant: variantId,
        p_delta: initialStock,
      });
      if (rpcError) throw rpcError;
    }
  }

  return {
    product_id: productId,
    variant_id: variantId,
    product_created: productCreated,
    warnings,
  };
}

async function extractInvokeError(error) {
  const fragments = [];
  if (error?.message) fragments.push(String(error.message));
  const context = error?.context;
  if (!context) return fragments.join(' | ') || 'Error desconocido';

  try {
    const response = typeof context.clone === 'function' ? context.clone() : context;
    if (response?.status) fragments.push(`HTTP ${response.status}`);
    let bodyJson = null;
    if (typeof response?.json === 'function') {
      bodyJson = await response.json().catch(() => null);
    }
    if (bodyJson?.error) fragments.push(String(bodyJson.error));
    if (bodyJson?.details) fragments.push(String(bodyJson.details));
  } catch (_e) {
    // no-op
  }

  const unique = Array.from(new Set(fragments.filter(Boolean)));
  return unique.join(' | ') || 'Error desconocido';
}

export async function parseProductsFromPhoto({ tenantId, imageBase64, mimeType = 'image/jpeg' }) {
  if (!tenantId) return { success: false, error: 'tenantId es requerido.' };
  if (!imageBase64) return { success: false, error: 'imageBase64 es requerido.' };

  const { data, error } = await supabase.functions.invoke(PHOTO_PARSER_EDGE_FUNCTION, {
    body: {
      image: imageBase64,
      mime_type: mimeType,
      model: process.env.EXPO_PUBLIC_DEEPSEEK_TEXT_MODEL || 'deepseek-chat',
      temperature: 0.1,
      max_tokens: 2200,
    },
  });

  if (error) {
    const details = await extractInvokeError(error);
    return { success: false, error: `Error invocando ${PHOTO_PARSER_EDGE_FUNCTION}: ${details}` };
  }

  const products = Array.isArray(data?.products) ? data.products : [];
  return {
    success: true,
    data: {
      products: products
        .map((item) => ({
          product_name: normalizeText(item?.product_name),
          variant_name: normalizeText(item?.variant_name || 'Predeterminada'),
          category_name: normalizeText(item?.category_name || ''),
          unit_price: item?.unit_price == null ? null : normalizeNumber(item.unit_price, 0),
          unit_cost: item?.unit_cost == null ? null : normalizeNumber(item.unit_cost, 0),
          initial_stock: item?.initial_stock == null ? null : normalizeNumber(item.initial_stock, 0),
          notes: normalizeText(item?.notes || ''),
          confidence: Number(item?.confidence || 0),
        }))
        .filter((item) => item.product_name),
      warnings: Array.isArray(data?.warnings) ? data.warnings : [],
      ocr_text: data?.ocr_text || null,
      usage: data?.usage || null,
      model: data?.model || null,
    },
  };
}

export async function importProductsFromRows({
  tenantId,
  rows,
  defaults = {},
}) {
  if (!tenantId) return { success: false, error: 'tenantId es requerido.' };

  const source = Array.isArray(rows) ? rows : [];
  const normalizedRows = source
    .map((row) => ({
      ...row,
      product_name: normalizeText(row?.product_name),
    }))
    .filter((row) => row.product_name);

  if (!normalizedRows.length) {
    return { success: false, error: 'No hay filas validas para importar.' };
  }

  let processed = 0;
  let created = 0;
  let failed = 0;
  const errors = [];
  const warnings = [];

  for (let i = 0; i < normalizedRows.length; i += 1) {
    const row = normalizedRows[i];
    try {
      const result = await upsertSimpleProduct(tenantId, row, defaults);
      processed += 1;
      if (result.product_created) created += 1;
      if (Array.isArray(result.warnings) && result.warnings.length) {
        for (const warning of result.warnings) {
          warnings.push(`Fila ${i + 1}: ${warning}`);
        }
      }
    } catch (error) {
      failed += 1;
      errors.push({
        row: i + 1,
        product_name: row.product_name,
        message: String(error?.message || 'Error desconocido'),
      });
    }
  }

  return {
    success: failed === 0,
    data: {
      processed,
      created,
      updated: Math.max(0, processed - created),
      failed,
      errors,
      warnings,
    },
    error: failed > 0 ? `Importacion parcial: ${processed} ok, ${failed} con error.` : null,
  };
}
