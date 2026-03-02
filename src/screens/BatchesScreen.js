import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import PaginatedList from '../components/PaginatedList';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { useThemeMode } from '../lib/themeMode';
import { listBatches, listLocations } from '../services/inventoryCatalog.service';

const ALERT_FILTERS = ['', 'EXPIRED', 'CRITICAL', 'WARNING', 'OK'];

function calcAlert(expirationDate) {
  if (!expirationDate) return { label: 'Sin vencimiento', color: '#64748b' };
  const now = new Date();
  const exp = new Date(`${expirationDate}T00:00:00`);
  const days = Math.floor((exp.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  if (days < 0) return { label: 'Vencido', color: '#ef4444' };
  if (days <= 7) return { label: `Critico (${days}d)`, color: '#f97316' };
  if (days <= 30) return { label: `Advertencia (${days}d)`, color: '#f59e0b' };
  return { label: `OK (${days}d)`, color: '#16a34a' };
}

export default function BatchesScreen({ tenant, offlineMode, pageSize = 20 }) {
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
    cacheNamespace: 'inventory-batches',
    initialFilters: { location_id: '', alert_level: '' },
    fetchPage: async ({ page: nextPage, pageSize: nextPageSize, filters: nextFilters, tenantId }) => {
      const offset = (nextPage - 1) * nextPageSize;
      return listBatches({
        tenantId,
        locationId: nextFilters?.location_id || null,
        alertLevel: nextFilters?.alert_level || null,
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
          {ALERT_FILTERS.map((level) => {
            const active = (filters?.alert_level || '') === level;
            const label = level || 'Todos';
            return (
              <Pressable
                key={label}
                style={[
                  styles.filterChip,
                  isLightTheme && styles.filterChipLight,
                  active && styles.filterChipActive,
                  active && isLightTheme && styles.filterChipActiveLight,
                ]}
                onPress={() => updateFilters({ alert_level: level })}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    isLightTheme && styles.filterChipTextLight,
                    active && styles.filterChipTextActive,
                    active && isLightTheme && styles.filterChipTextActiveLight,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <PaginatedList
        themeMode={themeMode}
        title="Lotes y Vencimientos"
        loading={loading}
        error={error}
        items={items}
        emptyText="No hay lotes para este filtro."
        page={page}
        totalPages={totalPages}
        onPrev={() => changePage(page - 1)}
        onNext={() => changePage(page + 1)}
        footerMeta={
          cacheInfo?.source === 'cache' && cacheInfo?.cachedAt
            ? `Offline cache: ${new Date(cacheInfo.cachedAt).toLocaleString()}`
            : null
        }
        renderItem={(item) => {
          const alert = calcAlert(item.expiration_date);
          return (
            <View key={item.batch_id} style={[styles.card, isLightTheme && styles.cardLight]}>
              <Text style={[styles.title, isLightTheme && styles.titleLight]}>{item.variant?.product?.name || 'Producto'}</Text>
              <Text style={[styles.meta, isLightTheme && styles.metaLight]}>{item.variant?.sku || '-'} · {item.variant?.variant_name || '-'}</Text>
              <Text style={[styles.meta, isLightTheme && styles.metaLight]}>{item.location?.name || 'Sin sede'} · Lote {item.batch_number || '-'}</Text>
              <View style={styles.badgesRow}>
                <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: '#38bdf8' }]}>
                  <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>Stock {Number(item.on_hand || 0).toLocaleString('es-CO')}</Text>
                </View>
                <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: '#a78bfa' }]}>
                  <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>Res {Number(item.reserved || 0).toLocaleString('es-CO')}</Text>
                </View>
                <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: alert.color }]}>
                  <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>{alert.label}</Text>
                </View>
              </View>
              <Text style={[styles.note, isLightTheme && styles.noteLight]}>
                {item.expiration_date ? `Vence: ${new Date(`${item.expiration_date}T00:00:00`).toLocaleDateString()}` : 'Sin fecha de vencimiento'}
              </Text>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0f14', padding: 12 },
  containerLight: { backgroundColor: '#f8fafc' },
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
