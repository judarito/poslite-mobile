import { supabase } from '../lib/supabase';

export async function getPortfolioSummary(tenantId) {
  if (!tenantId) {
    return { success: false, error: 'tenantId es requerido', data: null };
  }

  try {
    const { data, error } = await supabase
      .from('customer_credit_accounts')
      .select('credit_limit, current_balance, is_active')
      .eq('tenant_id', tenantId)
      .eq('is_active', true);

    if (error) throw error;

    const rows = data || [];
    const summary = {
      total_accounts: rows.length,
      total_debt: rows.reduce((s, r) => s + (parseFloat(r.current_balance) || 0), 0),
      total_limit: rows.reduce((s, r) => s + (parseFloat(r.credit_limit) || 0), 0),
      accounts_with_debt: rows.filter((r) => parseFloat(r.current_balance) > 0).length,
      accounts_overdue: rows.filter(
        (r) => parseFloat(r.current_balance) > parseFloat(r.credit_limit),
      ).length,
    };

    return { success: true, data: summary };
  } catch (error) {
    return { success: false, error: error.message, data: null };
  }
}

export async function getAllCreditAccounts(tenantId) {
  if (!tenantId) {
    return { success: false, error: 'tenantId es requerido', data: [] };
  }

  try {
    const { data, error } = await supabase
      .from('customer_credit_accounts')
      .select(
        `
          credit_account_id,
          credit_limit,
          current_balance,
          is_active,
          customer:customer_id(customer_id, full_name, document, phone, email)
        `,
      )
      .eq('tenant_id', tenantId)
      .order('current_balance', { ascending: false });

    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

export async function getCreditMovements(tenantId, creditAccountId) {
  if (!tenantId || !creditAccountId) {
    return { success: false, error: 'tenantId y creditAccountId son requeridos', data: [] };
  }

  try {
    const { data, error } = await supabase
      .from('customer_credit_movements')
      .select(
        'movement_id, source, source_id, amount, note, created_at, created_by_user:created_by(full_name)',
      )
      .eq('tenant_id', tenantId)
      .eq('credit_account_id', creditAccountId)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) throw error;
    return { success: true, data: data || [] };
  } catch (error) {
    return { success: false, error: error.message, data: [] };
  }
}

export async function registerCreditPayment(tenantId, creditAccountId, amount, note, userId) {
  try {
    const { error: movementError } = await supabase.from('customer_credit_movements').insert({
      tenant_id: tenantId,
      credit_account_id: creditAccountId,
      source: 'PAYMENT',
      source_id: null,
      amount: -Math.abs(amount),
      note: note || 'Abono a cartera',
      created_by: userId,
    });

    if (movementError) throw movementError;

    const { error: updateError } = await supabase.rpc('fn_update_credit_balance', {
      p_credit_account_id: creditAccountId,
      p_delta: -Math.abs(amount),
    });

    if (updateError) throw updateError;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
