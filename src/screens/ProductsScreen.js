import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PaginatedList from '../components/PaginatedList';
import SearchableSelectField from '../components/SearchableSelectField';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { useThemeMode } from '../lib/themeMode';
import { listActiveUnits } from '../services/units.service';
import {
  createProduct,
  listCategoryOptions,
  listProducts,
  removeProduct,
  updateProduct,
} from '../services/productsCatalog.service';

const PRODUCT_TABS = [
  { value: false, label: 'Productos para venta' },
  { value: true, label: 'Insumos/componentes' },
];

const EMPTY_FORM = {
  product_id: null,
  name: '',
  description: '',
  category_id: null,
  unit_id: null,
  is_active: true,
  track_inventory: true,
  requires_expiration: false,
  inventory_behavior: 'RESELL',
  is_component: false,
};

function boolText(value, yes, no) {
  return value ? yes : no;
}

export default function ProductsScreen({ tenant, offlineMode, pageSize = 20 }) {
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [unitOptions, setUnitOptions] = useState([]);
  const [expandedVariants, setExpandedVariants] = useState({});
  const categorySelectOptions = useMemo(
    () =>
      (categoryOptions || []).map((cat) => ({
        key: cat.category_id,
        label: cat.name,
        searchText: cat.name,
      })),
    [categoryOptions],
  );
  const unitSelectOptions = useMemo(
    () =>
      (unitOptions || []).map((unit) => ({
        key: unit.unit_id,
        label: `${unit.code} - ${unit.name}${unit.is_system ? ' (sistema)' : ''}`,
        searchText: `${unit.code} ${unit.name}`,
      })),
    [unitOptions],
  );

  const {
    items: rows,
    page,
    totalPages,
    loading,
    error,
    cacheInfo,
    filters,
    setError,
    changePage,
    updateFilters,
    loadPage,
  } = usePaginatedList({
    tenantId: tenant?.tenant_id,
    pageSize,
    offlineMode,
    cacheNamespace: 'catalog-products',
    initialFilters: { search: '', isComponent: false },
    fetchPage: async ({ page: nextPage, pageSize: nextPageSize, filters: nextFilters, tenantId }) => {
      const offset = (nextPage - 1) * nextPageSize;
      return listProducts({
        tenantId,
        search: nextFilters?.search || '',
        limit: nextPageSize,
        offset,
        isComponent: nextFilters?.isComponent,
      });
    },
  });

  useEffect(() => {
    const loadLookups = async () => {
      if (!tenant?.tenant_id) return;
      const [cats, units] = await Promise.all([
        listCategoryOptions(tenant.tenant_id),
        listActiveUnits(tenant.tenant_id),
      ]);

      if (cats.success) setCategoryOptions(cats.data || []);
      if (units.success) setUnitOptions(units.data || []);
    };

    loadLookups();
  }, [tenant?.tenant_id]);

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, is_component: filters?.isComponent === true });
    setModalOpen(true);
  };

  const openEdit = (item) => {
    setForm({
      product_id: item.product_id,
      name: item.name || '',
      description: item.description || '',
      category_id: item.category_id || null,
      unit_id: item.unit_id || null,
      is_active: item.is_active !== false,
      track_inventory: item.track_inventory !== false,
      requires_expiration: item.requires_expiration === true,
      inventory_behavior: item.inventory_behavior || 'RESELL',
      is_component: item.is_component === true,
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (offlineMode) {
      setError('Productos no permite escritura en modo offline.');
      return;
    }

    const name = String(form.name || '').trim();
    if (!name) {
      setError('Nombre del producto es obligatorio.');
      return;
    }

    setSaving(true);
    setError('');

    const payload = {
      tenant_id: tenant?.tenant_id,
      name,
      description: String(form.description || '').trim() || null,
      category_id: form.category_id || null,
      unit_id: form.unit_id || null,
      is_active: form.is_active !== false,
      track_inventory: form.track_inventory !== false,
      requires_expiration: form.requires_expiration === true,
      inventory_behavior: form.inventory_behavior || 'RESELL',
      is_component: form.is_component === true,
    };

    const result = form.product_id
      ? await updateProduct(form.product_id, tenant?.tenant_id, payload)
      : await createProduct(payload);

    if (!result.success) {
      setError(result.error || 'No se pudo guardar producto');
      setSaving(false);
      return;
    }

    setModalOpen(false);
    setForm({ ...EMPTY_FORM });
    await loadPage(page, filters);
    setSaving(false);
  };

  const remove = (item) => {
    Alert.alert('Eliminar producto', `Se eliminara ${item.name}.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          if (offlineMode) {
            setError('No puedes eliminar productos en modo offline.');
            return;
          }

          const result = await removeProduct(item.product_id, tenant?.tenant_id);
          if (!result.success) {
            setError(result.error || 'No se pudo eliminar producto');
            return;
          }
          await loadPage(page, filters);
        },
      },
    ]);
  };

  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={styles.tabRow}>
        {PRODUCT_TABS.map((tab) => {
          const active = Boolean(filters?.isComponent) === tab.value;
          return (
            <Pressable
              key={tab.label}
              style={[styles.tabBtn, isLightTheme && styles.tabBtnLight, active && styles.tabBtnActive]}
              onPress={() => updateFilters({ isComponent: tab.value })}
            >
              <Text style={[styles.tabText, isLightTheme && styles.tabTextLight, active && styles.tabTextActive]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.toolbar}>
        <TextInput
          style={[styles.searchInput, isLightTheme && styles.searchInputLight]}
          value={search}
          onChangeText={setSearch}
          placeholder="Buscar por nombre o descripcion"
          placeholderTextColor="#64748b"
          onSubmitEditing={() => updateFilters({ search })}
        />
        <Pressable style={styles.searchBtn} onPress={() => updateFilters({ search })}>
          <View style={styles.btnContentRow}>
            <Ionicons name="search-outline" size={16} color="#dbeafe" />
            <Text style={styles.searchBtnText}>Buscar</Text>
          </View>
        </Pressable>
      </View>

      <PaginatedList
        themeMode={themeMode}
        title={filters?.isComponent ? 'Insumos / Componentes' : 'Productos'}
        loading={loading}
        error={error}
        items={rows}
        emptyText="No hay productos registrados."
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
          <View key={item.product_id} style={[styles.card, isLightTheme && styles.cardLight]}>
            <Text style={[styles.title, isLightTheme && styles.titleLight]}>{item.name}</Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>{item.category?.name || 'Sin categoria'}</Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>{item.unit ? `${item.unit.code} - ${item.unit.name}` : 'Sin unidad'}</Text>
            <View style={styles.badgesRow}>
              <View style={[styles.badge, item.is_active ? styles.badgeGreen : styles.badgeRed]}>
                <Text style={styles.badgeText}>{item.is_active ? 'Activo' : 'Inactivo'}</Text>
              </View>
              <View style={[styles.badge, styles.badgeBlue]}>
                <Text style={styles.badgeText}>{item.product_variants?.length || 0} variante(s)</Text>
              </View>
              {item.track_inventory ? (
                <View style={[styles.badge, styles.badgeSky]}>
                  <Text style={styles.badgeText}>Inventario</Text>
                </View>
              ) : null}
            </View>
            {(item.product_variants || []).length > 0 ? (
              <Pressable
                style={[styles.variantToggleBtn, isLightTheme && styles.variantToggleBtnLight]}
                onPress={() =>
                  setExpandedVariants((prev) => ({
                    ...prev,
                    [item.product_id]: !prev[item.product_id],
                  }))
                }
              >
                <View style={styles.btnContentRow}>
                  <Ionicons
                    name={expandedVariants[item.product_id] ? 'eye-off-outline' : 'eye-outline'}
                    size={14}
                    color={isLightTheme ? '#0369a1' : '#bae6fd'}
                  />
                  <Text style={[styles.variantToggleText, isLightTheme && styles.variantToggleTextLight]}>
                    {expandedVariants[item.product_id] ? 'Ocultar variantes' : 'Ver variantes'}
                  </Text>
                </View>
              </Pressable>
            ) : null}
            {expandedVariants[item.product_id] ? (
              <View style={[styles.variantsBox, isLightTheme && styles.variantsBoxLight]}>
                {(item.product_variants || []).map((variant) => (
                  <View key={variant.variant_id} style={[styles.variantRow, isLightTheme && styles.variantRowLight]}>
                    <Text style={[styles.variantName, isLightTheme && styles.variantNameLight]}>
                      {variant.variant_name || 'Variante sin nombre'}
                    </Text>
                    <Text style={[styles.variantMeta, isLightTheme && styles.variantMetaLight]}>
                      SKU: {variant.sku || '-'} · Precio: {Number(variant.price || 0).toLocaleString('es-CO')} · Costo: {Number(variant.cost || 0).toLocaleString('es-CO')}
                    </Text>
                    <Text style={[styles.variantMeta, isLightTheme && styles.variantMetaLight]}>
                      Min stock: {variant.min_stock ?? '-'} · {variant.is_active ? 'Activa' : 'Inactiva'}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            <View style={styles.actions}>
              <Pressable style={styles.secondaryBtn} onPress={() => openEdit(item)}>
                <View style={styles.btnContentRow}>
                  <Ionicons name="create-outline" size={15} color="#dbeafe" />
                  <Text style={styles.secondaryBtnText}>Editar</Text>
                </View>
              </Pressable>
              <Pressable style={styles.dangerBtn} onPress={() => remove(item)}>
                <View style={styles.btnContentRow}>
                  <Ionicons name="trash-outline" size={15} color="#fee2e2" />
                  <Text style={styles.dangerBtnText}>Eliminar</Text>
                </View>
              </Pressable>
            </View>
          </View>
        )}
      />

      <Pressable style={styles.fab} onPress={openCreate}>
        <View style={styles.btnContentRow}>
          <Ionicons name="add-circle-outline" size={16} color="#451a03" />
          <Text style={styles.fabText}>Nuevo</Text>
        </View>
      </Pressable>

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBody, isLightTheme && styles.modalBodyLight]}>
            <ScrollView>
              <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>{form.product_id ? 'Editar producto' : 'Nuevo producto'}</Text>

              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={form.name}
                onChangeText={(v) => setForm((prev) => ({ ...prev, name: v }))}
                placeholder="Nombre *"
                placeholderTextColor="#64748b"
              />

              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight, { minHeight: 70 }]}
                value={form.description}
                onChangeText={(v) => setForm((prev) => ({ ...prev, description: v }))}
                placeholder="Descripcion"
                placeholderTextColor="#64748b"
                multiline
              />

              <Text style={[styles.groupTitle, isLightTheme && styles.groupTitleLight]}>Tipo</Text>
              <View style={styles.toggleRow}>
                <Pressable
                  style={[styles.toggleBtn, isLightTheme && styles.toggleBtnLight, !form.is_component && styles.toggleBtnActive]}
                  onPress={() =>
                    setForm((prev) => ({ ...prev, is_component: false, inventory_behavior: 'RESELL' }))
                  }
                >
                  <Text style={[styles.toggleBtnText, isLightTheme && styles.toggleBtnTextLight, !form.is_component && styles.toggleBtnTextActive]}>
                    Producto para venta
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.toggleBtn, isLightTheme && styles.toggleBtnLight, form.is_component && styles.toggleBtnActive]}
                  onPress={() =>
                    setForm((prev) => ({ ...prev, is_component: true, inventory_behavior: 'MANUFACTURED' }))
                  }
                >
                  <Text style={[styles.toggleBtnText, isLightTheme && styles.toggleBtnTextLight, form.is_component && styles.toggleBtnTextActive]}>
                    Componente
                  </Text>
                </Pressable>
              </View>

              <SearchableSelectField
                title="Categoria"
                themeMode={themeMode}
                valueLabel="Sin categoria"
                clearLabel="Sin categoria"
                placeholder="Seleccionar categoria"
                searchPlaceholder="Buscar categoria..."
                options={categorySelectOptions}
                selectedKey={form.category_id}
                onSelect={(nextValue) => setForm((prev) => ({ ...prev, category_id: nextValue }))}
              />

              <SearchableSelectField
                title="Unidad de medida"
                themeMode={themeMode}
                valueLabel="Sin unidad"
                clearLabel="Sin unidad"
                placeholder="Seleccionar unidad"
                searchPlaceholder="Buscar unidad..."
                options={unitSelectOptions}
                selectedKey={form.unit_id}
                onSelect={(nextValue) => setForm((prev) => ({ ...prev, unit_id: nextValue }))}
              />

              <Text style={[styles.groupTitle, isLightTheme && styles.groupTitleLight]}>Configuracion</Text>
              <View style={styles.switchRowWrap}>
                <Pressable
                  style={[styles.switchCard, isLightTheme && styles.switchCardLight, form.is_active && styles.switchCardActive]}
                  onPress={() => setForm((prev) => ({ ...prev, is_active: !prev.is_active }))}
                >
                  <Text style={[styles.switchTitle, isLightTheme && styles.switchTitleLight]}>Producto activo</Text>
                  <Text style={[styles.switchDesc, isLightTheme && styles.switchDescLight]}>{boolText(form.is_active, 'Si', 'No')}</Text>
                </Pressable>

                <Pressable
                  style={[styles.switchCard, isLightTheme && styles.switchCardLight, form.track_inventory && styles.switchCardActive]}
                  onPress={() => setForm((prev) => ({ ...prev, track_inventory: !prev.track_inventory }))}
                >
                  <Text style={[styles.switchTitle, isLightTheme && styles.switchTitleLight]}>Controla inventario</Text>
                  <Text style={[styles.switchDesc, isLightTheme && styles.switchDescLight]}>{boolText(form.track_inventory, 'Si', 'No')}</Text>
                </Pressable>

                <Pressable
                  style={[styles.switchCard, isLightTheme && styles.switchCardLight, form.requires_expiration && styles.switchCardActive]}
                  onPress={() =>
                    setForm((prev) => ({ ...prev, requires_expiration: !prev.requires_expiration }))
                  }
                >
                  <Text style={[styles.switchTitle, isLightTheme && styles.switchTitleLight]}>Maneja vencimiento</Text>
                  <Text style={[styles.switchDesc, isLightTheme && styles.switchDescLight]}>{boolText(form.requires_expiration, 'Si', 'No')}</Text>
                </Pressable>
              </View>

              <Pressable style={styles.primaryBtn} onPress={save} disabled={saving}>
                <View style={styles.btnContentRow}>
                  <Ionicons name={saving ? 'hourglass-outline' : 'save-outline'} size={16} color="#fffbeb" />
                  <Text style={styles.primaryBtnText}>{saving ? 'Guardando...' : 'Guardar'}</Text>
                </View>
              </Pressable>
            </ScrollView>

            <Pressable onPress={() => setModalOpen(false)} style={styles.closeBtn}>
              <View style={styles.btnContentRow}>
                <Ionicons name="close-circle-outline" size={16} color="#fff" />
                <Text style={styles.closeBtnText}>Cerrar</Text>
              </View>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  tabBtnLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  tabBtnActive: { borderColor: '#0ea5e9', backgroundColor: '#0b2942' },
  tabText: { color: '#cbd5e1', fontWeight: '700', fontSize: 12 },
  tabTextLight: { color: '#334155' },
  tabTextActive: { color: '#bae6fd' },
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
  searchBtnText: { color: '#dbeafe', fontWeight: '700' },
  btnContentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
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
  badgeGreen: { borderColor: '#16a34a' },
  badgeRed: { borderColor: '#ef4444' },
  badgeBlue: { borderColor: '#3b82f6' },
  badgeSky: { borderColor: '#0ea5e9' },
  badgeText: { color: '#e2e8f0', fontSize: 11, fontWeight: '700' },
  variantToggleBtn: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#0f172a',
  },
  variantToggleBtnLight: { borderColor: '#cbd5e1', backgroundColor: '#f8fafc' },
  variantToggleText: { color: '#bae6fd', fontSize: 12, fontWeight: '700' },
  variantToggleTextLight: { color: '#0369a1' },
  variantsBox: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    backgroundColor: '#0f172a',
    padding: 8,
    gap: 6,
  },
  variantsBoxLight: { borderColor: '#dbe4ef', backgroundColor: '#f8fafc' },
  variantRow: {
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 8,
    padding: 8,
    backgroundColor: '#111827',
  },
  variantRowLight: { borderColor: '#dbe4ef', backgroundColor: '#ffffff' },
  variantName: { color: '#f8fafc', fontWeight: '700', fontSize: 13, marginBottom: 2 },
  variantNameLight: { color: '#0f172a' },
  variantMeta: { color: '#94a3b8', fontSize: 12, marginTop: 1 },
  variantMetaLight: { color: '#475569' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  secondaryBtn: {
    flex: 1,
    backgroundColor: '#1e40af',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#dbeafe', fontWeight: '700' },
  dangerBtn: {
    flex: 1,
    backgroundColor: '#7f1d1d',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  dangerBtnText: { color: '#fee2e2', fontWeight: '700' },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 72,
    backgroundColor: '#f59e0b',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  fabText: { color: '#451a03', fontWeight: '800' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalBody: {
    maxHeight: '90%',
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    padding: 14,
  },
  modalBodyLight: { backgroundColor: '#f8fafc' },
  modalTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  modalTitleLight: { color: '#0f172a' },
  groupTitle: {
    color: '#93c5fd',
    marginTop: 12,
    marginBottom: 6,
    fontWeight: '700',
    fontSize: 13,
    textTransform: 'uppercase',
  },
  groupTitleLight: { color: '#1d4ed8' },
  input: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 10,
    color: '#f8fafc',
    marginTop: 8,
    backgroundColor: '#111827',
  },
  inputLight: { borderColor: '#cbd5e1', color: '#0f172a', backgroundColor: '#ffffff' },
  toggleRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  toggleBtn: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: '#111827',
  },
  toggleBtnLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  toggleBtnActive: { borderColor: '#2563eb', backgroundColor: '#172554' },
  toggleBtnText: { color: '#cbd5e1', fontSize: 12, fontWeight: '700' },
  toggleBtnTextLight: { color: '#334155' },
  toggleBtnTextActive: { color: '#bfdbfe' },
  switchRowWrap: { gap: 8, marginTop: 8 },
  switchCard: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#111827',
  },
  switchCardLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  switchCardActive: { borderColor: '#0ea5e9', backgroundColor: '#0f1f35' },
  switchTitle: { color: '#e2e8f0', fontSize: 13, fontWeight: '700' },
  switchTitleLight: { color: '#0f172a' },
  switchDesc: { color: '#93c5fd', fontSize: 12, marginTop: 4 },
  switchDescLight: { color: '#1d4ed8' },
  primaryBtn: {
    marginTop: 14,
    backgroundColor: '#d97706',
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fffbeb', fontWeight: '700' },
  closeBtn: {
    marginTop: 12,
    alignSelf: 'flex-end',
    backgroundColor: '#1d4ed8',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  closeBtnText: { color: '#fff', fontWeight: '700' },
});
