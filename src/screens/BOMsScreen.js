import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import PaginatedList from '../components/PaginatedList';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { useThemeMode } from '../lib/themeMode';
import { listBoms } from '../services/inventoryCatalog.service';

const TYPE_FILTERS = ['', 'product', 'variant'];

export default function BOMsScreen({ tenant, offlineMode, pageSize = 20 }) {
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';
  const [search, setSearch] = useState('');

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
    cacheNamespace: 'inventory-boms',
    initialFilters: { search: '', type: '' },
    fetchPage: async ({ page: nextPage, pageSize: nextPageSize, filters: nextFilters, tenantId }) => {
      const offset = (nextPage - 1) * nextPageSize;
      return listBoms({
        tenantId,
        search: nextFilters?.search || '',
        type: nextFilters?.type || null,
        limit: nextPageSize,
        offset,
      });
    },
  });

  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={styles.toolbar}>
        <TextInput
          style={[styles.searchInput, isLightTheme && styles.searchInputLight]}
          value={search}
          onChangeText={setSearch}
          placeholder="Buscar BOM"
          placeholderTextColor="#64748b"
          onSubmitEditing={() => updateFilters({ search })}
        />
        <Pressable style={[styles.searchBtn, isLightTheme && styles.searchBtnLight]} onPress={() => updateFilters({ search })}>
          <Text style={[styles.searchBtnText, isLightTheme && styles.searchBtnTextLight]}>Buscar</Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll}>
        <View style={styles.chipsRow}>
          {TYPE_FILTERS.map((type) => {
            const active = (filters?.type || '') === type;
            const label = type || 'Todos';
            return (
              <Pressable
                key={label}
                style={[
                  styles.filterChip,
                  isLightTheme && styles.filterChipLight,
                  active && styles.filterChipActive,
                  active && isLightTheme && styles.filterChipActiveLight,
                ]}
                onPress={() => updateFilters({ type })}
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
        title="Listas de Materiales (BOMs)"
        loading={loading}
        error={error}
        items={items}
        emptyText="No hay BOMs para este filtro."
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
          <View key={item.bom_id} style={[styles.card, isLightTheme && styles.cardLight]}>
            <Text style={[styles.title, isLightTheme && styles.titleLight]}>{item.bom_name || 'BOM sin nombre'}</Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>
              {item.product
                ? `Producto: ${item.product.name}`
                : item.variant
                  ? `Variante: ${item.variant.sku || ''} - ${item.variant.variant_name || ''}`
                  : 'Sin destino'}
            </Text>
            <View style={styles.badgesRow}>
              <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: '#0ea5e9' }]}>
                <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>{(item.bom_components || []).length} componente(s)</Text>
              </View>
              <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: '#a78bfa' }]}>
                <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>Version {item.version || 1}</Text>
              </View>
              <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: item.is_active ? '#16a34a' : '#ef4444' }]}>
                <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>{item.is_active ? 'Activo' : 'Inactivo'}</Text>
              </View>
            </View>
            {item.notes ? <Text style={[styles.note, isLightTheme && styles.noteLight]}>{item.notes}</Text> : null}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0f14', padding: 12 },
  containerLight: { backgroundColor: '#f8fafc' },
  toolbar: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  searchInput: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    color: '#f8fafc',
    paddingHorizontal: 10,
  },
  searchInputLight: {
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    color: '#0f172a',
  },
  searchBtn: {
    backgroundColor: '#1e40af',
    borderRadius: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBtnLight: { backgroundColor: '#1d4ed8' },
  searchBtnText: { color: '#dbeafe', fontWeight: '700' },
  searchBtnTextLight: { color: '#eff6ff' },
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
