import { supabase } from '../lib/supabase';

export async function listLocations(tenantId) {
  try {
    const { data, error } = await supabase
      .from('locations')
      .select('location_id,name')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

export async function listStockBalances({
  tenantId,
  locationId = null,
  isComponent = false,
  limit = 20,
  offset = 0,
} = {}) {
  try {
    let query = supabase
      .from('stock_balances')
      .select(
        `
          tenant_id,
          location_id,
          variant_id,
          on_hand,
          reserved,
          updated_at,
          location:location_id(name),
          variant:variant_id(
            sku,
            variant_name,
            cost,
            min_stock,
            is_component,
            product:product_id(name,is_component)
          )
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (locationId) {
      query = query.eq('location_id', locationId);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const rows = (data || []).filter((item) => {
      const effectiveIsComponent =
        item.variant?.is_component !== null && item.variant?.is_component !== undefined
          ? item.variant?.is_component
          : item.variant?.product?.is_component || false;
      return Boolean(effectiveIsComponent) === Boolean(isComponent);
    });

    return { success: true, data: rows, total: Number(count || 0) };
  } catch (error) {
    return { success: false, error: error.message, data: [], total: 0 };
  }
}

export async function listInventoryMoves({
  tenantId,
  locationId = null,
  moveType = null,
  limit = 20,
  offset = 0,
} = {}) {
  try {
    let query = supabase
      .from('inventory_moves')
      .select(
        `
          inventory_move_id,
          tenant_id,
          move_type,
          location_id,
          to_location_id,
          variant_id,
          quantity,
          unit_cost,
          note,
          source,
          source_id,
          created_at,
          location:location_id(name),
          to_location:to_location_id(name),
          variant:variant_id(sku,variant_name,product:product_id(name)),
          created_by_user:created_by(full_name)
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (locationId) {
      query = query.eq('location_id', locationId);
    }
    if (moveType) {
      query = query.eq('move_type', moveType);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    return { success: true, data: data || [], total: Number(count || 0) };
  } catch (error) {
    return { success: false, error: error.message, data: [], total: 0 };
  }
}

export async function listBatches({
  tenantId,
  locationId = null,
  alertLevel = null,
  limit = 20,
  offset = 0,
} = {}) {
  try {
    let query = supabase
      .from('inventory_batches')
      .select(
        `
          batch_id,
          tenant_id,
          location_id,
          variant_id,
          batch_number,
          expiration_date,
          on_hand,
          reserved,
          unit_cost,
          is_active,
          received_at,
          physical_location,
          notes,
          location:location_id(name),
          variant:variant_id(
            sku,
            variant_name,
            product:product_id(name,requires_expiration)
          )
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', tenantId)
      .order('expiration_date', { ascending: true, nullsFirst: false })
      .order('received_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (locationId) {
      query = query.eq('location_id', locationId);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const today = new Date();
    const rows = (data || []).filter((row) => {
      if (!alertLevel) return true;
      if (!row.expiration_date) return alertLevel === 'NO_EXP';
      const exp = new Date(`${row.expiration_date}T00:00:00`);
      const diffDays = Math.floor((exp.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
      if (alertLevel === 'EXPIRED') return diffDays < 0;
      if (alertLevel === 'CRITICAL') return diffDays >= 0 && diffDays <= 7;
      if (alertLevel === 'WARNING') return diffDays > 7 && diffDays <= 30;
      if (alertLevel === 'OK') return diffDays > 30;
      return true;
    });

    return { success: true, data: rows, total: Number(count || 0) };
  } catch (error) {
    return { success: false, error: error.message, data: [], total: 0 };
  }
}

export async function listPurchases({
  tenantId,
  locationId = null,
  limit = 20,
  offset = 0,
} = {}) {
  try {
    let query = supabase
      .from('inventory_moves')
      .select(
        `
          inventory_move_id,
          tenant_id,
          move_type,
          location_id,
          variant_id,
          quantity,
          unit_cost,
          note,
          created_at,
          location:location_id(name),
          variant:variant_id(
            sku,
            variant_name,
            price,
            product:product_id(name)
          ),
          created_by_user:created_by(full_name)
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', tenantId)
      .eq('move_type', 'PURCHASE_IN')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (locationId) {
      query = query.eq('location_id', locationId);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const rows = (data || []).map((item) => ({
      purchase_id: item.inventory_move_id,
      sku: item.variant?.sku || '',
      variant_name: item.variant?.variant_name || '',
      product_name: item.variant?.product?.name || '',
      location_name: item.location?.name || '',
      quantity: Number(item.quantity || 0),
      unit_cost: Number(item.unit_cost || 0),
      line_total: Number(item.quantity || 0) * Number(item.unit_cost || 0),
      purchased_at: item.created_at,
      purchased_by_name: item.created_by_user?.full_name || '',
      note: item.note,
      current_price: Number(item.variant?.price || 0),
    }));

    return { success: true, data: rows, total: Number(count || 0) };
  } catch (error) {
    return { success: false, error: error.message, data: [], total: 0 };
  }
}

export async function listProductionOrders({
  tenantId,
  status = null,
  locationId = null,
  limit = 20,
  offset = 0,
} = {}) {
  try {
    let query = supabase
      .from('production_orders')
      .select(
        `
          production_order_id,
          tenant_id,
          order_number,
          bom_id,
          location_id,
          status,
          quantity_planned,
          quantity_produced,
          scheduled_start,
          started_at,
          completed_at,
          notes,
          created_at,
          location:location_id(name),
          bom:bom_id(
            bom_id,
            bom_name,
            product:product_id(name),
            variant:variant_id(sku,variant_name)
          )
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('status', status);
    }
    if (locationId) {
      query = query.eq('location_id', locationId);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    return { success: true, data: data || [], total: Number(count || 0) };
  } catch (error) {
    return { success: false, error: error.message, data: [], total: 0 };
  }
}

export async function listBoms({ tenantId, type = null, search = '', limit = 20, offset = 0 } = {}) {
  try {
    let query = supabase
      .from('bill_of_materials')
      .select(
        `
          bom_id,
          tenant_id,
          product_id,
          variant_id,
          bom_name,
          version,
          is_active,
          notes,
          created_at,
          product:product_id(product_id,name),
          variant:variant_id(variant_id,sku,variant_name),
          bom_components(component_id)
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (search && search.trim()) {
      query = query.or(`bom_name.ilike.%${search.trim()}%,notes.ilike.%${search.trim()}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    const filtered = (data || []).filter((row) => {
      if (!type) return true;
      if (type === 'product') return Boolean(row.product_id);
      if (type === 'variant') return Boolean(row.variant_id);
      return true;
    });

    return { success: true, data: filtered, total: Number(count || 0) };
  } catch (error) {
    return { success: false, error: error.message, data: [], total: 0 };
  }
}
