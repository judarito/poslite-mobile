import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getSimpleCache, saveSimpleCache } from '../services/offlineCache.service';
import { getReportsSnapshot, listReportLocations } from '../services/reports.service';

const TABS = [
  { key: 'sales', label: 'Ventas' },
  { key: 'cash', label: 'Cajas' },
  { key: 'inventory', label: 'Inventario' },
  { key: 'financial', label: 'Financiero' },
  { key: 'production', label: 'Produccion' },
];

function formatInputDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function getPresetRange(days) {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - (days - 1));
  return { from: formatInputDate(from), to: formatInputDate(now) };
}

export default function ReportsScreen({
  tenant,
  offlineMode,
  formatMoney,
  initialTab = 'sales',
}) {
  const [tab, setTab] = useState(initialTab);
  const [locations, setLocations] = useState([]);
  const [locationId, setLocationId] = useState('');
  const [fromDate, setFromDate] = useState(getPresetRange(30).from);
  const [toDate, setToDate] = useState(getPresetRange(30).to);
  const [snapshot, setSnapshot] = useState(null);
  const [cacheInfo, setCacheInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setTab(initialTab || 'sales');
  }, [initialTab]);

  const money =
    formatMoney ||
    ((value) => `$ ${Math.round(Number(value || 0)).toLocaleString('es-CO')}`);

  const cacheKey = useMemo(
    () =>
      `reports:snapshot:${tenant?.tenant_id || 'na'}:${fromDate}:${toDate}:${locationId || 'all'}`,
    [fromDate, locationId, tenant?.tenant_id, toDate],
  );

  useEffect(() => {
    const loadLocations = async () => {
      if (!tenant?.tenant_id) return;
      const result = await listReportLocations(tenant.tenant_id);
      if (result.success) setLocations(result.data || []);
    };
    loadLocations();
  }, [tenant?.tenant_id]);

  const loadSnapshot = async () => {
    if (!tenant?.tenant_id) return;
    setLoading(true);
    setError('');

    if (offlineMode) {
      const cached = await getSimpleCache(cacheKey);
      if (cached?.value) {
        setSnapshot(cached.value);
        setCacheInfo({ source: 'cache', cachedAt: cached.cachedAt || null });
        setLoading(false);
        return;
      }

      setSnapshot(null);
      setCacheInfo({ source: 'cache-miss', cachedAt: null });
      setError('No hay cache local de este reporte para el filtro seleccionado.');
      setLoading(false);
      return;
    }

    const result = await getReportsSnapshot({
      tenantId: tenant.tenant_id,
      fromDate,
      toDate,
      locationId: locationId || null,
    });

    if (!result.success) {
      const fallback = await getSimpleCache(cacheKey);
      if (fallback?.value) {
        setSnapshot(fallback.value);
        setCacheInfo({ source: 'cache', cachedAt: fallback.cachedAt || null });
        setError(result.error || 'Sin conexion. Mostrando cache local.');
      } else {
        setSnapshot(null);
        setCacheInfo({ source: 'none', cachedAt: null });
        setError(result.error || 'No fue posible cargar reportes.');
      }
      setLoading(false);
      return;
    }

    setSnapshot(result.data);
    setCacheInfo({ source: 'server', cachedAt: new Date().toISOString() });
    await saveSimpleCache(cacheKey, result.data);
    setLoading(false);
  };

  useEffect(() => {
    loadSnapshot();
  }, [tenant?.tenant_id, fromDate, toDate, locationId, offlineMode]);

  const sales = snapshot?.sales;
  const cash = snapshot?.cash;
  const inventory = snapshot?.inventory;
  const financial = snapshot?.financial;
  const production = snapshot?.production;
  const sourceLabel =
    cacheInfo?.source === 'cache'
      ? 'Cache local'
      : cacheInfo?.source === 'server'
        ? 'Servidor'
        : 'Sin fuente';

  return (
    <View style={styles.container}>
      <View style={styles.heroCard}>
        <View style={styles.heroTop}>
          <Text style={styles.heroTitle}>Centro de Reportes</Text>
          <View style={[styles.sourcePill, cacheInfo?.source === 'cache' ? styles.sourcePillCache : styles.sourcePillServer]}>
            <Text style={styles.sourcePillText}>{sourceLabel}</Text>
          </View>
        </View>
        <Text style={styles.heroSub}>Periodo: {fromDate} a {toDate}</Text>
        {loading ? <ActivityIndicator color="#38bdf8" style={{ marginTop: 8 }} /> : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll}>
        <View style={styles.tabRow}>
          {TABS.map((entry) => {
            const active = tab === entry.key;
            return (
              <Pressable
                key={entry.key}
                style={[styles.tabBtn, active && styles.tabBtnActive]}
                onPress={() => setTab(entry.key)}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{entry.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll}>
        <View style={styles.chipsRow}>
          {[
            { label: 'Hoy', days: 1 },
            { label: '7 dias', days: 7 },
            { label: '30 dias', days: 30 },
          ].map((preset) => (
            <Pressable
              key={preset.label}
              style={styles.filterChip}
              onPress={() => {
                const next = getPresetRange(preset.days);
                setFromDate(next.from);
                setToDate(next.to);
              }}
            >
              <Text style={styles.filterChipText}>{preset.label}</Text>
            </Pressable>
          ))}
          <Pressable style={styles.filterChip} onPress={loadSnapshot}>
            <Text style={styles.filterChipText}>{loading ? 'Cargando...' : 'Recargar'}</Text>
          </Pressable>
        </View>
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll}>
        <View style={styles.chipsRow}>
          <Pressable
            style={[styles.filterChip, !locationId && styles.filterChipActive]}
            onPress={() => setLocationId('')}
          >
            <Text style={[styles.filterChipText, !locationId && styles.filterChipTextActive]}>
              Todas las sedes
            </Text>
          </Pressable>
          {locations.map((loc) => {
            const active = locationId === loc.location_id;
            return (
              <Pressable
                key={loc.location_id}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => setLocationId(loc.location_id)}
              >
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                  {loc.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.metaWrap}>
        <Text style={styles.metaText}>Vista: {TABS.find((t) => t.key === tab)?.label || 'Reportes'}</Text>
        {cacheInfo?.source === 'cache' && cacheInfo?.cachedAt ? (
          <Text style={styles.metaText}>Offline cache: {new Date(cacheInfo.cachedAt).toLocaleString()}</Text>
        ) : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>

      <ScrollView>
        {tab === 'sales' ? (
          <View>
            <View style={styles.kpiRow}>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Ventas</Text>
                <Text style={styles.kpiValue}>{sales?.summary?.total_sales || 0}</Text>
              </View>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Bruto</Text>
                <Text style={styles.kpiValue}>{money(sales?.summary?.gross_total || 0)}</Text>
              </View>
            </View>
            <View style={styles.kpiRow}>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Devoluciones</Text>
                <Text style={styles.kpiValue}>{money(sales?.summary?.returns_total || 0)}</Text>
              </View>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Neto</Text>
                <Text style={styles.kpiValue}>{money(sales?.summary?.net_total || 0)}</Text>
              </View>
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Ventas por Dia</Text>
              {(sales?.by_day || []).slice(0, 20).map((row) => (
                <View key={row.date} style={styles.lineRow}>
                  <Text style={styles.lineLabel}>{row.date}</Text>
                  <Text style={styles.lineValue}>{row.count} · {money(row.net_total || 0)}</Text>
                </View>
              ))}
              {(sales?.by_day || []).length === 0 ? (
                <Text style={styles.emptyText}>Sin datos</Text>
              ) : null}
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Metodos de Pago</Text>
              {(sales?.by_payment_method || []).slice(0, 10).map((row) => (
                <View key={row.method} style={styles.lineRow}>
                  <Text style={styles.lineLabel}>{row.method}</Text>
                  <Text style={styles.lineValue}>{money(row.total || 0)}</Text>
                </View>
              ))}
              {(sales?.by_payment_method || []).length === 0 ? (
                <Text style={styles.emptyText}>Sin datos</Text>
              ) : null}
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Ventas por Vendedor</Text>
              {(sales?.by_seller || []).slice(0, 12).map((row) => (
                <View key={row.user_id || row.name} style={styles.lineRow}>
                  <Text style={styles.lineLabel}>{row.name}</Text>
                  <Text style={styles.lineValue}>{row.count} · {money(row.total || 0)}</Text>
                </View>
              ))}
              {(sales?.by_seller || []).length === 0 ? (
                <Text style={styles.emptyText}>Sin datos</Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {tab === 'cash' ? (
          <View>
            <View style={styles.kpiRow}>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Sesiones</Text>
                <Text style={styles.kpiValue}>{cash?.summary?.sessions_count || 0}</Text>
              </View>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Abiertas</Text>
                <Text style={styles.kpiValue}>{cash?.summary?.open_sessions || 0}</Text>
              </View>
            </View>
            <View style={styles.kpiRow}>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Transacciones</Text>
                <Text style={styles.kpiValue}>{cash?.summary?.transactions_count || 0}</Text>
              </View>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Con diferencia</Text>
                <Text style={styles.kpiValue}>{cash?.summary?.sessions_with_difference || 0}</Text>
              </View>
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Sesiones con Diferencia</Text>
              {(cash?.sessions_with_difference || []).slice(0, 25).map((session) => (
                <View key={session.cash_session_id} style={styles.lineBlock}>
                  <Text style={styles.lineLabel}>
                    {session.cash_register?.name || 'Caja'} · {session.cash_register?.location?.name || '-'}
                  </Text>
                  <Text style={styles.lineValue}>
                    Dif: {money(session.difference || 0)} · Ventas: {money(session.sales_total || 0)}
                  </Text>
                </View>
              ))}
              {(cash?.sessions_with_difference || []).length === 0 ? (
                <Text style={styles.emptyText}>Sin diferencias</Text>
              ) : null}
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Sesiones Recientes</Text>
              {(cash?.sessions || []).slice(0, 20).map((session) => (
                <View key={session.cash_session_id} style={styles.lineBlock}>
                  <Text style={styles.lineLabel}>
                    {session.cash_register?.name || 'Caja'} · {session.status}
                  </Text>
                  <Text style={styles.lineValue}>
                    Ventas {session.sales_count || 0} · {money(session.sales_total || 0)}
                  </Text>
                </View>
              ))}
              {(cash?.sessions || []).length === 0 ? (
                <Text style={styles.emptyText}>Sin datos</Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {tab === 'inventory' ? (
          <View>
            <View style={styles.kpiRow}>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Registros</Text>
                <Text style={styles.kpiValue}>{inventory?.summary?.rows || 0}</Text>
              </View>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Stock Bajo</Text>
                <Text style={styles.kpiValue}>{inventory?.summary?.low_stock || 0}</Text>
              </View>
            </View>
            <View style={styles.kpiRow}>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Sin Stock</Text>
                <Text style={styles.kpiValue}>{inventory?.summary?.out_of_stock || 0}</Text>
              </View>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Valor Inventario</Text>
                <Text style={styles.kpiValue}>{money(inventory?.summary?.inventory_value || 0)}</Text>
              </View>
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Productos con Stock Bajo</Text>
              {(inventory?.low_stock_items || []).slice(0, 30).map((item, idx) => (
                <View key={`${item.product_name}-${idx}`} style={styles.lineBlock}>
                  <Text style={styles.lineLabel}>{item.product_name}</Text>
                  <Text style={styles.lineValue}>
                    Stock {item.on_hand} / Min {item.min_stock} · Costo {money(item.cost || 0)}
                  </Text>
                </View>
              ))}
              {(inventory?.low_stock_items || []).length === 0 ? (
                <Text style={styles.emptyText}>Sin alertas</Text>
              ) : null}
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Productos sin Stock</Text>
              {(inventory?.out_of_stock_items || []).slice(0, 20).map((item, idx) => (
                <View key={`${item.product_name}-${idx}`} style={styles.lineRow}>
                  <Text style={styles.lineLabel}>{item.product_name}</Text>
                  <Text style={styles.lineValue}>0 / Min {item.min_stock}</Text>
                </View>
              ))}
              {(inventory?.out_of_stock_items || []).length === 0 ? (
                <Text style={styles.emptyText}>Sin datos</Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {tab === 'financial' ? (
          <View>
            <View style={styles.kpiRow}>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Ventas Netas</Text>
                <Text style={styles.kpiValue}>{money(financial?.summary?.net_sales || 0)}</Text>
              </View>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Costo Estimado</Text>
                <Text style={styles.kpiValue}>{money(financial?.summary?.estimated_cost || 0)}</Text>
              </View>
            </View>
            <View style={styles.kpiRow}>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Margen Bruto</Text>
                <Text style={styles.kpiValue}>{money(financial?.summary?.gross_margin || 0)}</Text>
              </View>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Resultado Neto</Text>
                <Text style={styles.kpiValue}>{money(financial?.summary?.net_result || 0)}</Text>
              </View>
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Movimientos de Caja</Text>
              {(financial?.cash_movements || []).slice(0, 30).map((move, idx) => (
                <View key={`${move.created_at}-${idx}`} style={styles.lineRow}>
                  <Text style={styles.lineLabel}>
                    {move.type === 'INCOME' ? 'Ingreso' : 'Gasto'} · {move.category || 'General'}
                  </Text>
                  <Text style={styles.lineValue}>{money(move.amount || 0)}</Text>
                </View>
              ))}
              {(financial?.cash_movements || []).length === 0 ? (
                <Text style={styles.emptyText}>Sin datos</Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {tab === 'production' ? (
          <View>
            <View style={styles.kpiRow}>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Ordenes</Text>
                <Text style={styles.kpiValue}>{production?.summary?.total_orders || 0}</Text>
              </View>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Completadas</Text>
                <Text style={styles.kpiValue}>{production?.summary?.completed_orders || 0}</Text>
              </View>
            </View>
            <View style={styles.kpiRow}>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Cant. Planeada</Text>
                <Text style={styles.kpiValue}>{Number(production?.summary?.planned_qty || 0).toLocaleString('es-CO')}</Text>
              </View>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Cant. Producida</Text>
                <Text style={styles.kpiValue}>{Number(production?.summary?.produced_qty || 0).toLocaleString('es-CO')}</Text>
              </View>
            </View>

            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Ordenes de Produccion</Text>
              {(production?.orders || []).slice(0, 30).map((order) => (
                <View key={order.production_order_id} style={styles.lineBlock}>
                  <Text style={styles.lineLabel}>
                    {order.product_name || 'Producto'} {order.variant_name ? `· ${order.variant_name}` : ''}
                  </Text>
                  <Text style={styles.lineValue}>
                    {order.status} · {order.quantity_produced}/{order.quantity_planned}
                  </Text>
                </View>
              ))}
              {(production?.orders || []).length === 0 ? (
                <Text style={styles.emptyText}>Sin datos</Text>
              ) : null}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0f14', padding: 12 },
  heroCard: {
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
  },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  heroTitle: { color: '#f8fafc', fontWeight: '800', fontSize: 18 },
  heroSub: { color: '#94a3b8', marginTop: 3, fontSize: 12 },
  sourcePill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  sourcePillServer: { borderColor: '#14532d', backgroundColor: '#052e16' },
  sourcePillCache: { borderColor: '#7c2d12', backgroundColor: '#431407' },
  sourcePillText: { color: '#e2e8f0', fontWeight: '700', fontSize: 11 },
  tabRow: { flexDirection: 'row', gap: 8, marginBottom: 2 },
  tabBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    paddingVertical: 9,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  tabBtnActive: { borderColor: '#38bdf8', backgroundColor: '#0a2842' },
  tabText: { color: '#cbd5e1', fontWeight: '700', fontSize: 12 },
  tabTextActive: { color: '#bae6fd' },
  filtersScroll: { maxHeight: 44, marginBottom: 8 },
  chipsRow: { flexDirection: 'row', gap: 6 },
  filterChip: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#0b1220',
  },
  filterChipActive: { borderColor: '#0ea5e9', backgroundColor: '#0b2942' },
  filterChipText: { color: '#cbd5e1', fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: '#bae6fd' },
  metaWrap: { marginBottom: 8, paddingHorizontal: 2 },
  metaText: { color: '#94a3b8', fontSize: 12, fontWeight: '600' },
  errorText: { color: '#fca5a5', marginTop: 4, fontSize: 12 },
  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  kpiCard: {
    flex: 1,
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    elevation: 1,
  },
  kpiLabel: { color: '#cbd5e1', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.3 },
  kpiValue: { color: '#f8fafc', fontSize: 18, fontWeight: '800', marginTop: 3 },
  sectionCard: {
    backgroundColor: '#0f172a',
    borderColor: '#1e293b',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  sectionTitle: { color: '#e2e8f0', fontWeight: '800', marginBottom: 8, fontSize: 14 },
  lineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
    gap: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    backgroundColor: '#0b1220',
  },
  lineBlock: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: '#0b1220',
  },
  lineLabel: { color: '#cbd5e1', fontSize: 12, flex: 1 },
  lineValue: { color: '#f8fafc', fontSize: 12, fontWeight: '700' },
  emptyText: { color: '#94a3b8', fontSize: 12, marginTop: 6, textAlign: 'center' },
});
