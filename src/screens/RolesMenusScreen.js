import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import MultiSelectField from '../components/MultiSelectField';
import PaginatedList from '../components/PaginatedList';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { useThemeMode } from '../lib/themeMode';
import {
  createGlobalRoleForAllTenants,
  createRole,
  getRoleMenuItems,
  getRolePermissionIds,
  listMenuItems,
  listPermissions,
  listRoles,
  removeRole,
  setRoleMenuItems,
  setRolePermissionIds,
  syncGlobalRoleMenus,
  updateRole,
} from '../services/rolesMenus.service';

const EMPTY_ROLE_FORM = {
  role_id: null,
  name: '',
};

function normalizeRoleName(name = '') {
  return String(name || '').trim().toUpperCase();
}

export default function RolesMenusScreen({ tenant, userProfile, offlineMode, pageSize = 20 }) {
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';

  const [search, setSearch] = useState('');
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [savingRole, setSavingRole] = useState(false);
  const [roleForm, setRoleForm] = useState(EMPTY_ROLE_FORM);

  const [permissionsModalOpen, setPermissionsModalOpen] = useState(false);
  const [menusModalOpen, setMenusModalOpen] = useState(false);
  const [savingAssignments, setSavingAssignments] = useState(false);

  const [selectedRole, setSelectedRole] = useState(null);
  const [selectedPermissionIds, setSelectedPermissionIds] = useState([]);
  const [selectedMenuItemIds, setSelectedMenuItemIds] = useState([]);

  const [permissions, setPermissions] = useState([]);
  const [menuItems, setMenuItems] = useState([]);

  const roleNames = useMemo(
    () => new Set((userProfile?.roles || []).map((role) => String(role?.name || '').toUpperCase())),
    [userProfile?.roles],
  );

  const permissionCodes = useMemo(
    () => new Set((userProfile?.permissionCodes || []).map((code) => String(code || '').toUpperCase())),
    [userProfile?.permissionCodes],
  );

  const isSuperAdmin = roleNames.has('SUPERADMIN') || permissionCodes.has('SUPERADMIN.MANAGE');

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
    cacheNamespace: 'setup-roles-menus',
    initialFilters: { search: '' },
    fetchPage: async ({ tenantId, page: nextPage, pageSize: nextPageSize, filters: nextFilters }) => {
      const offset = (nextPage - 1) * nextPageSize;
      return listRoles({
        tenantId,
        search: nextFilters?.search || '',
        limit: nextPageSize,
        offset,
      });
    },
  });

  useEffect(() => {
    let active = true;

    const loadLookups = async () => {
      const [permissionsResult, menuItemsResult] = await Promise.all([
        listPermissions(),
        listMenuItems({ includeInactive: false }),
      ]);

      if (!active) return;
      if (permissionsResult.success) setPermissions(permissionsResult.data || []);
      if (menuItemsResult.success) setMenuItems(menuItemsResult.data || []);
    };

    loadLookups();

    return () => {
      active = false;
    };
  }, []);

  const permissionOptions = useMemo(
    () =>
      (permissions || []).map((permission) => ({
        key: permission.permission_id,
        label: `${permission.code}${permission.description ? ` - ${permission.description}` : ''}`,
        searchText: `${permission.code} ${permission.description || ''}`,
      })),
    [permissions],
  );

  const menuOptions = useMemo(() => {
    const filtered = (menuItems || []).filter((item) => {
      if (!isSuperAdmin && item.is_superadmin_only) return false;
      return Boolean(item.route || item.action);
    });

    return filtered.map((item) => ({
      key: item.menu_item_id,
      label: `${item.code} - ${item.label}`,
      searchText: `${item.code} ${item.label} ${item.route || ''} ${item.action || ''}`,
      code: item.code,
    }));
  }, [isSuperAdmin, menuItems]);

  const menuById = useMemo(() => {
    const map = new Map();
    menuOptions.forEach((option) => {
      map.set(String(option.key), option);
    });
    return map;
  }, [menuOptions]);

  const applySearch = () => {
    updateFilters({ search: search.trim() });
  };

  const openCreateRole = () => {
    setRoleForm({ ...EMPTY_ROLE_FORM });
    setRoleModalOpen(true);
  };

  const openEditRole = (role) => {
    setRoleForm({
      role_id: role.role_id,
      name: role.name || '',
    });
    setRoleModalOpen(true);
  };

  const saveRole = async () => {
    if (offlineMode) {
      setError('Roles no permite escritura en modo offline.');
      return;
    }

    const roleName = normalizeRoleName(roleForm.name);
    if (!roleName) {
      setError('Nombre de rol es obligatorio.');
      return;
    }

    setSavingRole(true);
    setError('');

    const result = roleForm.role_id
      ? await updateRole(tenant?.tenant_id, roleForm.role_id, roleName)
      : await createRole(tenant?.tenant_id, roleName);

    if (!result.success) {
      setSavingRole(false);
      setError(result.error || 'No fue posible guardar el rol.');
      return;
    }

    if (!roleForm.role_id && isSuperAdmin) {
      const globalResult = await createGlobalRoleForAllTenants(roleName, [], []);
      if (!globalResult.success) {
        setError(globalResult.error || 'Rol creado localmente, pero no se pudo replicar globalmente.');
      }
    }

    setSavingRole(false);
    setRoleModalOpen(false);
    setRoleForm({ ...EMPTY_ROLE_FORM });
    await loadPage(page, filters);
  };

  const confirmDeleteRole = (role) => {
    Alert.alert('Eliminar rol', `Se eliminara el rol ${role.name}.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: async () => {
          if (offlineMode) {
            setError('No puedes eliminar roles en modo offline.');
            return;
          }

          const result = await removeRole(tenant?.tenant_id, role.role_id);
          if (!result.success) {
            setError(result.error || 'No fue posible eliminar el rol.');
            return;
          }

          await loadPage(page, filters);
        },
      },
    ]);
  };

  const openPermissionsModal = async (role) => {
    setSelectedRole(role);
    setSelectedPermissionIds([]);
    setPermissionsModalOpen(true);

    const result = await getRolePermissionIds(tenant?.tenant_id, role.role_id);
    if (!result.success) {
      setError(result.error || 'No fue posible cargar permisos del rol.');
      return;
    }

    setSelectedPermissionIds((result.data || []).map((item) => String(item)));
  };

  const openMenusModal = async (role) => {
    setSelectedRole(role);
    setSelectedMenuItemIds([]);
    setMenusModalOpen(true);

    const result = await getRoleMenuItems(role.role_id);
    if (!result.success) {
      setError(result.error || 'No fue posible cargar menus del rol.');
      return;
    }

    setSelectedMenuItemIds((result.data?.menuItemIds || []).map((item) => String(item)));
  };

  const savePermissions = async () => {
    if (!selectedRole?.role_id) return;
    if (offlineMode) {
      setError('No puedes actualizar permisos en modo offline.');
      return;
    }

    setSavingAssignments(true);
    const result = await setRolePermissionIds(
      tenant?.tenant_id,
      selectedRole.role_id,
      selectedPermissionIds,
    );

    if (!result.success) {
      setSavingAssignments(false);
      setError(result.error || 'No fue posible actualizar permisos.');
      return;
    }

    setSavingAssignments(false);
    setPermissionsModalOpen(false);
    await loadPage(page, filters);
  };

  const saveMenus = async () => {
    if (!selectedRole?.role_id) return false;
    if (offlineMode) {
      setError('No puedes actualizar menus en modo offline.');
      return false;
    }

    setSavingAssignments(true);
    const result = await setRoleMenuItems(tenant?.tenant_id, selectedRole.role_id, selectedMenuItemIds);

    if (!result.success) {
      setSavingAssignments(false);
      setError(result.error || 'No fue posible actualizar menus.');
      return false;
    }

    setSavingAssignments(false);
    setMenusModalOpen(false);
    await loadPage(page, filters);
    return true;
  };

  const saveMenusAndSyncGlobal = async () => {
    const saved = await saveMenus();
    if (!saved) return;

    if (!isSuperAdmin || !selectedRole?.name) return;

    const menuCodes = selectedMenuItemIds
      .map((id) => menuById.get(String(id))?.code)
      .filter(Boolean);

    const syncResult = await syncGlobalRoleMenus(selectedRole.name, menuCodes);
    if (!syncResult.success) {
      setError(syncResult.error || 'Se guardo localmente, pero fallo la sincronizacion global.');
      return;
    }
  };

  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={styles.toolbar}>
        <TextInput
          style={[styles.searchInput, isLightTheme && styles.searchInputLight]}
          value={search}
          onChangeText={setSearch}
          placeholder="Buscar rol"
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
        title="Roles y Menus"
        loading={loading}
        error={error}
        items={items}
        emptyText="No hay roles configurados."
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
          <View key={item.role_id} style={[styles.card, isLightTheme && styles.cardLight]}>
            <Text style={[styles.title, isLightTheme && styles.titleLight]}>{item.name}</Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>
              Permisos: {item.role_permissions?.length || 0}
            </Text>
            <View style={styles.actionsWrap}>
              <Pressable style={[styles.secondaryBtn, isLightTheme && styles.secondaryBtnLight]} onPress={() => openEditRole(item)}>
                <Text style={[styles.secondaryBtnText, isLightTheme && styles.secondaryBtnTextLight]}>Editar</Text>
              </Pressable>
              <Pressable style={[styles.infoBtn, isLightTheme && styles.infoBtnLight]} onPress={() => openPermissionsModal(item)}>
                <Text style={[styles.infoBtnText, isLightTheme && styles.infoBtnTextLight]}>Permisos</Text>
              </Pressable>
              <Pressable style={[styles.infoBtn, isLightTheme && styles.infoBtnLight]} onPress={() => openMenusModal(item)}>
                <Text style={[styles.infoBtnText, isLightTheme && styles.infoBtnTextLight]}>Menus</Text>
              </Pressable>
              <Pressable style={[styles.dangerBtn, isLightTheme && styles.dangerBtnLight]} onPress={() => confirmDeleteRole(item)}>
                <Text style={[styles.dangerBtnText, isLightTheme && styles.dangerBtnTextLight]}>Eliminar</Text>
              </Pressable>
            </View>
          </View>
        )}
      />

      <Pressable style={[styles.fab, isLightTheme && styles.fabLight]} onPress={openCreateRole}>
        <Text style={[styles.fabText, isLightTheme && styles.fabTextLight]}>+ Nuevo</Text>
      </Pressable>

      <Modal visible={roleModalOpen} transparent animationType="slide" onRequestClose={() => setRoleModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBody, isLightTheme && styles.modalBodyLight]}>
            <ScrollView>
              <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>
                {roleForm.role_id ? 'Editar rol' : 'Nuevo rol'}
              </Text>

              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={roleForm.name}
                onChangeText={(value) => setRoleForm((prev) => ({ ...prev, name: value }))}
                placeholder="Nombre del rol"
                placeholderTextColor="#64748b"
                autoCapitalize="characters"
              />

              {isSuperAdmin && !roleForm.role_id ? (
                <Text style={[styles.meta, isLightTheme && styles.metaLight]}>
                  Al crear roles como superadmin se replica automaticamente a todos los tenants.
                </Text>
              ) : null}

              <Pressable
                style={[styles.primaryBtn, isLightTheme && styles.primaryBtnLight]}
                onPress={saveRole}
                disabled={savingRole}
              >
                <Text style={[styles.primaryBtnText, isLightTheme && styles.primaryBtnTextLight]}>
                  {savingRole ? 'Guardando...' : 'Guardar'}
                </Text>
              </Pressable>
            </ScrollView>

            <Pressable onPress={() => setRoleModalOpen(false)} style={[styles.closeBtn, isLightTheme && styles.closeBtnLight]}>
              <Text style={[styles.closeBtnText, isLightTheme && styles.closeBtnTextLight]}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={permissionsModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setPermissionsModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBody, isLightTheme && styles.modalBodyLight]}>
            <ScrollView>
              <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>
                Permisos de {selectedRole?.name || 'rol'}
              </Text>

              <MultiSelectField
                title="Permisos"
                options={permissionOptions}
                selectedKeys={selectedPermissionIds}
                onChange={setSelectedPermissionIds}
                placeholder="Selecciona permisos"
                themeMode={themeMode}
                maxPreview={1}
              />

              <Pressable
                style={[styles.primaryBtn, isLightTheme && styles.primaryBtnLight]}
                onPress={savePermissions}
                disabled={savingAssignments}
              >
                <Text style={[styles.primaryBtnText, isLightTheme && styles.primaryBtnTextLight]}>
                  {savingAssignments ? 'Guardando...' : 'Guardar permisos'}
                </Text>
              </Pressable>
            </ScrollView>

            <Pressable
              onPress={() => setPermissionsModalOpen(false)}
              style={[styles.closeBtn, isLightTheme && styles.closeBtnLight]}
            >
              <Text style={[styles.closeBtnText, isLightTheme && styles.closeBtnTextLight]}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={menusModalOpen} transparent animationType="slide" onRequestClose={() => setMenusModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBody, isLightTheme && styles.modalBodyLight]}>
            <ScrollView>
              <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>
                Menus de {selectedRole?.name || 'rol'}
              </Text>

              <MultiSelectField
                title="Menus"
                options={menuOptions}
                selectedKeys={selectedMenuItemIds}
                onChange={setSelectedMenuItemIds}
                placeholder="Selecciona menus"
                themeMode={themeMode}
                maxPreview={1}
              />

              <Pressable
                style={[styles.primaryBtn, isLightTheme && styles.primaryBtnLight]}
                onPress={saveMenus}
                disabled={savingAssignments}
              >
                <Text style={[styles.primaryBtnText, isLightTheme && styles.primaryBtnTextLight]}>
                  {savingAssignments ? 'Guardando...' : 'Guardar menus'}
                </Text>
              </Pressable>

              {isSuperAdmin ? (
                <Pressable
                  style={[styles.secondaryBtnLarge, isLightTheme && styles.secondaryBtnLargeLight]}
                  onPress={saveMenusAndSyncGlobal}
                  disabled={savingAssignments}
                >
                  <Text style={[styles.secondaryBtnLargeText, isLightTheme && styles.secondaryBtnLargeTextLight]}>
                    Guardar + Sincronizar global
                  </Text>
                </Pressable>
              ) : null}
            </ScrollView>

            <Pressable onPress={() => setMenusModalOpen(false)} style={[styles.closeBtn, isLightTheme && styles.closeBtnLight]}>
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
  secondaryBtnLarge: {
    marginTop: 10,
    backgroundColor: '#0f766e',
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
  },
  secondaryBtnLargeLight: { backgroundColor: '#0d9488' },
  secondaryBtnLargeText: { color: '#ccfbf1', fontWeight: '700' },
  secondaryBtnLargeTextLight: { color: '#ecfeff' },
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
