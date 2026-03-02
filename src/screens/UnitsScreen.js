import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import PaginatedList from '../components/PaginatedList';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { useThemeMode } from '../lib/themeMode';
import { createUnit, listUnits, removeUnit, updateUnit } from '../services/units.service';

const EMPTY_FORM = {
  unit_id: null,
  code: '',
  dian_code: '',
  name: '',
  description: '',
  is_active: true,
};

function boolText(value, yes, no) {
  return value ? yes : no;
}

export default function UnitsScreen({ tenant, offlineMode, pageSize = 20 }) {
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

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
    cacheNamespace: 'catalog-units',
    initialFilters: { search: '' },
    fetchPage: async ({ page: nextPage, pageSize: nextPageSize, filters: nextFilters, tenantId }) => {
      const offset = (nextPage - 1) * nextPageSize;
      return listUnits({
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
    if (item.is_system) {
      setError('Unidad del sistema: no se puede editar desde mobile.');
      return;
    }

    setForm({
      unit_id: item.unit_id,
      code: item.code || '',
      dian_code: item.dian_code || '',
      name: item.name || '',
      description: item.description || '',
      is_active: item.is_active !== false,
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (offlineMode) {
      setError('Unidades no permite escritura en modo offline.');
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
      dian_code: String(form.dian_code || '').trim().toUpperCase() || null,
      name,
      description: String(form.description || '').trim() || null,
      is_active: form.is_active !== false,
    };

    const result = form.unit_id
      ? await updateUnit(form.unit_id, tenant?.tenant_id, payload)
      : await createUnit(payload);

    if (!result.success) {
      setError(result.error || 'No se pudo guardar unidad');
      setSaving(false);
      return;
    }

    setModalOpen(false);
    setForm({ ...EMPTY_FORM });
    await loadPage(page, filters);
    setSaving(false);
  };

  const remove = (item) => {
    if (item.is_system) {
      setError('Unidad del sistema: no se puede eliminar.');
      return;
    }

    Alert.alert('Eliminar unidad', `Se eliminara ${item.name} (${item.code}).`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          if (offlineMode) {
            setError('No puedes eliminar unidades en modo offline.');
            return;
          }
          const result = await removeUnit(item.unit_id, tenant?.tenant_id);
          if (!result.success) {
            setError(result.error || 'No se pudo eliminar unidad');
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
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Buscar por codigo, nombre o DIAN"
          placeholderTextColor="#64748b"
          onSubmitEditing={() => updateFilters({ search })}
        />
        <Pressable style={styles.searchBtn} onPress={() => updateFilters({ search })}>
          <Text style={styles.searchBtnText}>Buscar</Text>
        </Pressable>
      </View>

      <PaginatedList
        themeMode={themeMode}
        title="Unidades"
        loading={loading}
        error={error}
        items={rows}
        emptyText="No hay unidades registradas."
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
          <View key={item.unit_id} style={styles.card}>
            <Text style={styles.title}>{item.name}</Text>
            <Text style={styles.meta}>Codigo: {item.code || '-'}</Text>
            <Text style={styles.meta}>DIAN: {item.dian_code || 'No definido'}</Text>
            <View style={styles.badgesRow}>
              <View style={[styles.badge, item.is_system ? styles.badgeBlue : styles.badgeGreen]}>
                <Text style={styles.badgeText}>{item.is_system ? 'Sistema' : 'Personalizada'}</Text>
              </View>
              <View style={[styles.badge, item.is_active ? styles.badgeGreen : styles.badgeRed]}>
                <Text style={styles.badgeText}>{item.is_active ? 'Activa' : 'Inactiva'}</Text>
              </View>
            </View>
            <View style={styles.actions}>
              <Pressable
                style={[styles.secondaryBtn, item.is_system && styles.disabledBtn]}
                onPress={() => openEdit(item)}
                disabled={item.is_system}
              >
                <Text style={styles.secondaryBtnText}>Editar</Text>
              </Pressable>
              <Pressable
                style={[styles.dangerBtn, item.is_system && styles.disabledBtn]}
                onPress={() => remove(item)}
                disabled={item.is_system}
              >
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
              <Text style={styles.modalTitle}>{form.unit_id ? 'Editar unidad' : 'Nueva unidad'}</Text>

              <TextInput
                style={styles.input}
                value={form.code}
                onChangeText={(v) => setForm((prev) => ({ ...prev, code: v.toUpperCase() }))}
                placeholder="Codigo *"
                placeholderTextColor="#64748b"
              />
              <TextInput
                style={styles.input}
                value={form.dian_code}
                onChangeText={(v) => setForm((prev) => ({ ...prev, dian_code: v.toUpperCase() }))}
                placeholder="Codigo DIAN"
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
                style={[styles.input, { minHeight: 70 }]}
                value={form.description}
                onChangeText={(v) => setForm((prev) => ({ ...prev, description: v }))}
                placeholder="Descripcion"
                placeholderTextColor="#64748b"
                multiline
              />

              <Pressable
                style={[styles.switchCard, form.is_active && styles.switchCardActive]}
                onPress={() => setForm((prev) => ({ ...prev, is_active: !prev.is_active }))}
              >
                <Text style={styles.switchTitle}>Unidad activa</Text>
                <Text style={styles.switchDesc}>{boolText(form.is_active, 'Si', 'No')}</Text>
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
  badgesRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#0f172a',
  },
  badgeBlue: { borderColor: '#3b82f6' },
  badgeGreen: { borderColor: '#16a34a' },
  badgeRed: { borderColor: '#ef4444' },
  badgeText: { color: '#e2e8f0', fontSize: 11, fontWeight: '700' },
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
  disabledBtn: { opacity: 0.4 },
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
    maxHeight: '86%',
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
  switchCard: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#111827',
    marginTop: 10,
  },
  switchCardActive: { borderColor: '#0ea5e9', backgroundColor: '#0f1f35' },
  switchTitle: { color: '#e2e8f0', fontSize: 13, fontWeight: '700' },
  switchDesc: { color: '#93c5fd', fontSize: 12, marginTop: 4 },
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
