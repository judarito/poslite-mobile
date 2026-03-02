import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import PaginatedList from '../components/PaginatedList';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { useThemeMode } from '../lib/themeMode';
import {
  listInventoryMoves,
  listLocations,
  listStockBalances,
} from '../services/inventoryCatalog.service';

const TABS = [
  { key: 'stock', label: 'Stock' },
  { key: 'components', label: 'Insumos' },
  { key: 'kardex', label: 'Kardex' },
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

  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={styles.tabRow}>
        {TABS.map((tab) => {
          const active = filters?.tab === tab.key;
          return (
            <Pressable
              key={tab.key}
              style={[
                styles.tabBtn,
                isLightTheme && styles.tabBtnLight,
                active && styles.tabBtnActive,
                active && isLightTheme && styles.tabBtnActiveLight,
              ]}
              onPress={() => updateFilters({ tab: tab.key, move_type: '' })}
            >
              <Text
                style={[
                  styles.tabText,
                  isLightTheme && styles.tabTextLight,
                  active && styles.tabTextActive,
                  active && isLightTheme && styles.tabTextActiveLight,
                ]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll}>
        <View style={styles.chipsRow}>
          <Pressable
            style={[
              styles.filterChip,
              isLightTheme && styles.filterChipLight,
              !filters?.location_id && styles.filterChipActive,
              !filters?.location_id && isLightTheme && styles.filterChipActiveLight,
            ]}
            onPress={() => updateFilters({ location_id: '' })}
          >
            <Text
              style={[
                styles.filterChipText,
                isLightTheme && styles.filterChipTextLight,
                !filters?.location_id && styles.filterChipTextActive,
                !filters?.location_id && isLightTheme && styles.filterChipTextActiveLight,
              ]}
            >
              Todas las sedes
            </Text>
          </Pressable>
          {locations.map((loc) => {
            const active = filters?.location_id === loc.location_id;
            return (
              <Pressable
                key={loc.location_id}
                style={[
                  styles.filterChip,
                  isLightTheme && styles.filterChipLight,
                  active && styles.filterChipActive,
                  active && isLightTheme && styles.filterChipActiveLight,
                ]}
                onPress={() => updateFilters({ location_id: loc.location_id })}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    isLightTheme && styles.filterChipTextLight,
                    active && styles.filterChipTextActive,
                    active && isLightTheme && styles.filterChipTextActiveLight,
                  ]}
                >
                  {loc.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {filters?.tab === 'kardex' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll}>
          <View style={styles.chipsRow}>
            {MOVE_TYPES.map((type) => {
              const active = (filters?.move_type || '') === type;
              return (
                <Pressable
                  key={type || 'all'}
                  style={[
                    styles.filterChip,
                    isLightTheme && styles.filterChipLight,
                    active && styles.filterChipActive,
                    active && isLightTheme && styles.filterChipActiveLight,
                  ]}
                  onPress={() => updateFilters({ move_type: type })}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      isLightTheme && styles.filterChipTextLight,
                      active && styles.filterChipTextActive,
                      active && isLightTheme && styles.filterChipTextActiveLight,
                    ]}
                  >
                    {moveLabel(type)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
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
              <Text style={[styles.meta, isLightTheme && styles.metaLight]}>
                {item.location?.name || 'Sin sede'} · {new Date(item.created_at).toLocaleString()}
              </Text>
              <View style={styles.badgesRow}>
                <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: '#0ea5e9' }]}>
                  <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>{item.move_type}</Text>
                </View>
                <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: '#a78bfa' }]}>
                  <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>Cant. {Number(item.quantity || 0).toLocaleString('es-CO')}</Text>
                </View>
                <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: '#f59e0b' }]}>
                  <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>Costo {money(item.unit_cost || 0)}</Text>
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
  container: { flex: 1, backgroundColor: '#0b0f14', padding: 12 },
  containerLight: { backgroundColor: '#f8fafc' },
  tabRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  tabBtn: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    paddingVertical: 8,
    alignItems: 'center',
  },
  tabBtnActive: { borderColor: '#0ea5e9', backgroundColor: '#0b2942' },
  tabBtnLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  tabBtnActiveLight: { borderColor: '#0284c7', backgroundColor: '#e0f2fe' },
  tabText: { color: '#cbd5e1', fontWeight: '700', fontSize: 12 },
  tabTextLight: { color: '#334155' },
  tabTextActive: { color: '#bae6fd' },
  tabTextActiveLight: { color: '#0369a1' },
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
  filterChipLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  filterChipActiveLight: { borderColor: '#0284c7', backgroundColor: '#e0f2fe' },
  filterChipText: { color: '#cbd5e1', fontSize: 12, fontWeight: '600' },
  filterChipTextLight: { color: '#334155' },
  filterChipTextActive: { color: '#bae6fd' },
  filterChipTextActiveLight: { color: '#0369a1' },
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
  note: { color: '#94a3b8', marginTop: 8, fontSize: 12 },
  noteLight: { color: '#64748b' },
});
