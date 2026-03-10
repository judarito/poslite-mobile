import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import PaginatedList from '../components/PaginatedList';
import SearchableSelectField from '../components/SearchableSelectField';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { useThemeMode } from '../lib/themeMode';
import {
  listInventoryMoves,
  listLocations,
  listStockBalances,
} from '../services/inventoryCatalog.service';

const TABS = [
  { key: 'stock', label: 'Stock Actual' },
  { key: 'components', label: 'Insumos' },
  { key: 'kardex', label: 'Kardex / Movimientos' },
];

const MOVE_TYPES = [
  '',
  'PURCHASE_IN',
  'SALE_OUT',
  'RETURN_IN',
  'ADJUSTMENT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'PRODUCTION_IN',
  'PRODUCTION_OUT',
];

function moveLabel(type) {
  return type || 'Todos';
}

function moveTypeLabel(type) {
  const map = {
    PURCHASE_IN: 'Compra',
    SALE_OUT: 'Venta',
    RETURN_IN: 'Devolucion',
    ADJUSTMENT: 'Ajuste',
    TRANSFER_OUT: 'Traslado salida',
    TRANSFER_IN: 'Traslado entrada',
    PRODUCTION_IN: 'Produccion entrada',
    PRODUCTION_OUT: 'Produccion salida',
  };
  return map[type] || type || '-';
}

function getAlert(item) {
  const onHand = Number(item.on_hand || 0);
  const min = Number(item.variant?.min_stock || 0);
  if (onHand <= 0) return { label: 'Sin stock', color: '#ef4444' };
  if (onHand <= min && min > 0) return { label: 'Stock bajo', color: '#f59e0b' };
  return { label: 'OK', color: '#16a34a' };
}

export default function InventoryScreen({ tenant, offlineMode, pageSize = 20, formatMoney }) {
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';
  const [locations, setLocations] = useState([]);

  const {
    items,
    page,
    totalPages,
    loading,
    error,
    cacheInfo,
    filters,
    changePage,
    updateFilters,
  } = usePaginatedList({
    tenantId: tenant?.tenant_id,
    pageSize,
    offlineMode,
    cacheNamespace: 'inventory-main',
    initialFilters: {
      tab: 'stock',
      location_id: '',
      move_type: '',
    },
    fetchPage: async ({ page: nextPage, pageSize: nextPageSize, filters: nextFilters, tenantId }) => {
      const offset = (nextPage - 1) * nextPageSize;
      if (nextFilters?.tab === 'kardex') {
        return listInventoryMoves({
          tenantId,
          locationId: nextFilters?.location_id || null,
          moveType: nextFilters?.move_type || null,
          limit: nextPageSize,
          offset,
        });
      }

      return listStockBalances({
        tenantId,
        locationId: nextFilters?.location_id || null,
        isComponent: nextFilters?.tab === 'components',
        limit: nextPageSize,
        offset,
      });
    },
  });

  useEffect(() => {
    const load = async () => {
      if (!tenant?.tenant_id) return;
      const result = await listLocations(tenant.tenant_id);
      if (result.success) {
        setLocations(result.data || []);
      }
    };
    load();
  }, [tenant?.tenant_id]);

  const money = useMemo(
    () =>
      formatMoney ||
      ((value) =>
        `$ ${Math.round(Number(value || 0)).toLocaleString('es-CO')}`),
    [formatMoney],
  );
  const tabFilterOptions = useMemo(
    () => TABS.map((tab) => ({ key: tab.key, label: tab.label, searchText: tab.label })),
    [],
  );
  const locationFilterOptions = useMemo(
    () =>
      (locations || []).map((loc) => ({
        key: loc.location_id,
        label: loc.name,
        searchText: loc.name,
      })),
    [locations],
  );
  const moveTypeFilterOptions = useMemo(
    () =>
      MOVE_TYPES.filter(Boolean).map((type) => ({
        key: type,
        label: moveLabel(type),
      })),
    [],
  );

  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={styles.filtersBlock}>
        <SearchableSelectField
          title="Vista"
          themeMode={themeMode}
          valueLabel={TABS.find((tab) => tab.key === filters?.tab)?.label || 'Stock Actual'}
          placeholder="Seleccionar vista"
          searchPlaceholder="Buscar vista..."
          options={tabFilterOptions}
          selectedKey={filters?.tab || 'stock'}
          onSelect={(nextValue) => updateFilters({ tab: nextValue || 'stock', move_type: '' })}
          allowClear={false}
        />
      </View>

      <View style={styles.filtersBlock}>
        <SearchableSelectField
          title="Sede"
          themeMode={themeMode}
          valueLabel="Todas las sedes"
          clearLabel="Todas las sedes"
          placeholder="Todas las sedes"
          searchPlaceholder="Buscar sede..."
          options={locationFilterOptions}
          selectedKey={filters?.location_id || ''}
          onSelect={(nextValue) => updateFilters({ location_id: nextValue || '' })}
        />
      </View>

      {filters?.tab === 'kardex' ? (
        <View style={styles.filtersBlock}>
          <SearchableSelectField
            title="Tipo de movimiento"
            themeMode={themeMode}
            valueLabel="Todos"
            clearLabel="Todos"
            placeholder="Todos"
            searchPlaceholder="Buscar movimiento..."
            options={moveTypeFilterOptions}
            selectedKey={filters?.move_type || ''}
            onSelect={(nextValue) => updateFilters({ move_type: nextValue || '' })}
          />
        </View>
      ) : null}

      <PaginatedList
        themeMode={themeMode}
        title={
          filters?.tab === 'kardex'
            ? 'Kardex / Movimientos'
            : filters?.tab === 'components'
              ? 'Insumos por sede'
              : 'Stock por sede'
        }
        loading={loading}
        error={error}
        items={items}
        emptyText="No hay registros para este filtro."
        page={page}
        totalPages={totalPages}
        onPrev={() => changePage(page - 1)}
        onNext={() => changePage(page + 1)}
        footerMeta={
          cacheInfo?.source === 'cache' && cacheInfo?.cachedAt
            ? `Offline cache: ${new Date(cacheInfo.cachedAt).toLocaleString()}`
            : null
        }
        renderItem={(item) =>
          filters?.tab === 'kardex' ? (
            <View key={item.inventory_move_id} style={[styles.card, isLightTheme && styles.cardLight]}>
              <Text style={[styles.title, isLightTheme && styles.titleLight]}>{item.variant?.product?.name || 'Producto'}</Text>
              <Text style={[styles.meta, isLightTheme && styles.metaLight]}>{item.variant?.sku || '-'} · {item.variant?.variant_name || '-'}</Text>
              <View style={[styles.kardexRows, isLightTheme && styles.kardexRowsLight]}>
                <View style={styles.kardexRow}>
                  <Text style={[styles.kardexLabel, isLightTheme && styles.kardexLabelLight]}>Fecha</Text>
                  <Text style={[styles.kardexValue, isLightTheme && styles.kardexValueLight]}>{new Date(item.created_at).toLocaleString()}</Text>
                </View>
                <View style={styles.kardexRow}>
                  <Text style={[styles.kardexLabel, isLightTheme && styles.kardexLabelLight]}>Sede</Text>
                  <Text style={[styles.kardexValue, isLightTheme && styles.kardexValueLight]}>{item.location?.name || 'Sin sede'}</Text>
                </View>
                <View style={styles.kardexRow}>
                  <Text style={[styles.kardexLabel, isLightTheme && styles.kardexLabelLight]}>Tipo</Text>
                  <Text style={[styles.kardexValue, isLightTheme && styles.kardexValueLight]}>{moveTypeLabel(item.move_type)}</Text>
                </View>
                <View style={styles.kardexRow}>
                  <Text style={[styles.kardexLabel, isLightTheme && styles.kardexLabelLight]}>Cantidad</Text>
                  <Text
                    style={[
                      styles.kardexValue,
                      isLightTheme && styles.kardexValueLight,
                      Number(item.quantity || 0) >= 0 ? styles.qtyPositive : styles.qtyNegative,
                    ]}
                  >
                    {Number(item.quantity || 0) >= 0 ? '+' : ''}{Number(item.quantity || 0).toLocaleString('es-CO')}
                  </Text>
                </View>
                <View style={styles.kardexRow}>
                  <Text style={[styles.kardexLabel, isLightTheme && styles.kardexLabelLight]}>Costo unitario</Text>
                  <Text style={[styles.kardexValue, isLightTheme && styles.kardexValueLight]}>{money(item.unit_cost || 0)}</Text>
                </View>
                <View style={styles.kardexRow}>
                  <Text style={[styles.kardexLabel, isLightTheme && styles.kardexLabelLight]}>Origen</Text>
                  <Text style={[styles.kardexValue, isLightTheme && styles.kardexValueLight]}>{item.source || '-'}</Text>
                </View>
                <View style={styles.kardexRow}>
                  <Text style={[styles.kardexLabel, isLightTheme && styles.kardexLabelLight]}>Usuario</Text>
                  <Text style={[styles.kardexValue, isLightTheme && styles.kardexValueLight]}>{item.created_by_user?.full_name || '-'}</Text>
                </View>
              </View>
              {item.note ? <Text style={[styles.note, isLightTheme && styles.noteLight]}>{item.note}</Text> : null}
            </View>
          ) : (
            <View key={`${item.location_id}-${item.variant_id}`} style={[styles.card, isLightTheme && styles.cardLight]}>
              <Text style={[styles.title, isLightTheme && styles.titleLight]}>{item.variant?.product?.name || 'Producto'}</Text>
              <Text style={[styles.meta, isLightTheme && styles.metaLight]}>{item.variant?.sku || '-'} · {item.variant?.variant_name || '-'}</Text>
              <Text style={[styles.meta, isLightTheme && styles.metaLight]}>{item.location?.name || 'Sin sede'}</Text>
              <View style={styles.badgesRow}>
                <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: '#38bdf8' }]}>
                  <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>Stock {Number(item.on_hand || 0).toLocaleString('es-CO')}</Text>
                </View>
                <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: '#a78bfa' }]}>
                  <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>Min {Number(item.variant?.min_stock || 0).toLocaleString('es-CO')}</Text>
                </View>
                <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: getAlert(item).color }]}>
                  <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>{getAlert(item).label}</Text>
                </View>
              </View>
              <Text style={[styles.note, isLightTheme && styles.noteLight]}>
                Costo {money(item.variant?.cost || 0)} · Valor {money(Number(item.on_hand || 0) * Number(item.variant?.cost || 0))}
              </Text>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060b16', padding: 12 },
  containerLight: { backgroundColor: '#edf2fb' },
  filtersBlock: { marginBottom: 8 },
  tabScroll: { marginBottom: 8 },
  tabRow: { flexDirection: 'row', gap: 8, alignItems: 'stretch', paddingBottom: 2 },
  tabBtn: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    minHeight: 42,
    minWidth: 132,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabBtnActive: { borderColor: '#235ea9', backgroundColor: '#235ea9' },
  tabBtnLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  tabBtnActiveLight: { borderColor: '#235ea9', backgroundColor: '#e6f0ff' },
  tabText: { color: '#cbd5e1', fontWeight: '700', fontSize: 13 },
  tabTextLight: { color: '#334155' },
  tabTextActive: { color: '#eff6ff' },
  tabTextActiveLight: { color: '#235ea9' },
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
  filterChipActive: { borderColor: '#235ea9', backgroundColor: '#235ea9' },
  filterChipLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  filterChipActiveLight: { borderColor: '#235ea9', backgroundColor: '#e6f0ff' },
  filterChipText: { color: '#cbd5e1', fontSize: 12, fontWeight: '600' },
  filterChipTextLight: { color: '#334155' },
  filterChipTextActive: { color: '#eff6ff' },
  filterChipTextActiveLight: { color: '#235ea9' },
  card: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  cardLight: { backgroundColor: '#ffffff', borderColor: '#dbe4ef' },
  title: { color: '#f8fafc', fontWeight: '700', fontSize: 15 },
  titleLight: { color: '#0f172a' },
  meta: { color: '#cbd5e1', marginTop: 2, fontSize: 13 },
  metaLight: { color: '#475569' },
  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#0f172a',
  },
  badgeLight: { backgroundColor: '#f8fafc' },
  badgeText: { color: '#e2e8f0', fontSize: 11, fontWeight: '700' },
  badgeTextLight: { color: '#334155' },
  kardexRows: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 8,
    gap: 4,
  },
  kardexRowsLight: {
    borderTopColor: '#dbe4ef',
  },
  kardexRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  kardexLabel: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
  },
  kardexLabelLight: {
    color: '#64748b',
  },
  kardexValue: {
    color: '#e2e8f0',
    fontSize: 12,
    flexShrink: 1,
    textAlign: 'right',
  },
  kardexValueLight: {
    color: '#334155',
  },
  qtyPositive: {
    color: '#16a34a',
    fontWeight: '700',
  },
  qtyNegative: {
    color: '#dc2626',
    fontWeight: '700',
  },
  note: { color: '#94a3b8', marginTop: 8, fontSize: 12 },
  noteLight: { color: '#64748b' },
});
