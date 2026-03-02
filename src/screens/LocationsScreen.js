import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import PaginatedList from '../components/PaginatedList';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { useThemeMode } from '../lib/themeMode';
import {
  createLocationConfig,
  listLocationsConfig,
  removeLocationConfig,
  updateLocationConfig,
} from '../services/setup.service';

const LOCATION_TYPES = ['STORE', 'WAREHOUSE', 'OFFICE', 'OTHER'];

const EMPTY_FORM = {
  name: '',
  type: 'STORE',
  address: '',
  is_active: true,
};

export default function LocationsScreen({ tenant, offlineMode, pageSize = 20 }) {
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

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
    cacheNamespace: 'setup-locations',
    initialFilters: { search: '' },
    fetchPage: async ({ page: nextPage, pageSize: nextPageSize, filters: nextFilters, tenantId }) => {
      const offset = (nextPage - 1) * nextPageSize;
      return listLocationsConfig({
        tenantId,
        search: nextFilters?.search || '',
        limit: nextPageSize,
        offset,
      });
    },
  });

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (item) => {
    setEditing(item);
    setForm({
      name: item.name || '',
      type: item.type || 'STORE',
      address: item.address || '',
      is_active: item.is_active !== false,
    });
    setModalOpen(true);
  };

  const onSave = async () => {
    if (offlineMode) {
      setError('No puedes editar sedes en modo offline.');
      return;
    }
    if (!form.name.trim()) {
      setError('Nombre es obligatorio');
      return;
    }

    setSaving(true);
    const payload = {
      tenant_id: tenant?.tenant_id,
      name: form.name.trim(),
      type: form.type,
      address: form.address.trim(),
      is_active: form.is_active,
    };

    const result = editing
      ? await updateLocationConfig(editing.location_id, tenant?.tenant_id, payload)
      : await createLocationConfig(payload);

    if (!result.success) {
      setError(result.error || 'No fue posible guardar sede');
      setSaving(false);
      return;
    }

    setModalOpen(false);
    setSaving(false);
    await loadPage(page, filters);
  };

  const onDelete = async (item) => {
    if (offlineMode) {
      setError('No puedes eliminar sedes en modo offline.');
      return;
    }
    const result = await removeLocationConfig(item.location_id, tenant?.tenant_id);
    if (!result.success) {
      setError(result.error || 'No fue posible eliminar sede');
      return;
    }
    await loadPage(page, filters);
  };

  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <TextInput
        style={[styles.searchInput, isLightTheme && styles.searchInputLight]}
        value={filters?.search || ''}
        onChangeText={(v) => updateFilters({ search: v })}
        placeholder="Buscar por nombre, direccion o tipo"
        placeholderTextColor="#64748b"
      />

      <PaginatedList
        themeMode={themeMode}
        title="Sedes"
        loading={loading}
        error={error}
        items={items}
        emptyText="No hay sedes configuradas."
        page={page}
        totalPages={totalPages}
        onPrev={() => changePage(page - 1)}
        onNext={() => changePage(page + 1)}
        footerMeta={
          cacheInfo?.source === 'cache' && cacheInfo?.cachedAt
            ? `Offline cache: ${new Date(cacheInfo.cachedAt).toLocaleString()}`
            : null
        }
        headerRight={
          <Pressable style={[styles.addBtn, isLightTheme && styles.addBtnLight]} onPress={openNew}>
            <Text style={[styles.addBtnText, isLightTheme && styles.addBtnTextLight]}>+ Nueva</Text>
          </Pressable>
        }
        renderItem={(item) => (
          <View key={item.location_id} style={[styles.card, isLightTheme && styles.cardLight]}>
            <Text style={[styles.title, isLightTheme && styles.titleLight]}>{item.name}</Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>{item.type || 'STORE'}</Text>
            {item.address ? <Text style={[styles.meta, isLightTheme && styles.metaLight]}>{item.address}</Text> : null}
            <View style={styles.actions}>
              <Pressable style={[styles.secondaryBtn, isLightTheme && styles.secondaryBtnLight]} onPress={() => openEdit(item)}>
                <Text style={[styles.secondaryBtnText, isLightTheme && styles.secondaryBtnTextLight]}>Editar</Text>
              </Pressable>
              <Pressable style={[styles.dangerBtn, isLightTheme && styles.dangerBtnLight]} onPress={() => onDelete(item)}>
                <Text style={[styles.dangerBtnText, isLightTheme && styles.dangerBtnTextLight]}>Eliminar</Text>
              </Pressable>
            </View>
          </View>
        )}
      />

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBody, isLightTheme && styles.modalBodyLight]}>
            <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>{editing ? 'Editar sede' : 'Nueva sede'}</Text>
            <TextInput
              style={[styles.input, isLightTheme && styles.inputLight]}
              value={form.name}
              onChangeText={(v) => setForm((prev) => ({ ...prev, name: v }))}
              placeholder="Nombre"
              placeholderTextColor="#64748b"
            />
            <TextInput
              style={[styles.input, isLightTheme && styles.inputLight]}
              value={form.address}
              onChangeText={(v) => setForm((prev) => ({ ...prev, address: v }))}
              placeholder="Direccion"
              placeholderTextColor="#64748b"
            />
            <View style={styles.chipsRow}>
              {LOCATION_TYPES.map((type) => {
                const active = form.type === type;
                return (
                  <Pressable
                    key={type}
                    style={[
                      styles.filterChip,
                      isLightTheme && styles.filterChipLight,
                      active && styles.filterChipActive,
                      active && isLightTheme && styles.filterChipActiveLight,
                    ]}
                    onPress={() => setForm((prev) => ({ ...prev, type }))}
                  >
                    <Text style={[styles.filterChipText, isLightTheme && styles.filterChipTextLight, active && styles.filterChipTextActive, active && isLightTheme && styles.filterChipTextActiveLight]}>{type}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.actions}>
              <Pressable
                style={[
                  styles.secondaryBtn,
                  isLightTheme && styles.secondaryBtnLight,
                  form.is_active && styles.optionActive,
                  form.is_active && isLightTheme && styles.optionActiveLight,
                ]}
                onPress={() => setForm((prev) => ({ ...prev, is_active: !prev.is_active }))}
              >
                <Text style={[styles.secondaryBtnText, isLightTheme && styles.secondaryBtnTextLight]}>{form.is_active ? 'Activa' : 'Inactiva'}</Text>
              </Pressable>
            </View>

            <Pressable style={[styles.primaryBtn, isLightTheme && styles.primaryBtnLight]} onPress={onSave} disabled={saving}>
              <Text style={[styles.primaryBtnText, isLightTheme && styles.primaryBtnTextLight]}>{saving ? 'Guardando...' : 'Guardar'}</Text>
            </Pressable>
            <Pressable style={[styles.closeBtn, isLightTheme && styles.closeBtnLight]} onPress={() => setModalOpen(false)}>
              <Text style={[styles.closeBtnText, isLightTheme && styles.closeBtnTextLight]}>Cancelar</Text>
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
  searchInput: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 10,
    color: '#f8fafc',
    marginBottom: 8,
    backgroundColor: '#111827',
  },
  searchInputLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff', color: '#0f172a' },
  addBtn: { backgroundColor: '#f59e0b', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  addBtnText: { color: '#451a03', fontWeight: '700', fontSize: 12 },
  addBtnLight: { backgroundColor: '#1d4ed8' },
  addBtnTextLight: { color: '#eff6ff' },
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
  meta: { color: '#94a3b8', marginTop: 2, fontSize: 12 },
  metaLight: { color: '#475569' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  secondaryBtn: { backgroundColor: '#1e40af', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center' },
  secondaryBtnText: { color: '#dbeafe', fontWeight: '700', fontSize: 12 },
  secondaryBtnLight: { backgroundColor: '#1d4ed8' },
  secondaryBtnTextLight: { color: '#eff6ff' },
  dangerBtn: { backgroundColor: '#7f1d1d', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center' },
  dangerBtnText: { color: '#fee2e2', fontWeight: '700', fontSize: 12 },
  dangerBtnLight: { backgroundColor: '#dc2626' },
  dangerBtnTextLight: { color: '#fff1f2' },
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
  primaryBtn: { marginTop: 14, backgroundColor: '#d97706', borderRadius: 8, paddingVertical: 11, alignItems: 'center' },
  primaryBtnText: { color: '#fffbeb', fontWeight: '700' },
  primaryBtnLight: { backgroundColor: '#1d4ed8' },
  primaryBtnTextLight: { color: '#eff6ff' },
  closeBtn: {
    marginTop: 10,
    alignSelf: 'flex-end',
    backgroundColor: '#1d4ed8',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  closeBtnText: { color: '#fff', fontWeight: '700' },
  closeBtnLight: { backgroundColor: '#e2e8f0' },
  closeBtnTextLight: { color: '#1e293b' },
  chipsRow: { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
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
  optionActive: { borderColor: '#0ea5e9', backgroundColor: '#0b2942' },
  optionActiveLight: { borderColor: '#0284c7', backgroundColor: '#e0f2fe' },
});
