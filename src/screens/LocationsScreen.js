import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import PaginatedList from '../components/PaginatedList';
import { usePaginatedList } from '../hooks/usePaginatedList';
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
    <View style={styles.container}>
      <TextInput
        style={styles.searchInput}
        value={filters?.search || ''}
        onChangeText={(v) => updateFilters({ search: v })}
        placeholder="Buscar por nombre, direccion o tipo"
        placeholderTextColor="#64748b"
      />

      <PaginatedList
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
          <Pressable style={styles.addBtn} onPress={openNew}>
            <Text style={styles.addBtnText}>+ Nueva</Text>
          </Pressable>
        }
        renderItem={(item) => (
          <View key={item.location_id} style={styles.card}>
            <Text style={styles.title}>{item.name}</Text>
            <Text style={styles.meta}>{item.type || 'STORE'}</Text>
            {item.address ? <Text style={styles.meta}>{item.address}</Text> : null}
            <View style={styles.actions}>
              <Pressable style={styles.secondaryBtn} onPress={() => openEdit(item)}>
                <Text style={styles.secondaryBtnText}>Editar</Text>
              </Pressable>
              <Pressable style={styles.dangerBtn} onPress={() => onDelete(item)}>
                <Text style={styles.dangerBtnText}>Eliminar</Text>
              </Pressable>
            </View>
          </View>
        )}
      />

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBody}>
            <Text style={styles.modalTitle}>{editing ? 'Editar sede' : 'Nueva sede'}</Text>
            <TextInput
              style={styles.input}
              value={form.name}
              onChangeText={(v) => setForm((prev) => ({ ...prev, name: v }))}
              placeholder="Nombre"
              placeholderTextColor="#64748b"
            />
            <TextInput
              style={styles.input}
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
                    style={[styles.filterChip, active && styles.filterChipActive]}
                    onPress={() => setForm((prev) => ({ ...prev, type }))}
                  >
                    <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{type}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.actions}>
              <Pressable
                style={[styles.secondaryBtn, form.is_active && styles.optionActive]}
                onPress={() => setForm((prev) => ({ ...prev, is_active: !prev.is_active }))}
              >
                <Text style={styles.secondaryBtnText}>{form.is_active ? 'Activa' : 'Inactiva'}</Text>
              </Pressable>
            </View>

            <Pressable style={styles.primaryBtn} onPress={onSave} disabled={saving}>
              <Text style={styles.primaryBtnText}>{saving ? 'Guardando...' : 'Guardar'}</Text>
            </Pressable>
            <Pressable style={styles.closeBtn} onPress={() => setModalOpen(false)}>
              <Text style={styles.closeBtnText}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0f14', padding: 12 },
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
  addBtn: { backgroundColor: '#f59e0b', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  addBtnText: { color: '#451a03', fontWeight: '700', fontSize: 12 },
  card: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  title: { color: '#f8fafc', fontWeight: '700', fontSize: 15 },
  meta: { color: '#94a3b8', marginTop: 2, fontSize: 12 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  secondaryBtn: { backgroundColor: '#1e40af', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center' },
  secondaryBtnText: { color: '#dbeafe', fontWeight: '700', fontSize: 12 },
  dangerBtn: { backgroundColor: '#7f1d1d', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center' },
  dangerBtnText: { color: '#fee2e2', fontWeight: '700', fontSize: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalBody: {
    maxHeight: '88%',
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    padding: 14,
  },
  modalTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '700', marginBottom: 8 },
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
  primaryBtn: { marginTop: 14, backgroundColor: '#d97706', borderRadius: 8, paddingVertical: 11, alignItems: 'center' },
  primaryBtnText: { color: '#fffbeb', fontWeight: '700' },
  closeBtn: {
    marginTop: 10,
    alignSelf: 'flex-end',
    backgroundColor: '#1d4ed8',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  closeBtnText: { color: '#fff', fontWeight: '700' },
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
  filterChipText: { color: '#cbd5e1', fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: '#bae6fd' },
  optionActive: { borderColor: '#0ea5e9', backgroundColor: '#0b2942' },
});
