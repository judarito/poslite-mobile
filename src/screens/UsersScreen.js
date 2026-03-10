import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import MultiSelectField from '../components/MultiSelectField';
import PaginatedList from '../components/PaginatedList';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { useThemeMode } from '../lib/themeMode';
import {
  changeTenantUserPassword,
  createTenantUser,
  listRolesForUsers,
  listUsers,
  toggleTenantUserStatus,
  updateTenantUser,
} from '../services/users.service';

const EMPTY_FORM = {
  user_id: null,
  auth_user_id: null,
  email: '',
  password: '',
  full_name: '',
  roleIds: [],
  is_active: true,
};

const EMPTY_PASSWORD_FORM = {
  newPassword: '',
  confirmPassword: '',
};

export default function UsersScreen({ tenant, offlineMode, pageSize = 20 }) {
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';

  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordForm, setPasswordForm] = useState(EMPTY_PASSWORD_FORM);

  const [roles, setRoles] = useState([]);

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
    cacheNamespace: 'setup-users',
    initialFilters: { search: '' },
    fetchPage: async ({ tenantId, page: nextPage, pageSize: nextPageSize, filters: nextFilters }) => {
      const offset = (nextPage - 1) * nextPageSize;
      return listUsers({
        tenantId,
        search: nextFilters?.search || '',
        limit: nextPageSize,
        offset,
      });
    },
  });

  useEffect(() => {
    let active = true;

    const loadRoles = async () => {
      if (!tenant?.tenant_id) return;
      const result = await listRolesForUsers(tenant.tenant_id);
      if (!active) return;
      if (result.success) setRoles(result.data || []);
    };

    loadRoles();

    return () => {
      active = false;
    };
  }, [tenant?.tenant_id]);

  const roleOptions = useMemo(
    () =>
      (roles || []).map((role) => ({
        key: role.role_id,
        label: role.name,
        searchText: role.name,
      })),
    [roles],
  );

  const applySearch = () => {
    updateFilters({ search: search.trim() });
  };

  const openCreate = () => {
    setForm({ ...EMPTY_FORM });
    setModalOpen(true);
  };

  const openEdit = (item) => {
    setForm({
      user_id: item.user_id,
      auth_user_id: item.auth_user_id,
      email: item.email || '',
      password: '',
      full_name: item.full_name || '',
      roleIds: (item.roles || []).map((role) => role.role_id),
      is_active: item.is_active !== false,
    });
    setModalOpen(true);
  };

  const openChangePassword = (item) => {
    setForm((prev) => ({
      ...prev,
      user_id: item.user_id,
      auth_user_id: item.auth_user_id,
      email: item.email || '',
    }));
    setPasswordForm({ ...EMPTY_PASSWORD_FORM });
    setPasswordModalOpen(true);
  };

  const validateForm = () => {
    if (!String(form.email || '').trim()) {
      setError('Email es obligatorio.');
      return false;
    }
    if (!String(form.full_name || '').trim()) {
      setError('Nombre es obligatorio.');
      return false;
    }
    if (!form.user_id && String(form.password || '').length < 6) {
      setError('La contrasena debe tener al menos 6 caracteres.');
      return false;
    }
    if (!Array.isArray(form.roleIds) || form.roleIds.length === 0) {
      setError('Debes asignar al menos un rol.');
      return false;
    }
    return true;
  };

  const save = async () => {
    if (offlineMode) {
      setError('Usuarios no permite escritura en modo offline.');
      return;
    }

    if (!validateForm()) return;

    setSaving(true);
    setError('');

    const result = form.user_id
      ? await updateTenantUser(tenant?.tenant_id, form.user_id, {
          full_name: form.full_name,
          is_active: form.is_active,
          roleIds: form.roleIds,
        })
      : await createTenantUser({
          email: form.email,
          password: form.password,
          full_name: form.full_name,
          roleIds: form.roleIds,
          is_active: form.is_active,
        });

    if (!result.success) {
      setSaving(false);
      setError(result.error || 'No fue posible guardar el usuario.');
      return;
    }

    setSaving(false);
    setModalOpen(false);
    setForm({ ...EMPTY_FORM });
    await loadPage(page, filters);
  };

  const toggleStatus = (item) => {
    const nextStatus = !(item.is_active !== false);
    const action = nextStatus ? 'activar' : 'desactivar';

    Alert.alert('Cambiar estado', `Se va a ${action} el usuario ${item.full_name || item.email}.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Confirmar',
        onPress: async () => {
          if (offlineMode) {
            setError('No puedes cambiar estado en modo offline.');
            return;
          }

          const result = await toggleTenantUserStatus(tenant?.tenant_id, item.user_id, nextStatus);
          if (!result.success) {
            setError(result.error || 'No fue posible actualizar el estado.');
            return;
          }

          await loadPage(page, filters);
        },
      },
    ]);
  };

  const savePassword = async () => {
    if (offlineMode) {
      setError('No puedes cambiar contrasena en modo offline.');
      return;
    }

    if (!form.auth_user_id) {
      setError('Usuario invalido para cambio de contrasena.');
      return;
    }

    if (String(passwordForm.newPassword || '').length < 6) {
      setError('La nueva contrasena debe tener al menos 6 caracteres.');
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError('La confirmacion de contrasena no coincide.');
      return;
    }

    setPasswordSaving(true);
    const result = await changeTenantUserPassword(form.auth_user_id, passwordForm.newPassword);

    if (!result.success) {
      setPasswordSaving(false);
      setError(result.error || 'No fue posible cambiar la contrasena.');
      return;
    }

    setPasswordSaving(false);
    setPasswordModalOpen(false);
    setPasswordForm({ ...EMPTY_PASSWORD_FORM });
  };

  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={styles.toolbar}>
        <TextInput
          style={[styles.searchInput, isLightTheme && styles.searchInputLight]}
          value={search}
          onChangeText={setSearch}
          placeholder="Buscar por nombre o email"
          placeholderTextColor="#64748b"
          onSubmitEditing={applySearch}
          autoCapitalize="none"
        />
        <Pressable style={[styles.searchBtn, isLightTheme && styles.searchBtnLight]} onPress={applySearch}>
          <Text style={[styles.searchBtnText, isLightTheme && styles.searchBtnTextLight]}>Buscar</Text>
        </Pressable>
      </View>

      <PaginatedList
        themeMode={themeMode}
        title="Usuarios"
        loading={loading}
        error={error}
        items={items}
        emptyText="No hay usuarios registrados."
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
          <View key={item.user_id} style={[styles.card, isLightTheme && styles.cardLight]}>
            <Text style={[styles.title, isLightTheme && styles.titleLight]}>{item.full_name || '-'}</Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>{item.email || '-'}</Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>
              Roles: {(item.roles || []).map((role) => role.name).join(', ') || 'Sin roles'}
            </Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>
              Estado: {item.is_active ? 'Activo' : 'Inactivo'}
            </Text>

            <View style={styles.actionsWrap}>
              <Pressable style={[styles.secondaryBtn, isLightTheme && styles.secondaryBtnLight]} onPress={() => openEdit(item)}>
                <Text style={[styles.secondaryBtnText, isLightTheme && styles.secondaryBtnTextLight]}>Editar</Text>
              </Pressable>
              <Pressable style={[styles.infoBtn, isLightTheme && styles.infoBtnLight]} onPress={() => openChangePassword(item)}>
                <Text style={[styles.infoBtnText, isLightTheme && styles.infoBtnTextLight]}>Clave</Text>
              </Pressable>
              <Pressable
                style={[styles.dangerBtn, isLightTheme && styles.dangerBtnLight]}
                onPress={() => toggleStatus(item)}
              >
                <Text style={[styles.dangerBtnText, isLightTheme && styles.dangerBtnTextLight]}>
                  {item.is_active ? 'Desactivar' : 'Activar'}
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      />

      <Pressable style={[styles.fab, isLightTheme && styles.fabLight]} onPress={openCreate}>
        <Text style={[styles.fabText, isLightTheme && styles.fabTextLight]}>+ Nuevo</Text>
      </Pressable>

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBody, isLightTheme && styles.modalBodyLight]}>
            <ScrollView>
              <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>
                {form.user_id ? 'Editar usuario' : 'Nuevo usuario'}
              </Text>

              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight, form.user_id ? styles.inputDisabled : null]}
                value={form.email}
                onChangeText={(value) => setForm((prev) => ({ ...prev, email: value }))}
                placeholder="Email *"
                placeholderTextColor="#64748b"
                autoCapitalize="none"
                keyboardType="email-address"
                editable={!form.user_id}
              />

              {!form.user_id ? (
                <TextInput
                  style={[styles.input, isLightTheme && styles.inputLight]}
                  value={form.password}
                  onChangeText={(value) => setForm((prev) => ({ ...prev, password: value }))}
                  placeholder="Contrasena *"
                  placeholderTextColor="#64748b"
                  secureTextEntry
                />
              ) : null}

              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={form.full_name}
                onChangeText={(value) => setForm((prev) => ({ ...prev, full_name: value }))}
                placeholder="Nombre completo *"
                placeholderTextColor="#64748b"
              />

              <MultiSelectField
                title="Roles"
                options={roleOptions}
                selectedKeys={form.roleIds}
                onChange={(nextRoleIds) => setForm((prev) => ({ ...prev, roleIds: nextRoleIds }))}
                placeholder="Selecciona roles"
                themeMode={themeMode}
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
                  Estado: {form.is_active ? 'Activo' : 'Inactivo'}
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

      <Modal
        visible={passwordModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPasswordModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBody, isLightTheme && styles.modalBodyLight]}>
            <ScrollView>
              <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>Cambiar contrasena</Text>
              <Text style={[styles.meta, isLightTheme && styles.metaLight]}>Usuario: {form.email || '-'}</Text>

              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={passwordForm.newPassword}
                onChangeText={(value) => setPasswordForm((prev) => ({ ...prev, newPassword: value }))}
                placeholder="Nueva contrasena"
                placeholderTextColor="#64748b"
                secureTextEntry
              />

              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={passwordForm.confirmPassword}
                onChangeText={(value) => setPasswordForm((prev) => ({ ...prev, confirmPassword: value }))}
                placeholder="Confirmar contrasena"
                placeholderTextColor="#64748b"
                secureTextEntry
              />

              <Pressable
                style={[styles.primaryBtn, isLightTheme && styles.primaryBtnLight]}
                onPress={savePassword}
                disabled={passwordSaving}
              >
                <Text style={[styles.primaryBtnText, isLightTheme && styles.primaryBtnTextLight]}>
                  {passwordSaving ? 'Guardando...' : 'Actualizar contrasena'}
                </Text>
              </Pressable>
            </ScrollView>

            <Pressable
              onPress={() => setPasswordModalOpen(false)}
              style={[styles.closeBtn, isLightTheme && styles.closeBtnLight]}
            >
              <Text style={[styles.closeBtnText, isLightTheme && styles.closeBtnTextLight]}>Cerrar</Text>
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
  searchBtnLight: { backgroundColor: '#235ea9' },
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
  meta: { color: '#cbd5e1', marginTop: 2, fontSize: 12 },
  metaLight: { color: '#475569' },
  actionsWrap: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  secondaryBtn: { backgroundColor: '#235ea9', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center' },
  secondaryBtnLight: { backgroundColor: '#235ea9' },
  secondaryBtnText: { color: '#dbeafe', fontWeight: '700', fontSize: 12 },
  secondaryBtnTextLight: { color: '#eff6ff' },
  infoBtn: { backgroundColor: '#0f766e', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center' },
  infoBtnLight: { backgroundColor: '#0d9488' },
  infoBtnText: { color: '#ccfbf1', fontWeight: '700', fontSize: 12 },
  infoBtnTextLight: { color: '#ecfeff' },
  dangerBtn: { backgroundColor: '#7f1d1d', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center' },
  dangerBtnLight: { backgroundColor: '#dc2626' },
  dangerBtnText: { color: '#fee2e2', fontWeight: '700', fontSize: 12 },
  dangerBtnTextLight: { color: '#fff1f2' },
  fab: {
    backgroundColor: '#57d65a',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  fabLight: { backgroundColor: '#57d65a' },
  fabText: { color: '#062915', fontWeight: '800' },
  fabTextLight: { color: '#062915' },
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
  inputDisabled: { opacity: 0.6 },
  option: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: '#111827',
    marginTop: 8,
  },
  optionActive: { borderColor: '#235ea9', backgroundColor: '#235ea9' },
  optionLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  optionActiveLight: { borderColor: '#235ea9', backgroundColor: '#eff6ff' },
  optionText: { color: '#cbd5e1', fontWeight: '600' },
  optionTextLight: { color: '#334155' },
  optionTextActive: { color: '#eff6ff' },
  optionTextActiveLight: { color: '#235ea9' },
  primaryBtn: { marginTop: 14, backgroundColor: '#57d65a', borderRadius: 8, paddingVertical: 11, alignItems: 'center' },
  primaryBtnLight: { backgroundColor: '#57d65a' },
  primaryBtnText: { color: '#062915', fontWeight: '700' },
  primaryBtnTextLight: { color: '#062915' },
  closeBtn: {
    marginTop: 10,
    alignSelf: 'flex-end',
    backgroundColor: '#235ea9',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  closeBtnLight: { backgroundColor: '#e2e8f0' },
  closeBtnText: { color: '#fff', fontWeight: '700' },
  closeBtnTextLight: { color: '#1e293b' },
});
