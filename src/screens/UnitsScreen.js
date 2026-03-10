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
          style={[styles.searchInput, isLightTheme && styles.searchInputLight]}
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
          <View key={item.unit_id} style={[styles.card, isLightTheme && styles.cardLight]}>
            <Text style={[styles.title, isLightTheme && styles.titleLight]}>{item.name}</Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>Codigo: {item.code || '-'}</Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>DIAN: {item.dian_code || 'No definido'}</Text>
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
          <View style={[styles.modalBody, isLightTheme && styles.modalBodyLight]}>
            <ScrollView>
              <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>
                {form.unit_id ? 'Editar unidad' : 'Nueva unidad'}
              </Text>

              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={form.code}
                onChangeText={(v) => setForm((prev) => ({ ...prev, code: v.toUpperCase() }))}
                placeholder="Codigo *"
                placeholderTextColor="#64748b"
              />
              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={form.dian_code}
                onChangeText={(v) => setForm((prev) => ({ ...prev, dian_code: v.toUpperCase() }))}
                placeholder="Codigo DIAN"
                placeholderTextColor="#64748b"
              />
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

              <Pressable
                style={[
                  styles.switchCard,
                  isLightTheme && styles.switchCardLight,
                  form.is_active && styles.switchCardActive,
                  form.is_active && isLightTheme && styles.switchCardActiveLight,
                ]}
                onPress={() => setForm((prev) => ({ ...prev, is_active: !prev.is_active }))}
              >
                <Text style={[styles.switchTitle, isLightTheme && styles.switchTitleLight]}>Unidad activa</Text>
                <Text style={[styles.switchDesc, isLightTheme && styles.switchDescLight]}>
                  {boolText(form.is_active, 'Si', 'No')}
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
  container: { flex: 1, backgroundColor: '#060b16', padding: 12 },
  containerLight: { backgroundColor: '#edf2fb' },
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
    backgroundColor: '#235ea9',
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
  cardLight: { borderColor: '#dbe4ef', backgroundColor: '#ffffff' },
  title: { color: '#f8fafc', fontWeight: '700', fontSize: 15 },
  titleLight: { color: '#0f172a' },
  meta: { color: '#cbd5e1', marginTop: 2, fontSize: 13 },
  metaLight: { color: '#475569' },
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
    backgroundColor: '#235ea9',
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
    backgroundColor: '#57d65a',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  fabText: { color: '#062915', fontWeight: '800' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalBody: {
    maxHeight: '86%',
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
  switchCard: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#111827',
    marginTop: 10,
  },
  switchCardLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  switchCardActive: { borderColor: '#235ea9', backgroundColor: '#0f1f35' },
  switchCardActiveLight: { borderColor: '#235ea9', backgroundColor: '#eff6ff' },
  switchTitle: { color: '#e2e8f0', fontSize: 13, fontWeight: '700' },
  switchTitleLight: { color: '#0f172a' },
  switchDesc: { color: '#93c5fd', fontSize: 12, marginTop: 4 },
  switchDescLight: { color: '#235ea9' },
  primaryBtn: {
    backgroundColor: '#57d65a',
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#062915', fontWeight: '700' },
  closeBtn: {
    marginTop: 12,
    alignSelf: 'flex-end',
    backgroundColor: '#235ea9',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  closeBtnText: { color: '#fff', fontWeight: '700' },
});
