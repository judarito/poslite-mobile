import { supabase } from '../lib/supabase';
import { getSimpleCache, saveSimpleCache } from './offlineCache.service';

function activeRegistersCacheKey(tenantId) {
  return `cash-active-registers:${tenantId}`;
}

function cashSessionsCacheKey(tenantId, status = '') {
  return `cash-sessions:${tenantId}:${status || 'all'}`;
}

function cashMovementsCacheKey(tenantId, sessionId) {
  return `cash-movements:${tenantId}:${sessionId}`;
}

// ---------- Lookups ----------
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

export async function listUsers(tenantId) {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('user_id,full_name,is_active')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('full_name', { ascending: true });

    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

// ---------- Cash Registers ----------
export async function listCashRegisters({ tenantId, search = '', limit = 20, offset = 0 } = {}) {
  try {
    let query = supabase
      .from('cash_registers')
      .select('cash_register_id,tenant_id,location_id,name,is_active,location:location_id(name)', {
        count: 'exact',
      })
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true })
      .range(offset, offset + limit - 1);

    if (search && search.trim()) {
      query = query.ilike('name', `%${search.trim()}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    return { success: true, data: data || [], total: Number(count || 0) };
  } catch (error) {
    return { success: false, error: error.message, data: [], total: 0 };
  }
}

export async function listActiveCashRegisters(tenantId) {
  const cacheKey = activeRegistersCacheKey(tenantId);
  try {
    const { data, error } = await supabase
      .from('cash_registers')
      .select('cash_register_id,name,location_id,location:location_id(name)')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) throw error;
    const rows = data || [];
    await saveSimpleCache(cacheKey, rows);
    return { success: true, data: rows };
  } catch (error) {
    const cached = await getSimpleCache(cacheKey);
    if (cached?.value) {
      return { success: true, data: cached.value, source: 'cache', warning: error.message };
    }
    return { success: false, error: error.message, data: [] };
  }
}

export async function createCashRegister(payload) {
  try {
    const { data, error } = await supabase
      .from('cash_registers')
      .insert(payload)
      .select('cash_register_id,tenant_id,location_id,name,is_active')
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function updateCashRegister(registerId, tenantId, updates) {
  try {
    const { data, error } = await supabase
      .from('cash_registers')
      .update(updates)
      .eq('cash_register_id', registerId)
      .eq('tenant_id', tenantId)
      .select('cash_register_id,tenant_id,location_id,name,is_active')
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function removeCashRegister(registerId, tenantId) {
  try {
    const { error } = await supabase
      .from('cash_registers')
      .delete()
      .eq('cash_register_id', registerId)
      .eq('tenant_id', tenantId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ---------- Cash Sessions ----------
export async function listCashSessions({
  tenantId,
  status = null,
  limit = 20,
  offset = 0,
} = {}) {
  const cacheKey = cashSessionsCacheKey(tenantId, status || '');
  try {
    let query = supabase
      .from('cash_sessions')
      .select(
        `
          cash_session_id,
          tenant_id,
          cash_register_id,
          opened_by,
          opened_at,
          opening_amount,
          closed_by,
          closed_at,
          closing_amount_counted,
          closing_amount_expected,
          difference,
          status,
          cash_register:cash_register_id(name,location:location_id(name)),
          opened_by_user:opened_by(full_name),
          closed_by_user:closed_by(full_name)
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', tenantId)
      .order('opened_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    const rows = data || [];
    await saveSimpleCache(cacheKey, {
      items: rows,
      total: Number(count || 0),
      limit: Number(limit || 20),
      offset: Number(offset || 0),
    });
    return { success: true, data: rows, total: Number(count || 0) };
  } catch (error) {
    const cached = await getSimpleCache(cacheKey);
    if (cached?.value) {
      return {
        success: true,
        data: cached.value.items || [],
        total: Number(cached.value.total || 0),
        source: 'cache',
        warning: error.message,
      };
    }
    return { success: false, error: error.message, data: [], total: 0 };
  }
}

export async function openCashSession({ tenantId, cashRegisterId, userId, openingAmount = 0 }) {
  try {
    const { data, error } = await supabase
      .from('cash_sessions')
      .insert({
        tenant_id: tenantId,
        cash_register_id: cashRegisterId,
        opened_by: userId,
        opening_amount: Number(openingAmount || 0),
        status: 'OPEN',
      })
      .select('cash_session_id,tenant_id,cash_register_id,status,opened_at,opening_amount')
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function closeCashSession({
  tenantId,
  sessionId,
  userId,
  closingAmountCounted,
}) {
  try {
    const summaryResult = await getCashSessionCloseSummary({ tenantId, sessionId });
    if (!summaryResult.success) {
      throw new Error(summaryResult.error || 'No fue posible calcular resumen de cierre');
    }

    const expected = Number(summaryResult.data?.expected_cash || 0);

    const counted = Number(closingAmountCounted || 0);
    const difference = counted - expected;

    const { data, error } = await supabase
      .from('cash_sessions')
      .update({
        closed_by: userId,
        closed_at: new Date().toISOString(),
        closing_amount_counted: counted,
        closing_amount_expected: expected,
        difference,
        status: 'CLOSED',
      })
      .eq('cash_session_id', sessionId)
      .eq('tenant_id', tenantId)
      .select('cash_session_id,status,closed_at,difference,closing_amount_counted,closing_amount_expected')
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getCashSessionCloseSummary({ tenantId, sessionId }) {
  try {
    const [{ data: sessionData, error: sessionErr }, { data: sales, error: salesErr }] = await Promise.all([
      supabase
        .from('cash_sessions')
        .select('opening_amount')
        .eq('tenant_id', tenantId)
        .eq('cash_session_id', sessionId)
        .single(),
      supabase
        .from('sales')
        .select('sale_id,total')
        .eq('tenant_id', tenantId)
        .eq('cash_session_id', sessionId)
        .in('status', ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED']),
    ]);

    if (sessionErr) throw sessionErr;
    if (salesErr) throw salesErr;

    const [{ data: payments, error: paymentsErr }, { data: layawayPayments, error: layawayErr }, { data: movements, error: movesErr }] =
      await Promise.all([
        supabase
          .from('sale_payments')
          .select(
            `
              amount,
              payment_method:payment_method_id(code,name),
              sale:sale_id!inner(cash_session_id,tenant_id)
            `,
          )
          .eq('sale.tenant_id', tenantId)
          .eq('sale.cash_session_id', sessionId),
        supabase
          .from('layaway_payments')
          .select('amount,payment_method:payment_method_id(code,name)')
          .eq('tenant_id', tenantId)
          .eq('cash_session_id', sessionId),
        supabase
          .from('cash_movements')
          .select('type,amount')
          .eq('tenant_id', tenantId)
          .eq('cash_session_id', sessionId),
      ]);

    if (paymentsErr) throw paymentsErr;
    if (layawayErr) throw layawayErr;
    if (movesErr) throw movesErr;

    const sales_total = (sales || []).reduce((sum, s) => sum + Number(s.total || 0), 0);
    const sales_count = (sales || []).length;

    const layaway_total = (layawayPayments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const layaway_count = (layawayPayments || []).length;

    const paymentGroups = {};
    let cash_sales = 0;
    let layaway_cash = 0;

    (payments || []).forEach((p) => {
      const code = p.payment_method?.code || 'N/A';
      const name = p.payment_method?.name || 'Otro';
      const amount = Number(p.amount || 0);

      if (!paymentGroups[code]) paymentGroups[code] = { code, name, total: 0 };
      paymentGroups[code].total += amount;
      if (code === 'EFECTIVO' || code === 'CASH') cash_sales += amount;
    });

    (layawayPayments || []).forEach((p) => {
      const code = p.payment_method?.code || 'N/A';
      const name = p.payment_method?.name || 'Otro';
      const amount = Number(p.amount || 0);

      if (!paymentGroups[code]) paymentGroups[code] = { code, name, total: 0 };
      paymentGroups[code].total += amount;

      if (code === 'EFECTIVO' || code === 'CASH') {
        layaway_cash += amount;
        cash_sales += amount;
      }
    });

    let income_total = 0;
    let expense_total = 0;
    (movements || []).forEach((m) => {
      const amount = Number(m.amount || 0);
      if (m.type === 'INCOME') income_total += amount;
      else expense_total += amount;
    });

    const expected_cash =
      Number(sessionData?.opening_amount || 0) + cash_sales + income_total - expense_total;

    return {
      success: true,
      data: {
        sales_count,
        sales_total,
        layaway_count,
        layaway_total,
        layaway_cash,
        payments_by_method: Object.values(paymentGroups),
        cash_sales,
        income_total,
        expense_total,
        expected_cash,
      },
    };
  } catch (error) {
    return { success: false, error: error.message, data: null };
  }
}

export async function listCashMovements({ tenantId, sessionId, limit = 50, offset = 0 } = {}) {
  const cacheKey = cashMovementsCacheKey(tenantId, sessionId);
  try {
    const { data, error, count } = await supabase
      .from('cash_movements')
      .select('cash_movement_id,tenant_id,cash_session_id,type,category,amount,note,created_at,created_by_user:created_by(full_name)', {
        count: 'exact',
      })
      .eq('tenant_id', tenantId)
      .eq('cash_session_id', sessionId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    const rows = data || [];
    await saveSimpleCache(cacheKey, {
      items: rows,
      total: Number(count || 0),
      limit: Number(limit || 50),
      offset: Number(offset || 0),
    });
    return { success: true, data: rows, total: Number(count || 0) };
  } catch (error) {
    const cached = await getSimpleCache(cacheKey);
    if (cached?.value) {
      return {
        success: true,
        data: cached.value.items || [],
        total: Number(cached.value.total || 0),
        source: 'cache',
        warning: error.message,
      };
    }
    return { success: false, error: error.message, data: [], total: 0 };
  }
}

export async function createCashMovement({ tenantId, sessionId, type, category, amount, note, userId }) {
  try {
    const { data, error } = await supabase
      .from('cash_movements')
      .insert({
        tenant_id: tenantId,
        cash_session_id: sessionId,
        type,
        category: category || null,
        amount: Math.abs(Number(amount || 0)),
        note: note || null,
        created_by: userId,
      })
      .select('cash_movement_id,tenant_id,cash_session_id,type,category,amount,note,created_at')
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ---------- Cash Register Assignments ----------
export async function listCashAssignments({
  tenantId,
  userId = null,
  locationId = null,
  isActive = null,
  limit = 20,
  offset = 0,
} = {}) {
  try {
    let query = supabase
      .from('cash_register_assignments')
      .select(
        `
          assignment_id,
          tenant_id,
          cash_register_id,
          user_id,
          is_active,
          assigned_at,
          assigned_by,
          note,
          user:user_id(user_id,full_name),
          cash_register:cash_register_id(cash_register_id,name,location_id,location:location_id(location_id,name))
        `,
        { count: 'exact' },
      )
      .eq('tenant_id', tenantId)
      .order('assigned_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (userId) query = query.eq('user_id', userId);
    if (typeof isActive === 'boolean') query = query.eq('is_active', isActive);

    const { data, error, count } = await query;
    if (error) throw error;

    const rows = (data || [])
      .map((item) => ({
        assignment_id: item.assignment_id,
        tenant_id: item.tenant_id,
        cash_register_id: item.cash_register_id,
        cash_register_name: item.cash_register?.name || '',
        location_id: item.cash_register?.location_id || null,
        location_name: item.cash_register?.location?.name || '',
        user_id: item.user_id,
        user_name: item.user?.full_name || '',
        is_active: item.is_active,
        assigned_at: item.assigned_at,
        note: item.note,
      }))
      .filter((row) => (locationId ? row.location_id === locationId : true));

    return { success: true, data: rows, total: Number(count || 0) };
  } catch (error) {
    return { success: false, error: error.message, data: [], total: 0 };
  }
}

export async function assignCashRegisterToUser({
  tenantId,
  cashRegisterId,
  userId,
  assignedBy,
  isActive = true,
  note = null,
}) {
  try {
    const { error } = await supabase.rpc('sp_assign_cash_register_to_user', {
      p_tenant: tenantId,
      p_cash_register: cashRegisterId,
      p_user: userId,
      p_assigned_by: assignedBy,
      p_is_active: isActive,
      p_note: note,
    });

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ---------- Payment Methods ----------
export async function listPaymentMethods({ tenantId, search = '', limit = 20, offset = 0 } = {}) {
  try {
    let query = supabase
      .from('payment_methods')
      .select('payment_method_id,tenant_id,code,name,is_active,sort_order', { count: 'exact' })
      .eq('tenant_id', tenantId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
      .range(offset, offset + limit - 1);

    if (search && search.trim()) {
      query = query.or(`name.ilike.%${search.trim()}%,code.ilike.%${search.trim()}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    return { success: true, data: data || [], total: Number(count || 0) };
  } catch (error) {
    return { success: false, error: error.message, data: [], total: 0 };
  }
}

export async function createPaymentMethod(payload) {
  try {
    const { data, error } = await supabase
      .from('payment_methods')
      .insert({
        ...payload,
        code: String(payload.code || '').toUpperCase(),
      })
      .select('payment_method_id,tenant_id,code,name,is_active,sort_order')
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function updatePaymentMethod(paymentMethodId, tenantId, updates) {
  try {
    const next = {
      ...updates,
    };
    if (next.code) next.code = String(next.code).toUpperCase();

    const { data, error } = await supabase
      .from('payment_methods')
      .update(next)
      .eq('payment_method_id', paymentMethodId)
      .eq('tenant_id', tenantId)
      .select('payment_method_id,tenant_id,code,name,is_active,sort_order')
      .single();

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function removePaymentMethod(paymentMethodId, tenantId) {
  try {
    const { error } = await supabase
      .from('payment_methods')
      .delete()
      .eq('payment_method_id', paymentMethodId)
      .eq('tenant_id', tenantId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
