import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import PaginatedList from '../components/PaginatedList';
import SearchableSelectField from '../components/SearchableSelectField';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { useThemeMode } from '../lib/themeMode';
import { listLocations, listPurchases } from '../services/inventoryCatalog.service';

export default function PurchasesScreen({ tenant, offlineMode, pageSize = 20, formatMoney }) {
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
    setError,
    changePage,
    updateFilters,
  } = usePaginatedList({
    tenantId: tenant?.tenant_id,
    pageSize,
    offlineMode,
    cacheNamespace: 'inventory-purchases',
    initialFilters: { location_id: '' },
    fetchPage: async ({ page: nextPage, pageSize: nextPageSize, filters: nextFilters, tenantId }) => {
      const offset = (nextPage - 1) * nextPageSize;
      return listPurchases({
        tenantId,
        locationId: nextFilters?.location_id || null,
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

  const money =
    formatMoney ||
    ((value) => `$ ${Math.round(Number(value || 0)).toLocaleString('es-CO')}`);

  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={[styles.noticeBox, isLightTheme && styles.noticeBoxLight]}>
        <Text style={[styles.noticeText, isLightTheme && styles.noticeTextLight]}>
          Compras en mobile: consulta y seguimiento. Registro/edición avanzada se mantiene en web.
        </Text>
      </View>

      <View style={styles.filtersBlock}>
        <SearchableSelectField
          title="Sede"
          themeMode={themeMode}
          valueLabel="Todas las sedes"
          clearLabel="Todas las sedes"
          placeholder="Todas las sedes"
          searchPlaceholder="Buscar sede..."
          options={(locations || []).map((loc) => ({
            key: loc.location_id,
            label: loc.name,
            searchText: loc.name,
          }))}
          selectedKey={filters?.location_id || ''}
          onSelect={(nextValue) => updateFilters({ location_id: nextValue || '' })}
        />
      </View>

      <PaginatedList
        themeMode={themeMode}
        title="Compras"
        loading={loading}
        error={error}
        items={items}
        emptyText="No hay compras para este filtro."
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
          <View key={item.purchase_id} style={[styles.card, isLightTheme && styles.cardLight]}>
            <Text style={[styles.title, isLightTheme && styles.titleLight]}>{item.product_name || 'Producto'}</Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>{item.sku || '-'} · {item.variant_name || '-'}</Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>{item.location_name || 'Sin sede'} · {new Date(item.purchased_at).toLocaleString()}</Text>
            <View style={styles.badgesRow}>
              <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: '#235ea9' }]}>
                <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>Cant. {Number(item.quantity || 0).toLocaleString('es-CO')}</Text>
              </View>
              <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: '#f59e0b' }]}>
                <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>Costo {money(item.unit_cost || 0)}</Text>
              </View>
              <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: '#16a34a' }]}>
                <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>Total {money(item.line_total || 0)}</Text>
              </View>
            </View>
            {item.note ? <Text style={[styles.note, isLightTheme && styles.noteLight]}>{item.note}</Text> : null}
          </View>
        )}
      />

      {offlineMode ? (
        <Pressable style={[styles.infoBtn, isLightTheme && styles.infoBtnLight]} onPress={() => setError('Modo offline: solo consulta con cache local.') }>
          <Text style={[styles.infoBtnText, isLightTheme && styles.infoBtnTextLight]}>Info offline</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060b16', padding: 12 },
  containerLight: { backgroundColor: '#edf2fb' },
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
  filtersBlock: { marginBottom: 8 },
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
  note: { color: '#94a3b8', marginTop: 8, fontSize: 12 },
  noteLight: { color: '#64748b' },
  infoBtn: {
    position: 'absolute',
    right: 16,
    bottom: 72,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#334155',
  },
  infoBtnText: { color: '#e2e8f0', fontWeight: '700' },
  infoBtnLight: { backgroundColor: '#dbe4ef' },
  infoBtnTextLight: { color: '#334155' },
});
