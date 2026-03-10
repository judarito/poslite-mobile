import { supabase } from '../lib/supabase';
import { getSimpleCache, saveSimpleCache } from './offlineCache.service';
import { getPortfolioSummary, getAllCreditAccounts } from './credit.service';
import { listCashSessions } from './cashMenu.service';
import { listStockBalances, listProductionOrders } from './inventoryCatalog.service';
import { getDashboardSummary } from './reports.service';
import { listThirdParties } from './thirdParties.service';

const COMPLETED_SALE_STATUSES = ['COMPLETED', 'PARTIAL_RETURN', 'RETURNED'];
const OPEN_PRODUCTION_STATUSES = new Set(['PLANNED', 'IN_PROGRESS', 'PAUSED', 'DRAFT']);

export const AI_INSIGHT_CATALOG = [
  {
    id: 'inventory_watch',
    title: 'Inventario IA',
    subtitle: 'Quiebres y stock bajo por prioridad',
    icon: 'cube-outline',
    accent: '#f7c843',
  },
  {
    id: 'purchase_advisor',
    title: 'Compras IA',
    subtitle: 'Sugerencia de reposicion por consumo',
    icon: 'cart-outline',
    accent: '#ffb347',
  },
  {
    id: 'sales_analyst',
    title: 'Ventas IA',
    subtitle: 'Hoy vs ayer y foco comercial',
    icon: 'bar-chart-outline',
    accent: '#4db7ff',
  },
  {
    id: 'cash_audit',
    title: 'Cajas IA',
    subtitle: 'Auditoria de diferencias y riesgo',
    icon: 'cash-outline',
    accent: '#57d65a',
  },
  {
    id: 'portfolio_collector',
    title: 'Cartera IA',
    subtitle: 'Priorizacion de cobranza',
    icon: 'wallet-outline',
    accent: '#ef4444',
  },
  {
    id: 'production_planner',
    title: 'Produccion IA',
    subtitle: 'Ordenes atrasadas y faltantes',
    icon: 'construct-outline',
    accent: '#8f7cff',
  },
  {
    id: 'thirdparty_segmenter',
    title: 'Terceros IA',
    subtitle: 'Segmentacion y reactivacion de clientes',
    icon: 'people-outline',
    accent: '#38bdf8',
  },
  {
    id: 'executive_brief',
    title: 'Dashboard IA',
    subtitle: 'Resumen ejecutivo y alertas',
    icon: 'speedometer-outline',
    accent: '#22d3ee',
  },
];

function clampTop(list, max = 5) {
  return Array.isArray(list) ? list.slice(0, max) : [];
}

function safePct(part, total) {
  const p = Number(part || 0);
  const t = Number(total || 0);
  if (!Number.isFinite(p) || !Number.isFinite(t) || t <= 0) return 0;
  return Number(((p / t) * 100).toFixed(1));
}

function isoDate(value) {
  return new Date(value).toISOString();
}

function todayRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { fromIso: isoDate(start), toIso: isoDate(end) };
}

function yesterdayRange() {
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999);
  return { fromIso: isoDate(start), toIso: isoDate(end) };
}

function lastDaysRange(days = 30) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { fromIso: isoDate(start), toIso: isoDate(end) };
}

function daysBetween(fromDate, toDate = new Date()) {
  const from = new Date(fromDate);
  if (Number.isNaN(from.getTime())) return null;
  return Math.max(0, Math.floor((toDate.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
}

async function loadSalesByRange({ tenantId, fromIso, toIso }) {
  const { data, error } = await supabase
    .from('sales')
    .select('sale_id,total,sold_at,location_id,third_party_id,status')
    .eq('tenant_id', tenantId)
    .in('status', COMPLETED_SALE_STATUSES)
    .gte('sold_at', fromIso)
    .lte('sold_at', toIso)
    .limit(4000);

  if (error) throw error;
  return data || [];
}

async function loadSaleLinesByRange({ tenantId, fromIso, toIso }) {
  const { data, error } = await supabase
    .from('sale_lines')
    .select(
      `
        variant_id,
        quantity,
        sale:sale_id!inner(
          tenant_id,
          status,
          sold_at
        )
      `,
    )
    .eq('sale.tenant_id', tenantId)
    .in('sale.status', COMPLETED_SALE_STATUSES)
    .gte('sale.sold_at', fromIso)
    .lte('sale.sold_at', toIso)
    .limit(6000);

  if (error) throw error;
  return data || [];
}

function sumSales(rows) {
  return rows.reduce((acc, row) => acc + Number(row?.total || 0), 0);
}

function insightCacheKey(tenantId, insightId) {
  return `ai-insight:${tenantId || 'na'}:${insightId}`;
}

async function analyzeInventoryWatch({ tenantId }) {
  const stockResult = await listStockBalances({
    tenantId,
    isComponent: false,
    limit: 600,
    offset: 0,
  });
  if (!stockResult.success) {
    throw new Error(stockResult.error || 'No se pudo cargar stock.');
  }

  const rows = stockResult.data || [];
  const outOfStock = rows.filter((row) => Number(row?.on_hand || 0) <= 0);
  const lowStock = rows.filter((row) => {
    const onHand = Number(row?.on_hand || 0);
    const min = Number(row?.variant?.min_stock || 0);
    return onHand > 0 && min > 0 && onHand <= min;
  });

  const riskRows = rows
    .map((row) => {
      const onHand = Number(row?.on_hand || 0);
      const min = Number(row?.variant?.min_stock || 0);
      const deficit = min > 0 ? min - onHand : 0;
      return {
        name: row?.variant?.product?.name || row?.variant?.variant_name || 'Producto',
        sku: row?.variant?.sku || '',
        onHand,
        min,
        location: row?.location?.name || 'Sin sede',
        deficit,
      };
    })
    .filter((row) => row.onHand <= 0 || row.deficit > 0)
    .sort((a, b) => b.deficit - a.deficit || a.onHand - b.onHand);

  return {
    insightId: 'inventory_watch',
    title: 'Inventario IA',
    summary: `Detectamos ${outOfStock.length} sin stock y ${lowStock.length} en nivel bajo.`,
    highlights: [
      { label: 'Items analizados', value: rows.length },
      { label: 'Sin stock', value: outOfStock.length, tone: outOfStock.length > 0 ? 'danger' : 'neutral' },
      { label: 'Stock bajo', value: lowStock.length, tone: lowStock.length > 0 ? 'warn' : 'neutral' },
      { label: 'Riesgo', value: `${safePct(outOfStock.length + lowStock.length, rows.length)}%` },
    ],
    findings: clampTop(riskRows, 6).map((row) => ({
      label: `${row.name}${row.sku ? ` (${row.sku})` : ''}`,
      value: `Stock ${row.onHand} / Min ${row.min || 0}`,
      meta: row.location,
    })),
    recommendations: [
      outOfStock.length > 0
        ? 'Priorizar reposicion inmediata de productos sin stock.'
        : 'Sin quiebres criticos de inventario.',
      lowStock.length > 0
        ? 'Programar compra de seguridad para items por debajo del minimo.'
        : 'Mantener politica actual de inventario minimo.',
    ],
  };
}

async function analyzePurchaseAdvisor({ tenantId }) {
  const [stockResult, lineRows] = await Promise.all([
    listStockBalances({
      tenantId,
      isComponent: false,
      limit: 700,
      offset: 0,
    }),
    loadSaleLinesByRange({
      tenantId,
      ...lastDaysRange(30),
    }),
  ]);

  if (!stockResult.success) {
    throw new Error(stockResult.error || 'No se pudo cargar stock para compras.');
  }

  const salesQtyByVariant = {};
  (lineRows || []).forEach((line) => {
    const variantId = String(line?.variant_id || '').trim();
    if (!variantId) return;
    salesQtyByVariant[variantId] = Number(salesQtyByVariant[variantId] || 0) + Number(line?.quantity || 0);
  });

  const suggestions = (stockResult.data || [])
    .map((row) => {
      const variantId = String(row?.variant_id || '').trim();
      const onHand = Number(row?.on_hand || 0);
      const min = Number(row?.variant?.min_stock || 0);
      const sold30 = Number(salesQtyByVariant[variantId] || 0);
      const daily = sold30 / 30;
      const daysCover = daily > 0 ? onHand / daily : 999;
      const targetStock = Math.max(min * 2, Math.ceil(daily * 14));
      const suggestedQty = Math.max(0, Math.ceil(targetStock - onHand));
      const shouldBuy = suggestedQty > 0 && (onHand <= min || daysCover < 10);
      return {
        variantId,
        name: row?.variant?.product?.name || row?.variant?.variant_name || 'Producto',
        sku: row?.variant?.sku || '',
        location: row?.location?.name || 'Sin sede',
        onHand,
        min,
        sold30,
        daily: Number(daily.toFixed(2)),
        daysCover: Number(daysCover.toFixed(1)),
        suggestedQty,
        cost: Number(row?.variant?.cost || 0),
        estimatedCost: Number((suggestedQty * Number(row?.variant?.cost || 0)).toFixed(2)),
        shouldBuy,
      };
    })
    .filter((row) => row.shouldBuy)
    .sort((a, b) => a.daysCover - b.daysCover || b.suggestedQty - a.suggestedQty);

  const totalSuggested = suggestions.reduce((acc, row) => acc + row.suggestedQty, 0);
  const estimatedCost = suggestions.reduce((acc, row) => acc + row.estimatedCost, 0);

  return {
    insightId: 'purchase_advisor',
    title: 'Compras IA',
    summary: `Hay ${suggestions.length} productos sugeridos para reposicion.`,
    highlights: [
      { label: 'Productos sugeridos', value: suggestions.length },
      { label: 'Unidades sugeridas', value: totalSuggested },
      { label: 'Costo estimado', value: `$ ${Math.round(estimatedCost).toLocaleString('es-CO')}` },
    ],
    findings: clampTop(suggestions, 8).map((row) => ({
      label: `${row.name}${row.sku ? ` (${row.sku})` : ''}`,
      value: `Sugerido ${row.suggestedQty} | Cobertura ${row.daysCover} dias`,
      meta: `${row.location} | Stock ${row.onHand} | Venta 30d ${row.sold30}`,
    })),
    recommendations: [
      suggestions.length > 0
        ? 'Emitir orden de compra para top 5 productos con menor cobertura.'
        : 'No se detectan reposiciones urgentes con el umbral actual.',
      'Revisar precios de compra y negociar volumen para productos de alta rotacion.',
    ],
  };
}

async function analyzeSalesAnalyst({ tenantId }) {
  const [todayRows, yesterdayRows] = await Promise.all([
    loadSalesByRange({ tenantId, ...todayRange() }),
    loadSalesByRange({ tenantId, ...yesterdayRange() }),
  ]);

  const todayTotal = sumSales(todayRows);
  const yesterdayTotal = sumSales(yesterdayRows);
  const deltaPct = yesterdayTotal > 0
    ? Number((((todayTotal - yesterdayTotal) / yesterdayTotal) * 100).toFixed(1))
    : 0;

  const byLocation = {};
  todayRows.forEach((sale) => {
    const key = String(sale?.location_id || 'sin-sede');
    if (!byLocation[key]) byLocation[key] = { total: 0, count: 0 };
    byLocation[key].total += Number(sale?.total || 0);
    byLocation[key].count += 1;
  });

  const topLocations = Object.entries(byLocation)
    .map(([locationId, agg]) => ({
      locationId,
      ...agg,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    insightId: 'sales_analyst',
    title: 'Ventas IA',
    summary: `Hoy van ${todayRows.length} ventas por $ ${Math.round(todayTotal).toLocaleString('es-CO')}.`,
    highlights: [
      { label: 'Ventas hoy', value: todayRows.length },
      { label: 'Total hoy', value: `$ ${Math.round(todayTotal).toLocaleString('es-CO')}` },
      { label: 'Ayer', value: `$ ${Math.round(yesterdayTotal).toLocaleString('es-CO')}` },
      { label: 'Variacion', value: `${deltaPct >= 0 ? '+' : ''}${deltaPct}%`, tone: deltaPct >= 0 ? 'ok' : 'danger' },
    ],
    findings: clampTop(topLocations, 5).map((row, idx) => ({
      label: `Sede #${idx + 1} (${row.locationId.slice(0, 8)})`,
      value: `${row.count} ventas`,
      meta: `$ ${Math.round(row.total).toLocaleString('es-CO')}`,
    })),
    recommendations: [
      deltaPct < 0
        ? 'Activar campana comercial en sedes con menor aporte hoy.'
        : 'Mantener impulso comercial y monitorear ticket promedio.',
      'Comparar ticket promedio por sede para detectar oportunidades.',
    ],
  };
}

async function analyzeCashAudit({ tenantId }) {
  const sessionsResult = await listCashSessions({
    tenantId,
    status: null,
    limit: 180,
    offset: 0,
  });

  if (!sessionsResult.success) {
    throw new Error(sessionsResult.error || 'No se pudo cargar sesiones de caja.');
  }

  const rows = sessionsResult.data || [];
  const withDifference = rows.filter((row) => Math.abs(Number(row?.difference || 0)) >= 20000);
  const openSessions = rows.filter((row) => String(row?.status || '').toUpperCase() === 'OPEN').length;
  const absDiffTotal = withDifference.reduce((acc, row) => acc + Math.abs(Number(row?.difference || 0)), 0);

  const topRisk = withDifference
    .map((row) => ({
      register: row?.cash_register?.name || 'Caja',
      location: row?.cash_register?.location?.name || 'Sin sede',
      difference: Number(row?.difference || 0),
      status: row?.status || '',
    }))
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

  return {
    insightId: 'cash_audit',
    title: 'Cajas IA',
    summary: `Se detectaron ${withDifference.length} sesiones con diferencia relevante.`,
    highlights: [
      { label: 'Sesiones analizadas', value: rows.length },
      { label: 'Con diferencia', value: withDifference.length, tone: withDifference.length > 0 ? 'warn' : 'ok' },
      { label: 'Dif. acumulada', value: `$ ${Math.round(absDiffTotal).toLocaleString('es-CO')}` },
      { label: 'Sesiones abiertas', value: openSessions },
    ],
    findings: clampTop(topRisk, 6).map((row) => ({
      label: `${row.register} | ${row.location}`,
      value: `Diferencia ${row.difference >= 0 ? '+' : ''}$ ${Math.round(row.difference).toLocaleString('es-CO')}`,
      meta: `Estado ${row.status}`,
    })),
    recommendations: [
      withDifference.length > 0
        ? 'Auditar cierres con mayor diferencia y validar movimientos manuales.'
        : 'No hay alertas criticas de diferencias en caja.',
      openSessions > 0
        ? 'Revisar sesiones abiertas fuera de horario esperado.'
        : 'Control de apertura/cierre en rango normal.',
    ],
  };
}

async function analyzePortfolioCollector({ tenantId }) {
  const [summaryResult, accountsResult] = await Promise.all([
    getPortfolioSummary(tenantId),
    getAllCreditAccounts(tenantId),
  ]);

  if (!summaryResult.success) {
    throw new Error(summaryResult.error || 'No se pudo cargar resumen de cartera.');
  }
  if (!accountsResult.success) {
    throw new Error(accountsResult.error || 'No se pudo cargar cuentas de cartera.');
  }

  const accounts = (accountsResult.data || [])
    .filter((row) => Number(row?.current_balance || 0) > 0)
    .sort((a, b) => Number(b?.current_balance || 0) - Number(a?.current_balance || 0));

  const accountIds = accounts.map((row) => row.credit_account_id).filter(Boolean);
  let lastMovementByAccount = {};
  if (accountIds.length > 0) {
    const { data: moves, error: movesError } = await supabase
      .from('customer_credit_movements')
      .select('credit_account_id,created_at')
      .in('credit_account_id', accountIds)
      .order('created_at', { ascending: false })
      .limit(8000);
    if (!movesError) {
      (moves || []).forEach((move) => {
        const accountId = String(move?.credit_account_id || '');
        if (!accountId || lastMovementByAccount[accountId]) return;
        lastMovementByAccount[accountId] = move?.created_at || null;
      });
    }
  }

  const priority = accounts
    .map((row) => {
      const accountId = String(row?.credit_account_id || '');
      const lastMove = lastMovementByAccount[accountId] || null;
      const daysIdle = lastMove ? daysBetween(lastMove) : null;
      return {
        name: row?.customer?.full_name || 'Cliente',
        doc: row?.customer?.document || '-',
        balance: Number(row?.current_balance || 0),
        limit: Number(row?.credit_limit || 0),
        overLimit: Number(row?.current_balance || 0) > Number(row?.credit_limit || 0),
        daysIdle,
      };
    })
    .sort((a, b) => {
      const aWeight = (a.overLimit ? 2 : 0) + (Number(a.daysIdle || 0) >= 30 ? 1 : 0);
      const bWeight = (b.overLimit ? 2 : 0) + (Number(b.daysIdle || 0) >= 30 ? 1 : 0);
      if (aWeight !== bWeight) return bWeight - aWeight;
      return b.balance - a.balance;
    });

  const overdue30 = priority.filter((row) => Number(row.daysIdle || 0) >= 30).length;

  return {
    insightId: 'portfolio_collector',
    title: 'Cartera IA',
    summary: `Hay ${accounts.length} cuentas con saldo pendiente.`,
    highlights: [
      { label: 'Deuda total', value: `$ ${Math.round(summaryResult.data?.total_debt || 0).toLocaleString('es-CO')}` },
      { label: 'Cuentas con deuda', value: accounts.length },
      { label: 'Sobre cupo', value: Number(summaryResult.data?.accounts_overdue || 0), tone: 'warn' },
      { label: 'Sin mov. >= 30d', value: overdue30, tone: overdue30 > 0 ? 'danger' : 'neutral' },
    ],
    findings: clampTop(priority, 8).map((row) => ({
      label: `${row.name} (${row.doc})`,
      value: `Saldo $ ${Math.round(row.balance).toLocaleString('es-CO')}`,
      meta: `${row.overLimit ? 'Sobre cupo' : 'En cupo'}${row.daysIdle != null ? ` | ${row.daysIdle} dias sin mov.` : ''}`,
    })),
    recommendations: [
      'Iniciar cobranza por top 10 saldos altos y cuentas sobre cupo.',
      overdue30 > 0
        ? 'Aplicar recordatorios escalonados a cuentas sin movimiento mayor a 30 dias.'
        : 'Mantener seguimiento preventivo semanal de cartera.',
    ],
  };
}

async function analyzeProductionPlanner({ tenantId }) {
  const [ordersResult, componentsStockResult] = await Promise.all([
    listProductionOrders({
      tenantId,
      status: null,
      locationId: null,
      limit: 250,
      offset: 0,
    }),
    listStockBalances({
      tenantId,
      isComponent: true,
      limit: 600,
      offset: 0,
    }),
  ]);

  if (!ordersResult.success) {
    throw new Error(ordersResult.error || 'No se pudo cargar ordenes de produccion.');
  }
  if (!componentsStockResult.success) {
    throw new Error(componentsStockResult.error || 'No se pudo cargar insumos.');
  }

  const now = new Date();
  const orders = ordersResult.data || [];
  const delayed = orders.filter((order) => {
    const status = String(order?.status || '').toUpperCase();
    if (!OPEN_PRODUCTION_STATUSES.has(status)) return false;
    const scheduled = order?.scheduled_start ? new Date(order.scheduled_start) : null;
    if (!scheduled || Number.isNaN(scheduled.getTime())) return false;
    return scheduled < now && Number(order?.quantity_produced || 0) < Number(order?.quantity_planned || 0);
  });

  const components = componentsStockResult.data || [];
  const criticalComponents = components
    .map((row) => {
      const onHand = Number(row?.on_hand || 0);
      const min = Number(row?.variant?.min_stock || 0);
      return {
        name: row?.variant?.product?.name || row?.variant?.variant_name || 'Insumo',
        sku: row?.variant?.sku || '',
        onHand,
        min,
        location: row?.location?.name || 'Sin sede',
      };
    })
    .filter((row) => row.onHand <= 0 || (row.min > 0 && row.onHand <= row.min))
    .sort((a, b) => a.onHand - b.onHand);

  return {
    insightId: 'production_planner',
    title: 'Produccion IA',
    summary: `Hay ${delayed.length} ordenes atrasadas y ${criticalComponents.length} insumos criticos.`,
    highlights: [
      { label: 'Ordenes totales', value: orders.length },
      { label: 'Ordenes atrasadas', value: delayed.length, tone: delayed.length > 0 ? 'warn' : 'ok' },
      { label: 'Insumos criticos', value: criticalComponents.length, tone: criticalComponents.length > 0 ? 'danger' : 'neutral' },
    ],
    findings: [
      ...clampTop(delayed, 4).map((order) => ({
        label: `Orden ${order?.order_number || String(order?.production_order_id || '').slice(0, 8)}`,
        value: `${order?.status || '-'} | ${Number(order?.quantity_produced || 0)}/${Number(order?.quantity_planned || 0)}`,
        meta: order?.location?.name || 'Sin sede',
      })),
      ...clampTop(criticalComponents, 4).map((item) => ({
        label: `${item.name}${item.sku ? ` (${item.sku})` : ''}`,
        value: `Stock ${item.onHand} / Min ${item.min || 0}`,
        meta: item.location,
      })),
    ],
    recommendations: [
      delayed.length > 0
        ? 'Reprogramar ordenes atrasadas segun disponibilidad de insumos.'
        : 'No hay atrasos de produccion relevantes.',
      criticalComponents.length > 0
        ? 'Priorizar compra/traslado de insumos criticos para evitar paradas.'
        : 'Disponibilidad de insumos en rango operativo.',
    ],
  };
}

async function analyzeThirdPartySegmenter({ tenantId }) {
  const [customersResult, salesLast30, salesPrev30] = await Promise.all([
    listThirdParties({
      type: 'customer',
      search: '',
      limit: 600,
      offset: 0,
    }),
    loadSalesByRange({ tenantId, ...lastDaysRange(30) }),
    (() => {
      const now = new Date();
      const endPrev = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30, 23, 59, 59, 999);
      const startPrev = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 59, 0, 0, 0, 0);
      return loadSalesByRange({
        tenantId,
        fromIso: isoDate(startPrev),
        toIso: isoDate(endPrev),
      });
    })(),
  ]);

  if (!customersResult.success) {
    throw new Error(customersResult.error || 'No se pudo cargar terceros.');
  }

  const customerMap = {};
  (customersResult.data || []).forEach((customer) => {
    const id = String(customer?.third_party_id || '').trim();
    if (!id) return;
    customerMap[id] = customer;
  });

  const aggLast = {};
  salesLast30.forEach((sale) => {
    const id = String(sale?.third_party_id || '').trim();
    if (!id) return;
    if (!aggLast[id]) aggLast[id] = { total: 0, count: 0 };
    aggLast[id].total += Number(sale?.total || 0);
    aggLast[id].count += 1;
  });

  const aggPrev = {};
  salesPrev30.forEach((sale) => {
    const id = String(sale?.third_party_id || '').trim();
    if (!id) return;
    if (!aggPrev[id]) aggPrev[id] = { total: 0, count: 0 };
    aggPrev[id].total += Number(sale?.total || 0);
    aggPrev[id].count += 1;
  });

  const inactive = Object.keys(aggPrev)
    .filter((id) => !aggLast[id])
    .map((id) => ({
      id,
      prevTotal: Number(aggPrev[id]?.total || 0),
      prevCount: Number(aggPrev[id]?.count || 0),
      customer: customerMap[id],
    }))
    .sort((a, b) => b.prevTotal - a.prevTotal);

  const newActives = Object.keys(aggLast)
    .filter((id) => !aggPrev[id])
    .map((id) => ({
      id,
      total: Number(aggLast[id]?.total || 0),
      count: Number(aggLast[id]?.count || 0),
      customer: customerMap[id],
    }))
    .sort((a, b) => b.total - a.total);

  return {
    insightId: 'thirdparty_segmenter',
    title: 'Terceros IA',
    summary: `Clientes inactivos en 30 dias: ${inactive.length}. Nuevos activos: ${newActives.length}.`,
    highlights: [
      { label: 'Clientes catalogo', value: (customersResult.data || []).length },
      { label: 'Inactivos (30d)', value: inactive.length, tone: inactive.length > 0 ? 'warn' : 'neutral' },
      { label: 'Nuevos activos', value: newActives.length, tone: newActives.length > 0 ? 'ok' : 'neutral' },
    ],
    findings: [
      ...clampTop(inactive, 5).map((row) => ({
        label: row?.customer?.legal_name || `Cliente ${row.id.slice(0, 8)}`,
        value: `Inactivo | Antes compraba $ ${Math.round(row.prevTotal).toLocaleString('es-CO')}`,
        meta: `${row.prevCount} ventas periodo previo`,
      })),
      ...clampTop(newActives, 3).map((row) => ({
        label: row?.customer?.legal_name || `Cliente ${row.id.slice(0, 8)}`,
        value: `Nuevo activo | $ ${Math.round(row.total).toLocaleString('es-CO')}`,
        meta: `${row.count} ventas ultimos 30 dias`,
      })),
    ],
    recommendations: [
      inactive.length > 0
        ? 'Lanzar campana de reactivacion para top clientes inactivos.'
        : 'No hay clientes relevantes inactivos este mes.',
      'Segmentar ofertas por historial de compra y ticket promedio.',
    ],
  };
}

async function analyzeExecutiveBrief({ tenantId }) {
  const [dashboardResult, portfolioResult, cashSessionsResult, stockResult] = await Promise.all([
    getDashboardSummary(tenantId),
    getPortfolioSummary(tenantId),
    listCashSessions({
      tenantId,
      status: null,
      limit: 80,
      offset: 0,
    }),
    listStockBalances({
      tenantId,
      isComponent: false,
      limit: 500,
      offset: 0,
    }),
  ]);

  if (!dashboardResult.success) {
    throw new Error(dashboardResult.error || 'No se pudo cargar dashboard.');
  }

  const todayTotal = Number(dashboardResult?.kpis?.today?.total || 0);
  const monthTotal = Number(dashboardResult?.kpis?.month?.total || 0);
  const monthVsPrev = Number(dashboardResult?.kpis?.month?.vs_prev || 0);
  const debt = Number(portfolioResult?.data?.total_debt || 0);
  const cashDiff = (cashSessionsResult?.data || []).reduce(
    (acc, row) => acc + Math.abs(Number(row?.difference || 0)),
    0,
  );
  const lowStock = (stockResult?.data || []).filter((row) => {
    const onHand = Number(row?.on_hand || 0);
    const min = Number(row?.variant?.min_stock || 0);
    return onHand <= 0 || (min > 0 && onHand <= min);
  }).length;

  return {
    insightId: 'executive_brief',
    title: 'Dashboard IA',
    summary: 'Resumen ejecutivo diario generado para seguimiento de gerencia.',
    highlights: [
      { label: 'Ventas hoy', value: `$ ${Math.round(todayTotal).toLocaleString('es-CO')}` },
      { label: 'Ventas mes', value: `$ ${Math.round(monthTotal).toLocaleString('es-CO')}` },
      { label: 'Vs mes anterior', value: `${monthVsPrev >= 0 ? '+' : ''}${monthVsPrev}%`, tone: monthVsPrev >= 0 ? 'ok' : 'warn' },
      { label: 'Cartera', value: `$ ${Math.round(debt).toLocaleString('es-CO')}`, tone: debt > 0 ? 'warn' : 'neutral' },
      { label: 'Dif. cajas', value: `$ ${Math.round(cashDiff).toLocaleString('es-CO')}`, tone: cashDiff > 0 ? 'danger' : 'neutral' },
      { label: 'Alertas stock', value: lowStock, tone: lowStock > 0 ? 'danger' : 'neutral' },
    ],
    findings: [
      {
        label: 'Comercial',
        value: `Hoy: $ ${Math.round(todayTotal).toLocaleString('es-CO')} | Mes: $ ${Math.round(monthTotal).toLocaleString('es-CO')}`,
      },
      {
        label: 'Cartera',
        value: `Exposicion de cartera: $ ${Math.round(debt).toLocaleString('es-CO')}`,
      },
      {
        label: 'Operacion',
        value: `Diferencias en caja acumuladas: $ ${Math.round(cashDiff).toLocaleString('es-CO')}`,
      },
      {
        label: 'Abastecimiento',
        value: `${lowStock} items con riesgo de quiebre o minimo`,
      },
    ],
    recommendations: [
      monthVsPrev < 0
        ? 'Priorizar acciones comerciales para recuperar tendencia mensual.'
        : 'Sostener estrategias de venta y monitorear margenes.',
      debt > 0 ? 'Ejecutar plan de cobranza sobre cuentas de mayor saldo.' : 'Cartera controlada en rango saludable.',
      lowStock > 0 ? 'Programar reposicion de inventario para evitar quiebres.' : 'Inventario en estado estable.',
    ],
  };
}

const INSIGHT_RUNNERS = {
  inventory_watch: analyzeInventoryWatch,
  purchase_advisor: analyzePurchaseAdvisor,
  sales_analyst: analyzeSalesAnalyst,
  cash_audit: analyzeCashAudit,
  portfolio_collector: analyzePortfolioCollector,
  production_planner: analyzeProductionPlanner,
  thirdparty_segmenter: analyzeThirdPartySegmenter,
  executive_brief: analyzeExecutiveBrief,
};

export function resolveAiInsightByText(queryText) {
  const text = String(queryText || '').trim().toLowerCase();
  if (!text) return { insightId: null, confidence: 0 };

  const rules = [
    { insightId: 'inventory_watch', keys: ['inventario', 'stock', 'quiebre', 'kardex', 'existencias'] },
    { insightId: 'purchase_advisor', keys: ['compra', 'compras', 'reposicion', 'abastecer', 'proveedor'] },
    { insightId: 'sales_analyst', keys: ['ventas', 'hoy', 'ayer', 'ticket', 'factura'] },
    { insightId: 'cash_audit', keys: ['caja', 'sesion', 'arqueo', 'diferencia', 'cajero'] },
    { insightId: 'portfolio_collector', keys: ['cartera', 'cobranza', 'credito', 'saldo', 'mora'] },
    { insightId: 'production_planner', keys: ['produccion', 'orden', 'bom', 'insumo', 'manufactura'] },
    { insightId: 'thirdparty_segmenter', keys: ['cliente', 'tercero', 'reactivar', 'segmento', 'segmentacion'] },
    { insightId: 'executive_brief', keys: ['resumen', 'ejecutivo', 'dashboard', 'gerencia', 'brief'] },
  ];

  let best = null;
  rules.forEach((rule) => {
    const score = rule.keys.reduce((acc, key) => (text.includes(key) ? acc + 1 : acc), 0);
    if (!score) return;
    if (!best || score > best.score) {
      best = { insightId: rule.insightId, score };
    }
  });

  if (!best) return { insightId: null, confidence: 0 };
  return {
    insightId: best.insightId,
    confidence: Number(Math.min(0.95, 0.35 + best.score * 0.18).toFixed(2)),
  };
}

export async function runAiInsight({ tenantId, insightId, offlineMode = false }) {
  if (!tenantId) {
    return { success: false, error: 'tenantId es requerido.' };
  }

  const runner = INSIGHT_RUNNERS[String(insightId || '').trim()];
  if (typeof runner !== 'function') {
    return { success: false, error: 'Insight IA no soportado.' };
  }

  const cacheKey = insightCacheKey(tenantId, insightId);

  if (offlineMode) {
    const cached = await getSimpleCache(cacheKey);
    if (cached?.value) {
      return {
        success: true,
        data: {
          ...cached.value,
          engine: { source: 'cache_local', cachedAt: cached.cachedAt || null },
        },
      };
    }
    return { success: false, error: 'Modo offline: no hay cache local para este analisis IA.' };
  }

  try {
    const computed = await runner({ tenantId });
    const result = {
      ...computed,
      generatedAt: new Date().toISOString(),
      engine: { source: 'deterministic_analytics' },
    };
    await saveSimpleCache(cacheKey, result);
    return { success: true, data: result };
  } catch (error) {
    const cached = await getSimpleCache(cacheKey);
    if (cached?.value) {
      return {
        success: true,
        data: {
          ...cached.value,
          engine: {
            source: 'cache_fallback',
            warning: String(error?.message || 'Error de red'),
            cachedAt: cached.cachedAt || null,
          },
        },
      };
    }
    return { success: false, error: String(error?.message || 'No se pudo ejecutar analisis IA.') };
  }
}

export async function runAllAiInsights({ tenantId, offlineMode = false }) {
  const results = [];
  for (const item of AI_INSIGHT_CATALOG) {
    // eslint-disable-next-line no-await-in-loop
    const res = await runAiInsight({
      tenantId,
      insightId: item.id,
      offlineMode,
    });
    results.push({
      insightId: item.id,
      ...res,
    });
  }
  return {
    success: true,
    data: results,
  };
}
