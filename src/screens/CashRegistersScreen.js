import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import PaginatedList from '../components/PaginatedList';
import { usePaginatedList } from '../hooks/usePaginatedList';
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
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
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
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={() => updateFilters({ search })}
          placeholder="Buscar caja"
          placeholderTextColor="#64748b"
        />
        <Pressable style={styles.searchBtn} onPress={() => updateFilters({ search })}>
          <Text style={styles.searchBtnText}>Buscar</Text>
        </Pressable>
      </View>

      <PaginatedList
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
          <View key={item.cash_register_id} style={styles.card}>
            <Text style={styles.title}>{item.name}</Text>
            <Text style={styles.meta}>Sede: {item.location?.name || 'Sin sede'}</Text>
            <View style={styles.badgesRow}>
              <View style={[styles.badge, { borderColor: item.is_active ? '#16a34a' : '#ef4444' }]}>
                <Text style={styles.badgeText}>{item.is_active ? 'Activa' : 'Inactiva'}</Text>
              </View>
            </View>
            <View style={styles.actions}>
              <Pressable style={styles.secondaryBtn} onPress={() => openEdit(item)}>
                <Text style={styles.secondaryBtnText}>Editar</Text>
              </Pressable>
              <Pressable style={styles.dangerBtn} onPress={() => remove(item)}>
                <Text style={styles.dangerBtnText}>Eliminar</Text>
              </Pressable>
            </View>
          </View>
        )}
      />

      <Pressable style={styles.fab} onPress={openCreate}>
        <Text style={styles.fabText}>+ Nueva</Text>
      </Pressable>

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBody}>
            <ScrollView>
              <Text style={styles.modalTitle}>{form.cash_register_id ? 'Editar caja' : 'Nueva caja'}</Text>
              <TextInput
                style={styles.input}
                value={form.name}
                onChangeText={(v) => setForm((prev) => ({ ...prev, name: v }))}
                placeholder="Nombre *"
                placeholderTextColor="#64748b"
              />
              <Text style={styles.groupTitle}>Sede</Text>
              {(locations || []).map((loc) => {
                const active = form.location_id === loc.location_id;
                return (
                  <Pressable
                    key={loc.location_id}
                    style={[styles.option, active && styles.optionActive]}
                    onPress={() => setForm((prev) => ({ ...prev, location_id: loc.location_id }))}
                  >
                    <Text style={[styles.optionText, active && styles.optionTextActive]}>{loc.name}</Text>
                  </Pressable>
                );
              })}

              <Pressable
                style={[styles.option, form.is_active && styles.optionActive]}
                onPress={() => setForm((prev) => ({ ...prev, is_active: !prev.is_active }))}
              >
                <Text style={[styles.optionText, form.is_active && styles.optionTextActive]}>
                  Estado: {form.is_active ? 'Activa' : 'Inactiva'}
                </Text>
              </Pressable>

              <Pressable style={styles.primaryBtn} onPress={save} disabled={saving}>
                <Text style={styles.primaryBtnText}>{saving ? 'Guardando...' : 'Guardar'}</Text>
              </Pressable>
            </ScrollView>
            <Pressable onPress={() => setModalOpen(false)} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  secondaryBtn: { flex: 1, backgroundColor: '#1e40af', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  secondaryBtnText: { color: '#dbeafe', fontWeight: '700' },
  dangerBtn: { flex: 1, backgroundColor: '#7f1d1d', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
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
    maxHeight: '88%',
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    padding: 14,
  },
  modalTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  groupTitle: { color: '#93c5fd', marginTop: 10, marginBottom: 4, fontWeight: '700', fontSize: 13, textTransform: 'uppercase' },
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
  optionText: { color: '#cbd5e1', fontWeight: '600' },
  optionTextActive: { color: '#bae6fd' },
  primaryBtn: { marginTop: 14, backgroundColor: '#d97706', borderRadius: 8, paddingVertical: 11, alignItems: 'center' },
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
