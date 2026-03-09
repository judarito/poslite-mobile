import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import PaginatedList from '../components/PaginatedList';
import SearchableSelectField from '../components/SearchableSelectField';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { useThemeMode } from '../lib/themeMode';
import {
  createPricingRule,
  listCategoriesForPricingRules,
  listLocationsForPricingRules,
  listPricingRules,
  listProductsForPricingRules,
  listVariantsForPricingRules,
  removePricingRule,
  updatePricingRule,
} from '../services/pricingRules.service';

const SCOPE_OPTIONS = [
  { key: 'TENANT', label: 'Tenant (global)' },
  { key: 'LOCATION', label: 'Sede' },
  { key: 'CATEGORY', label: 'Categoria' },
  { key: 'PRODUCT', label: 'Producto' },
  { key: 'VARIANT', label: 'Variante' },
];

const STATUS_OPTIONS = [
  { key: 'ALL', label: 'Todos' },
  { key: 'true', label: 'Activos' },
  { key: 'false', label: 'Inactivos' },
];

const METHOD_OPTIONS = [
  { key: 'MARKUP', label: 'Markup %' },
  { key: 'FIXED', label: 'Precio fijo' },
];

const ROUNDING_OPTIONS = [
  { key: 'NONE', label: 'Sin redondeo' },
  { key: 'UP', label: 'Hacia arriba' },
  { key: 'DOWN', label: 'Hacia abajo' },
  { key: 'NEAREST', label: 'Mas cercano' },
];

const EMPTY_FORM = {
  pricing_rule_id: null,
  scope: 'TENANT',
  location_id: null,
  category_id: null,
  product_id: null,
  variant_id: null,
  pricing_method: 'MARKUP',
  markup_percentage: '20',
  price_rounding: 'NONE',
  rounding_to: '1',
  priority: '0',
  is_active: true,
};

function normalizeStatusFilter(status) {
  if (status === 'true') return true;
  if (status === 'false') return false;
  return null;
}

function formatRuleTarget(rule) {
  if (rule.scope === 'LOCATION') return `Sede: ${rule.location?.name || 'Sin sede'}`;
  if (rule.scope === 'CATEGORY') return `Categoria: ${rule.category?.name || 'Sin categoria'}`;
  if (rule.scope === 'PRODUCT') return `Producto: ${rule.product?.name || 'Sin producto'}`;
  if (rule.scope === 'VARIANT') {
    const sku = rule.variant?.sku || 'SIN-SKU';
    const name = rule.variant?.variant_name || 'Sin nombre';
    return `Variante: ${sku} - ${name}`;
  }
  return 'Aplica a todo el tenant';
}

export default function PricingRulesScreen({ tenant, offlineMode, pageSize = 20 }) {
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const [locations, setLocations] = useState([]);
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [variants, setVariants] = useState([]);

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
    loadPage,
  } = usePaginatedList({
    tenantId: tenant?.tenant_id,
    pageSize,
    offlineMode,
    cacheNamespace: 'setup-pricing-rules',
    initialFilters: { scope: '', location_id: '', status: 'ALL' },
    fetchPage: async ({ tenantId, page: nextPage, pageSize: nextPageSize, filters: nextFilters }) => {
      const offset = (nextPage - 1) * nextPageSize;
      return listPricingRules({
        tenantId,
        scope: nextFilters?.scope || '',
        locationId: nextFilters?.location_id || null,
        isActive: normalizeStatusFilter(nextFilters?.status),
        limit: nextPageSize,
        offset,
      });
    },
  });

  useEffect(() => {
    let active = true;

    const loadLookups = async () => {
      if (!tenant?.tenant_id) return;

      const [locationsResult, categoriesResult, productsResult, variantsResult] = await Promise.all([
        listLocationsForPricingRules(tenant.tenant_id),
        listCategoriesForPricingRules(tenant.tenant_id),
        listProductsForPricingRules(tenant.tenant_id),
        listVariantsForPricingRules(tenant.tenant_id),
      ]);

      if (!active) return;
      if (locationsResult.success) setLocations(locationsResult.data || []);
      if (categoriesResult.success) setCategories(categoriesResult.data || []);
      if (productsResult.success) setProducts(productsResult.data || []);
      if (variantsResult.success) setVariants(variantsResult.data || []);
    };

    loadLookups();

    return () => {
      active = false;
    };
  }, [tenant?.tenant_id]);

  const locationOptions = useMemo(
    () =>
      (locations || []).map((item) => ({
        key: item.location_id,
        label: item.name,
        searchText: item.name,
      })),
    [locations],
  );

  const categoryOptions = useMemo(
    () =>
      (categories || []).map((item) => ({
        key: item.category_id,
        label: item.name,
        searchText: item.name,
      })),
    [categories],
  );

  const productOptions = useMemo(
    () =>
      (products || []).map((item) => ({
        key: item.product_id,
        label: item.name,
        searchText: `${item.name} ${item.category?.name || ''}`,
      })),
    [products],
  );

  const variantOptions = useMemo(
    () =>
      (variants || []).map((item) => ({
        key: item.variant_id,
        label: `${item.sku || 'SIN-SKU'} - ${item.variant_name || 'Sin nombre'}`,
        searchText: `${item.sku || ''} ${item.variant_name || ''} ${item.product?.name || ''}`,
      })),
    [variants],
  );

  const openCreate = () => {
    setForm({ ...EMPTY_FORM });
    setModalOpen(true);
  };

  const openEdit = (item) => {
    setForm({
      pricing_rule_id: item.pricing_rule_id,
      scope: item.scope || 'TENANT',
      location_id: item.location_id || null,
      category_id: item.category_id || null,
      product_id: item.product_id || null,
      variant_id: item.variant_id || null,
      pricing_method: item.pricing_method || 'MARKUP',
      markup_percentage: String(item.markup_percentage ?? 0),
      price_rounding: item.price_rounding || 'NONE',
      rounding_to: String(item.rounding_to ?? 1),
      priority: String(item.priority ?? 0),
      is_active: item.is_active !== false,
    });
    setModalOpen(true);
  };

  const validateForm = () => {
    if (form.scope === 'LOCATION' && !form.location_id) {
      setError('Debes seleccionar una sede.');
      return false;
    }

    if (form.scope === 'CATEGORY' && !form.category_id) {
      setError('Debes seleccionar una categoria.');
      return false;
    }

    if (form.scope === 'PRODUCT' && !form.product_id) {
      setError('Debes seleccionar un producto.');
      return false;
    }

    if (form.scope === 'VARIANT' && !form.variant_id) {
      setError('Debes seleccionar una variante.');
      return false;
    }

    return true;
  };

  const save = async () => {
    if (offlineMode) {
      setError('Reglas de precio no permite escritura en modo offline.');
      return;
    }

    if (!validateForm()) return;

    const markup = Number(form.markup_percentage || 0);
    const roundingTo = Number(form.rounding_to || 1);
    const priority = Number(form.priority || 0);

    if (!Number.isFinite(markup) || !Number.isFinite(roundingTo) || !Number.isFinite(priority)) {
      setError('Markup, redondeo y prioridad deben ser numericos.');
      return;
    }

    setSaving(true);
    setError('');

    const payload = {
      scope: form.scope,
      location_id: form.location_id,
      category_id: form.category_id,
      product_id: form.product_id,
      variant_id: form.variant_id,
      pricing_method: form.pricing_method,
      markup_percentage: markup,
      price_rounding: form.price_rounding,
      rounding_to: roundingTo,
      priority,
      is_active: form.is_active,
    };

    const result = form.pricing_rule_id
      ? await updatePricingRule(tenant?.tenant_id, form.pricing_rule_id, payload)
      : await createPricingRule(tenant?.tenant_id, payload);

    if (!result.success) {
      setSaving(false);
      setError(result.error || 'No fue posible guardar la politica de precio.');
      return;
    }

    setSaving(false);
    setModalOpen(false);
    setForm({ ...EMPTY_FORM });
    await loadPage(page, filters);
  };

  const remove = (item) => {
    Alert.alert('Eliminar regla de precio', 'Esta accion no se puede deshacer.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          if (offlineMode) {
            setError('No puedes eliminar reglas en modo offline.');
            return;
          }

          const result = await removePricingRule(tenant?.tenant_id, item.pricing_rule_id);
          if (!result.success) {
            setError(result.error || 'No fue posible eliminar la regla.');
            return;
          }

          await loadPage(page, filters);
        },
      },
    ]);
  };

  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={styles.filtersRow}>
        <View style={styles.filterCell}>
          <SearchableSelectField
            title="Alcance"
            options={SCOPE_OPTIONS}
            selectedKey={filters?.scope || null}
            onSelect={(value) => updateFilters({ scope: value || '' })}
            placeholder="Todos"
            clearLabel="Todos"
            themeMode={themeMode}
          />
        </View>
        <View style={styles.filterCell}>
          <SearchableSelectField
            title="Estado"
            options={STATUS_OPTIONS}
            selectedKey={filters?.status || 'ALL'}
            onSelect={(value) => updateFilters({ status: value || 'ALL' })}
            placeholder="Todos"
            clearLabel="Todos"
            themeMode={themeMode}
          />
        </View>
      </View>

      <SearchableSelectField
        title="Sede"
        options={locationOptions}
        selectedKey={filters?.location_id || null}
        onSelect={(value) => updateFilters({ location_id: value || '' })}
        placeholder="Todas"
        clearLabel="Todas"
        themeMode={themeMode}
      />

      <PaginatedList
        themeMode={themeMode}
        title="Reglas de Precio"
        loading={loading}
        error={error}
        items={items}
        emptyText="No hay reglas de precio configuradas."
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
          <View key={item.pricing_rule_id} style={[styles.card, isLightTheme && styles.cardLight]}>
            <Text style={[styles.title, isLightTheme && styles.titleLight]}>
              {item.scope} - {item.pricing_method}
            </Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>{formatRuleTarget(item)}</Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>
              {item.pricing_method === 'FIXED' ? 'Precio fijo' : 'Markup'}: {Number(item.markup_percentage || 0)}
            </Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>
              Redondeo: {item.price_rounding || 'NONE'} a {Number(item.rounding_to || 1)}
            </Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>
              Prioridad: {Number(item.priority || 0)} - {item.is_active ? 'Activa' : 'Inactiva'}
            </Text>
            <View style={styles.actions}>
              <Pressable style={[styles.secondaryBtn, isLightTheme && styles.secondaryBtnLight]} onPress={() => openEdit(item)}>
                <Text style={[styles.secondaryBtnText, isLightTheme && styles.secondaryBtnTextLight]}>Editar</Text>
              </Pressable>
              <Pressable style={[styles.dangerBtn, isLightTheme && styles.dangerBtnLight]} onPress={() => remove(item)}>
                <Text style={[styles.dangerBtnText, isLightTheme && styles.dangerBtnTextLight]}>Eliminar</Text>
              </Pressable>
            </View>
          </View>
        )}
      />

      <Pressable style={[styles.fab, isLightTheme && styles.fabLight]} onPress={openCreate}>
        <Text style={[styles.fabText, isLightTheme && styles.fabTextLight]}>+ Nueva</Text>
      </Pressable>

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBody, isLightTheme && styles.modalBodyLight]}>
            <ScrollView>
              <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>
                {form.pricing_rule_id ? 'Editar regla de precio' : 'Nueva regla de precio'}
              </Text>

              <SearchableSelectField
                title="Alcance"
                options={SCOPE_OPTIONS}
                selectedKey={form.scope}
                onSelect={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    scope: value || 'TENANT',
                    location_id: null,
                    category_id: null,
                    product_id: null,
                    variant_id: null,
                  }))
                }
                placeholder="Selecciona alcance"
                clearLabel="TENANT"
                themeMode={themeMode}
              />

              {form.scope === 'LOCATION' ? (
                <SearchableSelectField
                  title="Sede"
                  options={locationOptions}
                  selectedKey={form.location_id}
                  onSelect={(value) => setForm((prev) => ({ ...prev, location_id: value }))}
                  placeholder="Selecciona sede"
                  clearLabel="Sin seleccion"
                  themeMode={themeMode}
                />
              ) : null}

              {form.scope === 'CATEGORY' ? (
                <SearchableSelectField
                  title="Categoria"
                  options={categoryOptions}
                  selectedKey={form.category_id}
                  onSelect={(value) => setForm((prev) => ({ ...prev, category_id: value }))}
                  placeholder="Selecciona categoria"
                  clearLabel="Sin seleccion"
                  themeMode={themeMode}
                />
              ) : null}

              {form.scope === 'PRODUCT' ? (
                <SearchableSelectField
                  title="Producto"
                  options={productOptions}
                  selectedKey={form.product_id}
                  onSelect={(value) => setForm((prev) => ({ ...prev, product_id: value }))}
                  placeholder="Selecciona producto"
                  clearLabel="Sin seleccion"
                  themeMode={themeMode}
                />
              ) : null}

              {form.scope === 'VARIANT' ? (
                <SearchableSelectField
                  title="Variante"
                  options={variantOptions}
                  selectedKey={form.variant_id}
                  onSelect={(value) => setForm((prev) => ({ ...prev, variant_id: value }))}
                  placeholder="Selecciona variante"
                  clearLabel="Sin seleccion"
                  themeMode={themeMode}
                />
              ) : null}

              <SearchableSelectField
                title="Metodo"
                options={METHOD_OPTIONS}
                selectedKey={form.pricing_method}
                onSelect={(value) => setForm((prev) => ({ ...prev, pricing_method: value || 'MARKUP' }))}
                placeholder="Metodo"
                clearLabel="MARKUP"
                themeMode={themeMode}
              />

              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={form.markup_percentage}
                onChangeText={(value) => setForm((prev) => ({ ...prev, markup_percentage: value }))}
                placeholder={form.pricing_method === 'FIXED' ? 'Precio fijo' : 'Markup %'}
                keyboardType="numeric"
                placeholderTextColor="#64748b"
              />

              <SearchableSelectField
                title="Redondeo"
                options={ROUNDING_OPTIONS}
                selectedKey={form.price_rounding}
                onSelect={(value) => setForm((prev) => ({ ...prev, price_rounding: value || 'NONE' }))}
                placeholder="Tipo de redondeo"
                clearLabel="NONE"
                themeMode={themeMode}
              />

              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={form.rounding_to}
                onChangeText={(value) => setForm((prev) => ({ ...prev, rounding_to: value }))}
                placeholder="Redondear a"
                keyboardType="numeric"
                placeholderTextColor="#64748b"
              />

              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={form.priority}
                onChangeText={(value) => setForm((prev) => ({ ...prev, priority: value }))}
                placeholder="Prioridad"
                keyboardType="numeric"
                placeholderTextColor="#64748b"
              />

              <Pressable
                style={[
                  styles.option,
                  isLightTheme && styles.optionLight,
                  form.is_active && styles.optionActive,
                  form.is_active && isLightTheme && styles.optionActiveLight,
                ]}
                onPress={() => setForm((prev) => ({ ...prev, is_active: !prev.is_active }))}
              >
                <Text
                  style={[
                    styles.optionText,
                    isLightTheme && styles.optionTextLight,
                    form.is_active && styles.optionTextActive,
                    form.is_active && isLightTheme && styles.optionTextActiveLight,
                  ]}
                >
                  Estado: {form.is_active ? 'Activa' : 'Inactiva'}
                </Text>
              </Pressable>

              <Pressable style={[styles.primaryBtn, isLightTheme && styles.primaryBtnLight]} onPress={save} disabled={saving}>
                <Text style={[styles.primaryBtnText, isLightTheme && styles.primaryBtnTextLight]}>
                  {saving ? 'Guardando...' : 'Guardar'}
                </Text>
              </Pressable>
            </ScrollView>

            <Pressable onPress={() => setModalOpen(false)} style={[styles.closeBtn, isLightTheme && styles.closeBtnLight]}>
              <Text style={[styles.closeBtnText, isLightTheme && styles.closeBtnTextLight]}>Cerrar</Text>
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
  filtersRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  filterCell: { flex: 1 },
  card: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  cardLight: { backgroundColor: '#ffffff', borderColor: '#dbe4ef' },
  title: { color: '#f8fafc', fontWeight: '700', fontSize: 14 },
  titleLight: { color: '#0f172a' },
  meta: { color: '#cbd5e1', marginTop: 2, fontSize: 12 },
  metaLight: { color: '#475569' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  secondaryBtn: { flex: 1, backgroundColor: '#1e40af', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  secondaryBtnLight: { backgroundColor: '#1d4ed8' },
  secondaryBtnText: { color: '#dbeafe', fontWeight: '700' },
  secondaryBtnTextLight: { color: '#eff6ff' },
  dangerBtn: { flex: 1, backgroundColor: '#7f1d1d', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  dangerBtnLight: { backgroundColor: '#dc2626' },
  dangerBtnText: { color: '#fee2e2', fontWeight: '700' },
  dangerBtnTextLight: { color: '#fff1f2' },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 72,
    backgroundColor: '#f59e0b',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  fabLight: { backgroundColor: '#facc15' },
  fabText: { color: '#451a03', fontWeight: '800' },
  fabTextLight: { color: '#422006' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalBody: {
    maxHeight: '88%',
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    padding: 14,
  },
  modalBodyLight: { backgroundColor: '#ffffff', borderTopWidth: 1, borderColor: '#dbe4ef' },
  modalTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  modalTitleLight: { color: '#0f172a' },
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
  inputLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff', color: '#0f172a' },
  option: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: '#111827',
    marginTop: 8,
  },
  optionActive: { borderColor: '#0ea5e9', backgroundColor: '#0b2942' },
  optionLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  optionActiveLight: { borderColor: '#0284c7', backgroundColor: '#e0f2fe' },
  optionText: { color: '#cbd5e1', fontWeight: '600' },
  optionTextLight: { color: '#334155' },
  optionTextActive: { color: '#bae6fd' },
  optionTextActiveLight: { color: '#0369a1' },
  primaryBtn: { marginTop: 14, backgroundColor: '#d97706', borderRadius: 8, paddingVertical: 11, alignItems: 'center' },
  primaryBtnLight: { backgroundColor: '#1d4ed8' },
  primaryBtnText: { color: '#fffbeb', fontWeight: '700' },
  primaryBtnTextLight: { color: '#eff6ff' },
  closeBtn: {
    marginTop: 10,
    alignSelf: 'flex-end',
    backgroundColor: '#1d4ed8',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  closeBtnLight: { backgroundColor: '#e2e8f0' },
  closeBtnText: { color: '#fff', fontWeight: '700' },
  closeBtnTextLight: { color: '#1e293b' },
});
