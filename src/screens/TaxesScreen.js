import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import PaginatedList from '../components/PaginatedList';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { useThemeMode } from '../lib/themeMode';
import {
  createTaxConfig,
  listTaxesConfig,
  removeTaxConfig,
  updateTaxConfig,
} from '../services/setup.service';

const EMPTY_FORM = {
  code: '',
  name: '',
  rate: '0',
  is_active: true,
};

export default function TaxesScreen({ tenant, offlineMode, pageSize = 20 }) {
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
    cacheNamespace: 'setup-taxes',
    initialFilters: { search: '' },
    fetchPage: async ({ page: nextPage, pageSize: nextPageSize, filters: nextFilters, tenantId }) => {
      const offset = (nextPage - 1) * nextPageSize;
      return listTaxesConfig({
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
      code: item.code || '',
      name: item.name || '',
      rate: String(item.rate ?? 0),
      is_active: item.is_active !== false,
    });
    setModalOpen(true);
  };

  const onSave = async () => {
    if (offlineMode) {
      setError('No puedes editar impuestos en modo offline.');
      return;
    }
    if (!form.code.trim() || !form.name.trim()) {
      setError('Codigo y nombre son obligatorios');
      return;
    }
    const rate = Number(form.rate || 0);
    if (!Number.isFinite(rate) || rate < 0) {
      setError('La tasa debe ser mayor o igual a 0');
      return;
    }

    setSaving(true);
    const payload = {
      tenant_id: tenant?.tenant_id,
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      rate,
      is_active: form.is_active,
    };

    const result = editing
      ? await updateTaxConfig(editing.tax_id, tenant?.tenant_id, payload)
      : await createTaxConfig(payload);

    if (!result.success) {
      setError(result.error || 'No fue posible guardar impuesto');
      setSaving(false);
      return;
    }

    setModalOpen(false);
    setSaving(false);
    await loadPage(page, filters);
  };

  const onDelete = async (item) => {
    if (offlineMode) {
      setError('No puedes eliminar impuestos en modo offline.');
      return;
    }
    const result = await removeTaxConfig(item.tax_id, tenant?.tenant_id);
    if (!result.success) {
      setError(result.error || 'No fue posible eliminar impuesto');
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
        placeholder="Buscar por codigo o nombre"
        placeholderTextColor="#64748b"
      />

      <PaginatedList
        themeMode={themeMode}
        title="Impuestos"
        loading={loading}
        error={error}
        items={items}
        emptyText="No hay impuestos configurados."
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
            <Text style={[styles.addBtnText, isLightTheme && styles.addBtnTextLight]}>+ Nuevo</Text>
          </Pressable>
        }
        renderItem={(item) => (
          <View key={item.tax_id} style={[styles.card, isLightTheme && styles.cardLight]}>
            <Text style={[styles.title, isLightTheme && styles.titleLight]}>{item.name}</Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>{item.code} · {Number(item.rate || 0)}%</Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>{item.is_active ? 'Activo' : 'Inactivo'}</Text>
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
            <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>{editing ? 'Editar impuesto' : 'Nuevo impuesto'}</Text>
            <TextInput
              style={[styles.input, isLightTheme && styles.inputLight]}
              value={form.code}
              onChangeText={(v) => setForm((prev) => ({ ...prev, code: v.toUpperCase() }))}
              placeholder="Codigo (ej. IVA19)"
              placeholderTextColor="#64748b"
            />
            <TextInput
              style={[styles.input, isLightTheme && styles.inputLight]}
              value={form.name}
              onChangeText={(v) => setForm((prev) => ({ ...prev, name: v }))}
              placeholder="Nombre"
              placeholderTextColor="#64748b"
            />
            <TextInput
              style={[styles.input, isLightTheme && styles.inputLight]}
              value={form.rate}
              onChangeText={(v) => setForm((prev) => ({ ...prev, rate: v }))}
              placeholder="Tasa %"
              keyboardType="numeric"
              placeholderTextColor="#64748b"
            />

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
                <Text style={[styles.secondaryBtnText, isLightTheme && styles.secondaryBtnTextLight]}>{form.is_active ? 'Activo' : 'Inactivo'}</Text>
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
  optionActive: { borderColor: '#0ea5e9', backgroundColor: '#0b2942' },
  optionActiveLight: { borderColor: '#0284c7', backgroundColor: '#e0f2fe' },
});
