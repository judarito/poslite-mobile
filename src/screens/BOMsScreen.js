import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import PaginatedList from '../components/PaginatedList';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { listBoms } from '../services/inventoryCatalog.service';

const TYPE_FILTERS = ['', 'product', 'variant'];

export default function BOMsScreen({ tenant, offlineMode, pageSize = 20 }) {
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
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Buscar BOM"
          placeholderTextColor="#64748b"
          onSubmitEditing={() => updateFilters({ search })}
        />
        <Pressable style={styles.searchBtn} onPress={() => updateFilters({ search })}>
          <Text style={styles.searchBtnText}>Buscar</Text>
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
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => updateFilters({ type })}
              >
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <PaginatedList
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
          <View key={item.bom_id} style={styles.card}>
            <Text style={styles.title}>{item.bom_name || 'BOM sin nombre'}</Text>
            <Text style={styles.meta}>
              {item.product
                ? `Producto: ${item.product.name}`
                : item.variant
                  ? `Variante: ${item.variant.sku || ''} - ${item.variant.variant_name || ''}`
                  : 'Sin destino'}
            </Text>
            <View style={styles.badgesRow}>
              <View style={[styles.badge, { borderColor: '#0ea5e9' }]}>
                <Text style={styles.badgeText}>{(item.bom_components || []).length} componente(s)</Text>
              </View>
              <View style={[styles.badge, { borderColor: '#a78bfa' }]}>
                <Text style={styles.badgeText}>Version {item.version || 1}</Text>
              </View>
              <View style={[styles.badge, { borderColor: item.is_active ? '#16a34a' : '#ef4444' }]}>
                <Text style={styles.badgeText}>{item.is_active ? 'Activo' : 'Inactivo'}</Text>
              </View>
            </View>
            {item.notes ? <Text style={styles.note}>{item.notes}</Text> : null}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0f14', padding: 12 },
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
  searchBtn: {
    backgroundColor: '#1e40af',
    borderRadius: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBtnText: { color: '#dbeafe', fontWeight: '700' },
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
  card: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  title: { color: '#f8fafc', fontWeight: '700', fontSize: 15 },
  meta: { color: '#cbd5e1', marginTop: 2, fontSize: 13 },
  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#0f172a',
  },
  badgeText: { color: '#e2e8f0', fontSize: 11, fontWeight: '700' },
  note: { color: '#94a3b8', marginTop: 8, fontSize: 12 },
});
