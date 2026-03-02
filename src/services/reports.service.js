import { supabase } from '../lib/supabase';

function sumTotals(rows) {
  return (rows || []).reduce((acc, row) => acc + (parseFloat(row.total) || 0), 0);
}

export async function getDashboardSummary(tenantId, locationId = null) {
  if (!tenantId) {
    return {
      success: false,
      error: 'tenantId es requerido',
      kpis: null,
      dailySeries: [],
      topProducts: [],
      paymentMethods: [],
    };
  }

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthEnd = now.toISOString();
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();
    const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();
    const yearEnd = now.toISOString();

    const base = (from, to) => {
      let query = supabase
        .from('sales')
        .select('total, status, sold_at')
        .eq('tenant_id', tenantId)
        .in('status', ['COMPLETED', 'PARTIAL_RETURN'])
        .gte('sold_at', from)
        .lte('sold_at', to);

      if (locationId) query = query.eq('location_id', locationId);
      return query;
    };

    const last30Start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29).toISOString();

    const [rToday, rMonth, rPrevMonth, rYear, rLast30, rTopProducts, rPayments] = await Promise.all([
      base(todayStart, todayEnd),
      base(monthStart, monthEnd),
      base(prevMonthStart, prevMonthEnd),
      base(yearStart, yearEnd),
      base(last30Start, yearEnd),
      (() => {
        let query = supabase
          .from('sale_lines')
          .select(
            `
              variant_id,
              quantity,
              line_total,
              variant:variant_id(variant_name, product:product_id(name)),
              sale:sale_id!inner(tenant_id, status, sold_at, location_id)
            `,
          )
          .eq('sale.tenant_id', tenantId)
          .in('sale.status', ['COMPLETED', 'PARTIAL_RETURN'])
          .gte('sale.sold_at', monthStart)
          .lte('sale.sold_at', monthEnd);
        if (locationId) query = query.eq('sale.location_id', locationId);
        return query;
      })(),
      (() => {
        let query = supabase
          .from('sale_payments')
          .select(
            `
              amount,
              payment_method:payment_method_id(code, name),
              sale:sale_id!inner(tenant_id, status, sold_at, location_id)
            `,
          )
          .eq('sale.tenant_id', tenantId)
          .in('sale.status', ['COMPLETED', 'PARTIAL_RETURN'])
          .gte('sale.sold_at', monthStart)
          .lte('sale.sold_at', monthEnd);
        if (locationId) query = query.eq('sale.location_id', locationId);
        return query;
      })(),
    ]);

    if (rToday.error) throw rToday.error;
    if (rMonth.error) throw rMonth.error;
    if (rPrevMonth.error) throw rPrevMonth.error;
    if (rYear.error) throw rYear.error;
    if (rLast30.error) throw rLast30.error;
    if (rTopProducts.error) throw rTopProducts.error;
    if (rPayments.error) throw rPayments.error;

    const kpis = {
      today: { total: sumTotals(rToday.data), count: (rToday.data || []).length },
      month: { total: sumTotals(rMonth.data), count: (rMonth.data || []).length },
      prev_month: { total: sumTotals(rPrevMonth.data), count: (rPrevMonth.data || []).length },
      year: { total: sumTotals(rYear.data), count: (rYear.data || []).length },
    };

    kpis.month.vs_prev =
      kpis.prev_month.total > 0
        ? ((kpis.month.total - kpis.prev_month.total) / kpis.prev_month.total * 100).toFixed(1)
        : null;

    const dailyMap = {};
    for (let i = 29; i >= 0; i -= 1) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = day.toISOString().substring(0, 10);
      dailyMap[key] = 0;
    }
    (rLast30.data || []).forEach((sale) => {
      const key = String(sale.sold_at || '').substring(0, 10);
      if (key in dailyMap) {
        dailyMap[key] += parseFloat(sale.total) || 0;
      }
    });
    const dailySeries = Object.entries(dailyMap).map(([date, total]) => ({ date, total }));

    const productMap = {};
    (rTopProducts.data || []).forEach((line) => {
      const key = line.variant_id || 'unknown';
      if (!productMap[key]) {
        productMap[key] = {
          name:
            (line.variant?.product?.name || 'Producto') +
            (line.variant?.variant_name ? ` (${line.variant.variant_name})` : ''),
          revenue: 0,
          qty: 0,
        };
      }
      productMap[key].revenue += parseFloat(line.line_total) || 0;
      productMap[key].qty += parseFloat(line.quantity) || 0;
    });
    const topProducts = Object.values(productMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 7);

    const paymentMap = {};
    (rPayments.data || []).forEach((payment) => {
      const key = payment.payment_method?.name || payment.payment_method?.code || 'Otro';
      if (!paymentMap[key]) paymentMap[key] = 0;
      paymentMap[key] += parseFloat(payment.amount) || 0;
    });
    const paymentMethods = Object.entries(paymentMap).map(([method, total]) => ({ method, total }));

    return { success: true, kpis, dailySeries, topProducts, paymentMethods };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      kpis: null,
      dailySeries: [],
      topProducts: [],
      paymentMethods: [],
    };
  }
}

function normalizeDateInput(value, fallbackDate) {
  if (!value) return fallbackDate;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallbackDate;
  return parsed;
}

function toIsoStartOfDay(dateValue) {
  const d = new Date(dateValue);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function toIsoEndOfDay(dateValue) {
  const d = new Date(dateValue);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

function buildDateRange({ fromDate, toDate }) {
  const now = new Date();
  const fallbackFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const fallbackTo = now;
  const from = normalizeDateInput(fromDate, fallbackFrom);
  const to = normalizeDateInput(toDate, fallbackTo);

  if (from.getTime() > to.getTime()) {
    return {
      fromIso: toIsoStartOfDay(to),
      toIso: toIsoEndOfDay(from),
      fromDate: to,
      toDate: from,
    };
  }

  return {
    fromIso: toIsoStartOfDay(from),
    toIso: toIsoEndOfDay(to),
    fromDate: from,
    toDate: to,
  };
}

function withLocationFilter(query, locationId, field = 'location_id') {
  if (!locationId) return query;
  return query.eq(field, locationId);
}

export async function listReportLocations(tenantId) {
  if (!tenantId) {
    return { success: false, error: 'tenantId es requerido', data: [] };
  }

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

export async function getReportsSnapshot({ tenantId, fromDate, toDate, locationId = null }) {
  if (!tenantId) {
    return { success: false, error: 'tenantId es requerido', data: null };
  }

  try {
    const range = buildDateRange({ fromDate, toDate });

    const salesQuery = withLocationFilter(
      supabase
        .from('sales')
        .select('sale_id,total,status,sold_at,cash_session_id,sold_by,location_id')
        .eq('tenant_id', tenantId)
        .in('status', ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED'])
        .gte('sold_at', range.fromIso)
        .lte('sold_at', range.toIso),
      locationId,
    );

    const paymentsQuery = supabase
      .from('sale_payments')
      .select(
        `
          amount,
          payment_method:payment_method_id(code,name),
          sale:sale_id!inner(tenant_id,status,sold_at,location_id)
        `,
      )
      .eq('sale.tenant_id', tenantId)
      .in('sale.status', ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED'])
      .gte('sale.sold_at', range.fromIso)
      .lte('sale.sold_at', range.toIso);

    const filteredPaymentsQuery = locationId ? paymentsQuery.eq('sale.location_id', locationId) : paymentsQuery;

    const sessionsQuery = supabase
      .from('cash_sessions')
      .select(
        `
          cash_session_id,
          status,
          opening_amount,
          closing_amount_counted,
          closing_amount_expected,
          difference,
          opened_at,
          closed_at,
          cash_register:cash_register_id(name,location_id,location:location_id(name)),
          opened_by_user:opened_by(full_name),
          closed_by_user:closed_by(full_name)
        `,
      )
      .eq('tenant_id', tenantId)
      .gte('opened_at', range.fromIso)
      .lte('opened_at', range.toIso);

    const stocksQuery = withLocationFilter(
      supabase
        .from('stock_balances')
        .select(
          `
            on_hand,
            location_id,
            variant:variant_id(min_stock,cost,is_component,product:product_id(name))
          `,
        )
        .eq('tenant_id', tenantId),
      locationId,
    );

    const sellersQuery = supabase
      .from('users')
      .select('user_id,full_name')
      .eq('tenant_id', tenantId);

    const salesLinesQuery = supabase
      .from('sale_lines')
      .select(
        `
          quantity,
          line_total,
          variant:variant_id(cost),
          sale:sale_id!inner(tenant_id,status,sold_at,location_id)
        `,
      )
      .eq('sale.tenant_id', tenantId)
      .in('sale.status', ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED'])
      .gte('sale.sold_at', range.fromIso)
      .lte('sale.sold_at', range.toIso);

    const filteredSalesLinesQuery = locationId
      ? salesLinesQuery.eq('sale.location_id', locationId)
      : salesLinesQuery;

    const cashMovementsQuery = supabase
      .from('cash_movements')
      .select('type,amount,category,created_at,cash_session_id')
      .eq('tenant_id', tenantId)
      .gte('created_at', range.fromIso)
      .lte('created_at', range.toIso);

    const productionOrdersQuery = withLocationFilter(
      supabase
        .from('production_orders')
        .select(
          `
            production_order_id,
            status,
            quantity_planned,
            quantity_produced,
            created_at,
            completed_at,
            location_id,
            bom:bom_id(bom_name,product:product_id(name),variant:variant_id(variant_name))
          `,
        )
        .eq('tenant_id', tenantId)
        .gte('created_at', range.fromIso)
        .lte('created_at', range.toIso),
      locationId,
    );

    const [salesRes, paymentsRes, sessionsRes, stocksRes, sellersRes, linesRes, movementsRes, productionRes] = await Promise.all([
      salesQuery,
      filteredPaymentsQuery,
      sessionsQuery,
      stocksQuery,
      sellersQuery,
      filteredSalesLinesQuery,
      cashMovementsQuery,
      productionOrdersQuery,
    ]);

    if (salesRes.error) throw salesRes.error;
    if (paymentsRes.error) throw paymentsRes.error;
    if (sessionsRes.error) throw sessionsRes.error;
    if (stocksRes.error) throw stocksRes.error;
    if (sellersRes.error) throw sellersRes.error;
    if (linesRes.error) throw linesRes.error;
    if (movementsRes.error) throw movementsRes.error;
    if (productionRes.error) throw productionRes.error;

    const sales = salesRes.data || [];
    const sessionsRaw = sessionsRes.data || [];
    const sessions = locationId
      ? sessionsRaw.filter((session) => session.cash_register?.location_id === locationId)
      : sessionsRaw;
    const payments = paymentsRes.data || [];
    const stocks = stocksRes.data || [];
    const saleLines = linesRes.data || [];
    const allCashMovements = movementsRes.data || [];
    const productionOrders = productionRes.data || [];
    const sellerMap = new Map((sellersRes.data || []).map((s) => [s.user_id, s.full_name]));

    const grossTotal = sales.reduce((sum, sale) => {
      if (sale.status === 'RETURNED') return sum;
      return sum + (parseFloat(sale.total) || 0);
    }, 0);
    const returnsTotal = sales.reduce((sum, sale) => {
      if (sale.status !== 'RETURNED') return sum;
      return sum + (parseFloat(sale.total) || 0);
    }, 0);
    const netTotal = grossTotal - returnsTotal;

    const salesByDayMap = {};
    sales.forEach((sale) => {
      const day = String(sale.sold_at || '').slice(0, 10);
      if (!day) return;
      if (!salesByDayMap[day]) {
        salesByDayMap[day] = {
          date: day,
          count: 0,
          gross_total: 0,
          returns_total: 0,
          net_total: 0,
        };
      }
      salesByDayMap[day].count += 1;
      const amount = parseFloat(sale.total) || 0;
      if (sale.status === 'RETURNED') salesByDayMap[day].returns_total += amount;
      else salesByDayMap[day].gross_total += amount;
      salesByDayMap[day].net_total =
        salesByDayMap[day].gross_total - salesByDayMap[day].returns_total;
    });
    const salesByDay = Object.values(salesByDayMap).sort((a, b) => (a.date > b.date ? -1 : 1));

    const paymentMap = {};
    payments.forEach((payment) => {
      const method = payment.payment_method?.name || payment.payment_method?.code || 'Otro';
      if (!paymentMap[method]) paymentMap[method] = 0;
      paymentMap[method] += parseFloat(payment.amount) || 0;
    });
    const salesByPaymentMethod = Object.entries(paymentMap)
      .map(([method, total]) => ({ method, total }))
      .sort((a, b) => b.total - a.total);

    const sellerStats = {};
    sales.forEach((sale) => {
      const sellerId = sale.sold_by || 'unknown';
      if (!sellerStats[sellerId]) {
        sellerStats[sellerId] = {
          user_id: sellerId,
          name: sellerMap.get(sellerId) || 'Sin vendedor',
          count: 0,
          total: 0,
        };
      }
      sellerStats[sellerId].count += 1;
      sellerStats[sellerId].total += parseFloat(sale.total) || 0;
    });
    const salesBySeller = Object.values(sellerStats).sort((a, b) => b.total - a.total);

    const salesBySession = {};
    sales.forEach((sale) => {
      const key = sale.cash_session_id || 'na';
      if (!salesBySession[key]) salesBySession[key] = { count: 0, total: 0 };
      salesBySession[key].count += 1;
      salesBySession[key].total += parseFloat(sale.total) || 0;
    });

    const sessionsWithSales = sessions.map((session) => {
      const sessionSales = salesBySession[session.cash_session_id] || { count: 0, total: 0 };
      return {
        ...session,
        sales_count: sessionSales.count,
        sales_total: sessionSales.total,
      };
    });
    const sessionsWithDiff = sessionsWithSales.filter(
      (session) => Math.abs(Number(session.difference || 0)) > 0.5,
    );

    const totalInventoryValue = stocks.reduce(
      (sum, row) => sum + Number(row.on_hand || 0) * Number(row.variant?.cost || 0),
      0,
    );
    const lowStockRows = stocks.filter(
      (row) => Number(row.variant?.min_stock || 0) > 0 && Number(row.on_hand || 0) <= Number(row.variant?.min_stock || 0),
    );
    const outOfStockRows = stocks.filter((row) => Number(row.on_hand || 0) <= 0);

    const sessionIds = new Set((sessions || []).map((s) => s.cash_session_id));
    const cashMovements = locationId
      ? allCashMovements.filter((move) => sessionIds.has(move.cash_session_id))
      : allCashMovements;

    let movementIncome = 0;
    let movementExpense = 0;
    cashMovements.forEach((move) => {
      const amount = Number(move.amount || 0);
      if (move.type === 'INCOME') movementIncome += amount;
      else movementExpense += amount;
    });

    const estimatedCost = saleLines.reduce(
      (sum, line) => sum + Number(line.quantity || 0) * Number(line.variant?.cost || 0),
      0,
    );
    const grossMargin = netTotal - estimatedCost;

    const productionSummary = {
      total_orders: productionOrders.length,
      planned_qty: productionOrders.reduce((sum, o) => sum + Number(o.quantity_planned || 0), 0),
      produced_qty: productionOrders.reduce((sum, o) => sum + Number(o.quantity_produced || 0), 0),
      completed_orders: productionOrders.filter((o) => o.status === 'COMPLETED').length,
      in_progress_orders: productionOrders.filter((o) => o.status === 'IN_PROGRESS').length,
      draft_orders: productionOrders.filter((o) => o.status === 'DRAFT').length,
    };

    return {
      success: true,
      data: {
        range: {
          from: range.fromDate.toISOString().slice(0, 10),
          to: range.toDate.toISOString().slice(0, 10),
        },
        sales: {
          summary: {
            total_sales: sales.length,
            gross_total: grossTotal,
            returns_total: returnsTotal,
            net_total: netTotal,
          },
          by_day: salesByDay,
          by_payment_method: salesByPaymentMethod,
          by_seller: salesBySeller,
        },
        cash: {
          summary: {
            sessions_count: sessionsWithSales.length,
            open_sessions: sessionsWithSales.filter((s) => s.status === 'OPEN').length,
            sessions_with_difference: sessionsWithDiff.length,
            transactions_count: sales.length,
            sales_total: sales.reduce((sum, sale) => sum + (parseFloat(sale.total) || 0), 0),
          },
          sessions: sessionsWithSales
            .sort((a, b) => String(b.opened_at || '').localeCompare(String(a.opened_at || '')))
            .slice(0, 80),
          sessions_with_difference: sessionsWithDiff
            .sort((a, b) => Math.abs(Number(b.difference || 0)) - Math.abs(Number(a.difference || 0)))
            .slice(0, 50),
        },
        inventory: {
          summary: {
            rows: stocks.length,
            low_stock: lowStockRows.length,
            out_of_stock: outOfStockRows.length,
            inventory_value: totalInventoryValue,
          },
          low_stock_items: lowStockRows
            .map((row) => ({
              product_name: row.variant?.product?.name || 'Producto',
              on_hand: Number(row.on_hand || 0),
              min_stock: Number(row.variant?.min_stock || 0),
              cost: Number(row.variant?.cost || 0),
            }))
            .sort((a, b) => a.on_hand - b.on_hand)
            .slice(0, 60),
          out_of_stock_items: outOfStockRows
            .map((row) => ({
              product_name: row.variant?.product?.name || 'Producto',
              on_hand: Number(row.on_hand || 0),
              min_stock: Number(row.variant?.min_stock || 0),
            }))
            .slice(0, 60),
        },
        financial: {
          summary: {
            net_sales: netTotal,
            estimated_cost: estimatedCost,
            gross_margin: grossMargin,
            movement_income: movementIncome,
            movement_expense: movementExpense,
            net_result: grossMargin + movementIncome - movementExpense,
          },
          cash_movements: cashMovements
            .map((move) => ({
              type: move.type,
              amount: Number(move.amount || 0),
              category: move.category || '',
              created_at: move.created_at,
            }))
            .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
            .slice(0, 80),
        },
        production: {
          summary: productionSummary,
          orders: productionOrders
            .map((order) => ({
              production_order_id: order.production_order_id,
              status: order.status,
              quantity_planned: Number(order.quantity_planned || 0),
              quantity_produced: Number(order.quantity_produced || 0),
              created_at: order.created_at,
              completed_at: order.completed_at,
              bom_name: order.bom?.bom_name || '',
              product_name: order.bom?.product?.name || '',
              variant_name: order.bom?.variant?.variant_name || '',
            }))
            .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
            .slice(0, 80),
        },
      },
    };
  } catch (error) {
    return { success: false, error: error.message, data: null };
  }
}
