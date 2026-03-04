import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import PaginatedList from '../components/PaginatedList';
import SearchableSelectField from '../components/SearchableSelectField';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { useThemeMode } from '../lib/themeMode';
import {
  createCashRegister,
  listCashRegisters,
  listLocations,
  removeCashRegister,
  updateCashRegister,
} from '../services/cashMenu.service';

const EMPTY_FORM = {
  cash_register_id: null,
  name: '',
  location_id: null,
  is_active: true,
};

export default function CashRegistersScreen({ tenant, offlineMode, pageSize = 20 }) {
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [locations, setLocations] = useState([]);
  const locationSelectOptions = useMemo(
    () =>
      (locations || []).map((loc) => ({
        key: loc.location_id,
        label: loc.name,
        searchText: loc.name,
      })),
    [locations],
  );

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
    cacheNamespace: 'cash-registers',
    initialFilters: { search: '' },
    fetchPage: async ({ page: nextPage, pageSize: nextPageSize, filters: nextFilters, tenantId }) => {
      const offset = (nextPage - 1) * nextPageSize;
      return listCashRegisters({
        tenantId,
        search: nextFilters?.search || '',
        limit: nextPageSize,
        offset,
      });
    },
  });

  useEffect(() => {
    const loadLookups = async () => {
      if (!tenant?.tenant_id) return;
      const res = await listLocations(tenant.tenant_id);
      if (res.success) setLocations(res.data || []);
    };
    loadLookups();
  }, [tenant?.tenant_id]);

  const openCreate = () => {
    setForm({ ...EMPTY_FORM });
    setModalOpen(true);
  };

  const openEdit = (item) => {
    setForm({
      cash_register_id: item.cash_register_id,
      name: item.name || '',
      location_id: item.location_id || null,
      is_active: item.is_active !== false,
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (offlineMode) {
      setError('Cajas registradoras no permite escritura en modo offline.');
      return;
    }

    const name = String(form.name || '').trim();
    if (!name || !form.location_id) {
      setError('Nombre y sede son obligatorios.');
      return;
    }

    setSaving(true);
    setError('');

    const payload = {
      tenant_id: tenant?.tenant_id,
      name,
      location_id: form.location_id,
      is_active: form.is_active !== false,
    };

    const result = form.cash_register_id
      ? await updateCashRegister(form.cash_register_id, tenant?.tenant_id, payload)
      : await createCashRegister(payload);

    if (!result.success) {
      setError(result.error || 'No fue posible guardar caja');
      setSaving(false);
      return;
    }

    setModalOpen(false);
    setForm({ ...EMPTY_FORM });
    await loadPage(page, filters);
    setSaving(false);
  };

  const remove = (item) => {
    Alert.alert('Eliminar caja', `Se eliminara ${item.name}.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          if (offlineMode) {
            setError('No puedes eliminar cajas en modo offline.');
            return;
          }
          const result = await removeCashRegister(item.cash_register_id, tenant?.tenant_id);
          if (!result.success) {
            setError(result.error || 'No fue posible eliminar caja');
            return;
          }
          await loadPage(page, filters);
        },
      },
    ]);
  };

  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={styles.toolbar}>
        <TextInput
          style={[styles.searchInput, isLightTheme && styles.searchInputLight]}
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={() => updateFilters({ search })}
          placeholder="Buscar caja"
          placeholderTextColor="#64748b"
        />
        <Pressable style={[styles.searchBtn, isLightTheme && styles.searchBtnLight]} onPress={() => updateFilters({ search })}>
          <Text style={[styles.searchBtnText, isLightTheme && styles.searchBtnTextLight]}>Buscar</Text>
        </Pressable>
      </View>

      <PaginatedList
        themeMode={themeMode}
        title="Cajas Registradoras"
        loading={loading}
        error={error}
        items={items}
        emptyText="No hay cajas registradoras."
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
          <View key={item.cash_register_id} style={[styles.card, isLightTheme && styles.cardLight]}>
            <Text style={[styles.title, isLightTheme && styles.titleLight]}>{item.name}</Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>Sede: {item.location?.name || 'Sin sede'}</Text>
            <View style={styles.badgesRow}>
              <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: item.is_active ? '#16a34a' : '#ef4444' }]}>
                <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>{item.is_active ? 'Activa' : 'Inactiva'}</Text>
              </View>
            </View>
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
              <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>{form.cash_register_id ? 'Editar caja' : 'Nueva caja'}</Text>
              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={form.name}
                onChangeText={(v) => setForm((prev) => ({ ...prev, name: v }))}
                placeholder="Nombre *"
                placeholderTextColor="#64748b"
              />
              <SearchableSelectField
                title="Sede"
                themeMode={themeMode}
                valueLabel="Seleccionar sede"
                clearLabel="Sin sede"
                placeholder="Seleccionar sede"
                searchPlaceholder="Buscar sede..."
                options={locationSelectOptions}
                selectedKey={form.location_id}
                onSelect={(nextValue) => setForm((prev) => ({ ...prev, location_id: nextValue }))}
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
                <Text style={[styles.optionText, isLightTheme && styles.optionTextLight, form.is_active && styles.optionTextActive, form.is_active && isLightTheme && styles.optionTextActiveLight]}>
                  Estado: {form.is_active ? 'Activa' : 'Inactiva'}
                </Text>
              </Pressable>

              <Pressable style={[styles.primaryBtn, isLightTheme && styles.primaryBtnLight]} onPress={save} disabled={saving}>
                <Text style={[styles.primaryBtnText, isLightTheme && styles.primaryBtnTextLight]}>{saving ? 'Guardando...' : 'Guardar'}</Text>
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
  searchInputLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff', color: '#0f172a' },
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
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  secondaryBtn: { flex: 1, backgroundColor: '#1e40af', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  secondaryBtnText: { color: '#dbeafe', fontWeight: '700' },
  secondaryBtnLight: { backgroundColor: '#1d4ed8' },
  secondaryBtnTextLight: { color: '#eff6ff' },
  dangerBtn: { flex: 1, backgroundColor: '#7f1d1d', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  dangerBtnText: { color: '#fee2e2', fontWeight: '700' },
  dangerBtnLight: { backgroundColor: '#dc2626' },
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
  fabText: { color: '#451a03', fontWeight: '800' },
  fabLight: { backgroundColor: '#facc15' },
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
  groupTitle: { color: '#93c5fd', marginTop: 10, marginBottom: 4, fontWeight: '700', fontSize: 13, textTransform: 'uppercase' },
  groupTitleLight: { color: '#0369a1' },
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
  primaryBtnText: { color: '#fffbeb', fontWeight: '700' },
  primaryBtnLight: { backgroundColor: '#1d4ed8' },
  primaryBtnTextLight: { color: '#eff6ff' },
  closeBtn: {
    marginTop: 12,
    alignSelf: 'flex-end',
    backgroundColor: '#1d4ed8',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  closeBtnText: { color: '#fff', fontWeight: '700' },
  closeBtnLight: { backgroundColor: '#e2e8f0' },
  closeBtnTextLight: { color: '#1e293b' },
});
