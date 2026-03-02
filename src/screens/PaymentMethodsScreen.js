import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import PaginatedList from '../components/PaginatedList';
import { usePaginatedList } from '../hooks/usePaginatedList';
import {
  createPaymentMethod,
  listPaymentMethods,
  removePaymentMethod,
  updatePaymentMethod,
} from '../services/cashMenu.service';

const EMPTY_FORM = {
  payment_method_id: null,
  code: '',
  name: '',
  sort_order: '0',
  is_active: true,
};

export default function PaymentMethodsScreen({ tenant, offlineMode, pageSize = 20 }) {
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
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
    cacheNamespace: 'payment-methods',
    initialFilters: { search: '' },
    fetchPage: async ({ page: nextPage, pageSize: nextPageSize, filters: nextFilters, tenantId }) => {
      const offset = (nextPage - 1) * nextPageSize;
      return listPaymentMethods({
        tenantId,
        search: nextFilters?.search || '',
        limit: nextPageSize,
        offset,
      });
    },
  });

  const openCreate = () => {
    setForm({ ...EMPTY_FORM });
    setModalOpen(true);
  };

  const openEdit = (item) => {
    setForm({
      payment_method_id: item.payment_method_id,
      code: item.code || '',
      name: item.name || '',
      sort_order: String(item.sort_order ?? 0),
      is_active: item.is_active !== false,
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (offlineMode) {
      setError('Metodos de pago no permite escritura en modo offline.');
      return;
    }

    const code = String(form.code || '').trim().toUpperCase();
    const name = String(form.name || '').trim();
    if (!code || !name) {
      setError('Codigo y nombre son obligatorios.');
      return;
    }

    setSaving(true);
    setError('');

    const payload = {
      tenant_id: tenant?.tenant_id,
      code,
      name,
      sort_order: Number(form.sort_order || 0),
      is_active: form.is_active !== false,
    };

    const result = form.payment_method_id
      ? await updatePaymentMethod(form.payment_method_id, tenant?.tenant_id, payload)
      : await createPaymentMethod(payload);

    if (!result.success) {
      setError(result.error || 'No fue posible guardar metodo de pago');
      setSaving(false);
      return;
    }

    setModalOpen(false);
    setForm({ ...EMPTY_FORM });
    await loadPage(page, filters);
    setSaving(false);
  };

  const remove = (item) => {
    Alert.alert('Eliminar metodo', `Se eliminara ${item.name}.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          if (offlineMode) {
            setError('No puedes eliminar metodos en modo offline.');
            return;
          }
          const result = await removePaymentMethod(item.payment_method_id, tenant?.tenant_id);
          if (!result.success) {
            setError(result.error || 'No fue posible eliminar metodo');
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
          placeholder="Buscar por codigo o nombre"
          placeholderTextColor="#64748b"
        />
        <Pressable style={styles.searchBtn} onPress={() => updateFilters({ search })}>
          <Text style={styles.searchBtnText}>Buscar</Text>
        </Pressable>
      </View>

      <PaginatedList
        title="Metodos de Pago"
        loading={loading}
        error={error}
        items={items}
        emptyText="No hay metodos de pago."
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
          <View key={item.payment_method_id} style={styles.card}>
            <Text style={styles.title}>{item.name}</Text>
            <Text style={styles.meta}>Codigo: {item.code}</Text>
            <View style={styles.badgesRow}>
              <View style={[styles.badge, { borderColor: item.is_active ? '#16a34a' : '#ef4444' }]}>
                <Text style={styles.badgeText}>{item.is_active ? 'Activo' : 'Inactivo'}</Text>
              </View>
              <View style={[styles.badge, { borderColor: '#3b82f6' }]}>
                <Text style={styles.badgeText}>Orden {item.sort_order ?? 0}</Text>
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
        <Text style={styles.fabText}>+ Nuevo</Text>
      </Pressable>

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBody}>
            <ScrollView>
              <Text style={styles.modalTitle}>{form.payment_method_id ? 'Editar metodo' : 'Nuevo metodo'}</Text>
              <TextInput
                style={styles.input}
                value={form.code}
                onChangeText={(v) => setForm((prev) => ({ ...prev, code: v.toUpperCase() }))}
                placeholder="Codigo *"
                placeholderTextColor="#64748b"
              />
              <TextInput
                style={styles.input}
                value={form.name}
                onChangeText={(v) => setForm((prev) => ({ ...prev, name: v }))}
                placeholder="Nombre *"
                placeholderTextColor="#64748b"
              />
              <TextInput
                style={styles.input}
                value={form.sort_order}
                onChangeText={(v) => setForm((prev) => ({ ...prev, sort_order: v }))}
                placeholder="Orden"
                placeholderTextColor="#64748b"
                keyboardType="numeric"
              />

              <Pressable
                style={[styles.option, form.is_active && styles.optionActive]}
                onPress={() => setForm((prev) => ({ ...prev, is_active: !prev.is_active }))}
              >
                <Text style={[styles.optionText, form.is_active && styles.optionTextActive]}>
                  Estado: {form.is_active ? 'Activo' : 'Inactivo'}
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
