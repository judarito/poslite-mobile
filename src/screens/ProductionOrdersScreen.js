import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import PaginatedList from '../components/PaginatedList';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { useThemeMode } from '../lib/themeMode';
import {
  listLocations,
  listProductionOrders,
} from '../services/inventoryCatalog.service';

const STATUS_FILTERS = ['', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

function statusColor(status) {
  if (status === 'PENDING') return '#f59e0b';
  if (status === 'IN_PROGRESS') return '#0ea5e9';
  if (status === 'COMPLETED') return '#16a34a';
  if (status === 'CANCELLED') return '#ef4444';
  return '#64748b';
}

export default function ProductionOrdersScreen({ tenant, offlineMode, pageSize = 20 }) {
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
    cacheNamespace: 'inventory-production-orders',
    initialFilters: { location_id: '', status: '' },
    fetchPage: async ({ page: nextPage, pageSize: nextPageSize, filters: nextFilters, tenantId }) => {
      const offset = (nextPage - 1) * nextPageSize;
      return listProductionOrders({
        tenantId,
        locationId: nextFilters?.location_id || null,
        status: nextFilters?.status || null,
        limit: nextPageSize,
        offset,
      });
    },
  });

  useEffect(() => {
    const load = async () => {
      if (!tenant?.tenant_id) return;
      const result = await listLocations(tenant.tenant_id);
      if (result.success) setLocations(result.data || []);
    };
    load();
  }, [tenant?.tenant_id]);

  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={[styles.noticeBox, isLightTheme && styles.noticeBoxLight]}>
        <Text style={[styles.noticeText, isLightTheme && styles.noticeTextLight]}>
          Órdenes en mobile: monitoreo de estado y avance. Gestión operativa completa en web.
        </Text>
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
              Todas sedes
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

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll}>
        <View style={styles.chipsRow}>
          {STATUS_FILTERS.map((status) => {
            const active = (filters?.status || '') === status;
            return (
              <Pressable
                key={status || 'all'}
                style={[
                  styles.filterChip,
                  isLightTheme && styles.filterChipLight,
                  active && styles.filterChipActive,
                  active && isLightTheme && styles.filterChipActiveLight,
                ]}
                onPress={() => updateFilters({ status })}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    isLightTheme && styles.filterChipTextLight,
                    active && styles.filterChipTextActive,
                    active && isLightTheme && styles.filterChipTextActiveLight,
                  ]}
                >
                  {status || 'Todos'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <PaginatedList
        themeMode={themeMode}
        title="Ordenes de Produccion"
        loading={loading}
        error={error}
        items={items}
        emptyText="No hay ordenes para este filtro."
        page={page}
        totalPages={totalPages}
        onPrev={() => changePage(page - 1)}
        onNext={() => changePage(page + 1)}
        footerMeta={
          cacheInfo?.source === 'cache' && cacheInfo?.cachedAt
            ? `Offline cache: ${new Date(cacheInfo.cachedAt).toLocaleString()}`
            : null
        }
        renderItem={(item) => (
          <View key={item.production_order_id} style={[styles.card, isLightTheme && styles.cardLight]}>
            <Text style={[styles.title, isLightTheme && styles.titleLight]}>{item.order_number || 'Sin numero'}</Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>{item.location?.name || 'Sin sede'}</Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>
              {item.bom?.bom_name || 'Sin BOM'} · {item.bom?.product?.name || item.bom?.variant?.variant_name || '-'}
            </Text>
            <View style={styles.badgesRow}>
              <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: statusColor(item.status) }]}>
                <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>{item.status || '-'}</Text>
              </View>
              <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: '#a78bfa' }]}>
                <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>Plan {Number(item.quantity_planned || 0).toLocaleString('es-CO')}</Text>
              </View>
              <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: '#16a34a' }]}>
                <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>Prod {Number(item.quantity_produced || 0).toLocaleString('es-CO')}</Text>
              </View>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0f14', padding: 12 },
  containerLight: { backgroundColor: '#f8fafc' },
  noticeBox: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    backgroundColor: '#111827',
    padding: 10,
    marginBottom: 8,
  },
  noticeText: { color: '#cbd5e1', fontSize: 12 },
  noticeBoxLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  noticeTextLight: { color: '#475569' },
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
});
