import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import PaginatedList from '../components/PaginatedList';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { useThemeMode } from '../lib/themeMode';
import {
  createCategory,
  listAllCategories,
  listCategories,
  removeCategory,
  updateCategory,
} from '../services/categories.service';

const EMPTY_FORM = {
  category_id: null,
  name: '',
  parent_category_id: null,
};

export default function CategoriesScreen({ tenant, offlineMode, pageSize = 20 }) {
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [parentOptions, setParentOptions] = useState([]);

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
    cacheNamespace: 'catalog-categories',
    initialFilters: { search: '' },
    fetchPage: async ({ page: nextPage, pageSize: nextPageSize, filters: nextFilters, tenantId }) => {
      const offset = (nextPage - 1) * nextPageSize;
      return listCategories({
        tenantId,
        search: nextFilters?.search || '',
        limit: nextPageSize,
        offset,
      });
    },
  });

  const loadParents = async () => {
    const result = await listAllCategories(tenant?.tenant_id);
    if (!result.success) return;
    setParentOptions(result.data || []);
  };

  const openCreate = async () => {
    setForm({ ...EMPTY_FORM });
    await loadParents();
    setModalOpen(true);
  };

  const openEdit = async (item) => {
    setForm({
      category_id: item.category_id,
      name: item.name || '',
      parent_category_id: item.parent_category_id || null,
    });
    await loadParents();
    setModalOpen(true);
  };

  const save = async () => {
    if (offlineMode) {
      setError('Categorias no permite escritura en modo offline.');
      return;
    }

    const name = String(form.name || '').trim();
    if (!name) {
      setError('Nombre de categoria es obligatorio.');
      return;
    }

    setSaving(true);
    setError('');

    const payload = {
      tenant_id: tenant?.tenant_id,
      name,
      parent_category_id: form.parent_category_id || null,
    };

    const result = form.category_id
      ? await updateCategory(form.category_id, tenant?.tenant_id, payload)
      : await createCategory(payload);

    if (!result.success) {
      setError(result.error || 'No se pudo guardar categoria');
      setSaving(false);
      return;
    }

    setModalOpen(false);
    setForm({ ...EMPTY_FORM });
    await loadPage(page, filters);
    setSaving(false);
  };

  const remove = (item) => {
    Alert.alert('Eliminar categoria', `Se eliminara ${item.name}.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          if (offlineMode) {
            setError('No puedes eliminar categorias en modo offline.');
            return;
          }
          const result = await removeCategory(item.category_id, tenant?.tenant_id);
          if (!result.success) {
            setError(result.error || 'No se pudo eliminar categoria');
            return;
          }
          await loadPage(page, filters);
        },
      },
    ]);
  };

  const parentName = (item) => item.parent?.name || 'Categoria principal';

  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={styles.toolbar}>
        <TextInput
          style={[styles.searchInput, isLightTheme && styles.searchInputLight]}
          value={search}
          onChangeText={setSearch}
          placeholder="Buscar categoria"
          placeholderTextColor="#64748b"
          onSubmitEditing={() => updateFilters({ search })}
        />
        <Pressable style={styles.searchBtn} onPress={() => updateFilters({ search })}>
          <Text style={styles.searchBtnText}>Buscar</Text>
        </Pressable>
      </View>

      <PaginatedList
        themeMode={themeMode}
        title="Categorias"
        loading={loading}
        error={error}
        items={rows}
        emptyText="No hay categorias registradas."
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
          <View key={item.category_id} style={[styles.card, isLightTheme && styles.cardLight]}>
            <Text style={[styles.title, isLightTheme && styles.titleLight]}>{item.name}</Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>{parentName(item)}</Text>
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
          <View style={[styles.modalBody, isLightTheme && styles.modalBodyLight]}>
            <ScrollView>
              <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>{form.category_id ? 'Editar categoria' : 'Nueva categoria'}</Text>

              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={form.name}
                onChangeText={(v) => setForm((prev) => ({ ...prev, name: v }))}
                placeholder="Nombre *"
                placeholderTextColor="#64748b"
              />

              <Text style={[styles.groupTitle, isLightTheme && styles.groupTitleLight]}>Categoria padre</Text>
              <Pressable
                style={[
                  styles.parentOption,
                  isLightTheme && styles.parentOptionLight,
                  form.parent_category_id === null && styles.parentOptionActive,
                ]}
                onPress={() => setForm((prev) => ({ ...prev, parent_category_id: null }))}
              >
                <Text
                  style={[
                    styles.parentOptionText,
                    isLightTheme && styles.parentOptionTextLight,
                    form.parent_category_id === null && styles.parentOptionTextActive,
                  ]}
                >
                  Categoria principal
                </Text>
              </Pressable>

              {(parentOptions || [])
                .filter((opt) => opt.category_id !== form.category_id)
                .map((opt) => {
                  const active = opt.category_id === form.parent_category_id;
                  return (
                    <Pressable
                      key={opt.category_id}
                      style={[styles.parentOption, isLightTheme && styles.parentOptionLight, active && styles.parentOptionActive]}
                      onPress={() => setForm((prev) => ({ ...prev, parent_category_id: opt.category_id }))}
                    >
                      <Text style={[styles.parentOptionText, isLightTheme && styles.parentOptionTextLight, active && styles.parentOptionTextActive]}>
                        {opt.name}
                      </Text>
                    </Pressable>
                  );
                })}

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
  searchInputLight: {
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    color: '#0f172a',
  },
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
  meta: { color: '#cbd5e1', marginTop: 3, fontSize: 13 },
  metaLight: { color: '#475569' },
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
  groupTitleLight: { color: '#235ea9' },
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
  parentOption: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: '#111827',
    marginTop: 8,
  },
  parentOptionLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  parentOptionActive: { borderColor: '#235ea9', backgroundColor: '#235ea9' },
  parentOptionText: { color: '#cbd5e1', fontWeight: '600' },
  parentOptionTextLight: { color: '#334155' },
  parentOptionTextActive: { color: '#eff6ff' },
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
