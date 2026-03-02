import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import PaginatedList from '../components/PaginatedList';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { useThemeMode } from '../lib/themeMode';
import {
  assignCashRegisterToUser,
  listActiveCashRegisters,
  listCashAssignments,
  listLocations,
  listUsers,
} from '../services/cashMenu.service';

const ACTIVE_FILTERS = [
  { label: 'Activas', value: true },
  { label: 'Inactivas', value: false },
  { label: 'Todas', value: null },
];

export default function CashAssignmentsScreen({ tenant, userProfile, offlineMode, pageSize = 20 }) {
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';
  const [users, setUsers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [registers, setRegisters] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newAssignment, setNewAssignment] = useState({
    user_id: null,
    cash_register_id: null,
    note: '',
  });

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
    cacheNamespace: 'cash-assignments',
    initialFilters: { user_id: '', location_id: '', is_active: true },
    fetchPage: async ({ page: nextPage, pageSize: nextPageSize, filters: nextFilters, tenantId }) => {
      const offset = (nextPage - 1) * nextPageSize;
      return listCashAssignments({
        tenantId,
        userId: nextFilters?.user_id || null,
        locationId: nextFilters?.location_id || null,
        isActive: typeof nextFilters?.is_active === 'boolean' ? nextFilters.is_active : null,
        limit: nextPageSize,
        offset,
      });
    },
  });

  useEffect(() => {
    const loadLookups = async () => {
      if (!tenant?.tenant_id) return;
      const [usersRes, locationsRes, registersRes] = await Promise.all([
        listUsers(tenant.tenant_id),
        listLocations(tenant.tenant_id),
        listActiveCashRegisters(tenant.tenant_id),
      ]);
      if (usersRes.success) setUsers(usersRes.data || []);
      if (locationsRes.success) setLocations(locationsRes.data || []);
      if (registersRes.success) setRegisters(registersRes.data || []);
    };
    loadLookups();
  }, [tenant?.tenant_id]);

  const openAssignDialog = () => {
    setNewAssignment({ user_id: null, cash_register_id: null, note: '' });
    setDialogOpen(true);
  };

  const saveAssignment = async () => {
    if (offlineMode) {
      setError('Asignacion de cajas no permite escritura en modo offline.');
      return;
    }
    if (!newAssignment.user_id || !newAssignment.cash_register_id) {
      setError('Selecciona cajero y caja.');
      return;
    }

    setSaving(true);
    setError('');

    const result = await assignCashRegisterToUser({
      tenantId: tenant?.tenant_id,
      cashRegisterId: newAssignment.cash_register_id,
      userId: newAssignment.user_id,
      assignedBy: userProfile?.user_id,
      isActive: true,
      note: newAssignment.note || null,
    });

    if (!result.success) {
      setError(result.error || 'No fue posible asignar caja');
      setSaving(false);
      return;
    }

    setDialogOpen(false);
    await loadPage(page, filters);
    setSaving(false);
  };

  const toggleActive = async (item) => {
    if (offlineMode) {
      setError('No puedes cambiar asignaciones en modo offline.');
      return;
    }

    const result = await assignCashRegisterToUser({
      tenantId: tenant?.tenant_id,
      cashRegisterId: item.cash_register_id,
      userId: item.user_id,
      assignedBy: userProfile?.user_id,
      isActive: !item.is_active,
      note: item.is_active ? 'Desactivada desde mobile' : 'Activada desde mobile',
    });

    if (!result.success) {
      setError(result.error || 'No fue posible actualizar asignacion');
      return;
    }

    await loadPage(page, filters);
  };

  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll}>
        <View style={styles.chipsRow}>
          <Pressable
            style={[
              styles.filterChip,
              isLightTheme && styles.filterChipLight,
              !filters?.user_id && styles.filterChipActive,
              !filters?.user_id && isLightTheme && styles.filterChipActiveLight,
            ]}
            onPress={() => updateFilters({ user_id: '' })}
          >
            <Text
              style={[
                styles.filterChipText,
                isLightTheme && styles.filterChipTextLight,
                !filters?.user_id && styles.filterChipTextActive,
                !filters?.user_id && isLightTheme && styles.filterChipTextActiveLight,
              ]}
            >
              Todos cajeros
            </Text>
          </Pressable>
          {users.map((u) => {
            const active = filters?.user_id === u.user_id;
            return (
              <Pressable
                key={u.user_id}
                style={[
                  styles.filterChip,
                  isLightTheme && styles.filterChipLight,
                  active && styles.filterChipActive,
                  active && isLightTheme && styles.filterChipActiveLight,
                ]}
                onPress={() => updateFilters({ user_id: u.user_id })}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    isLightTheme && styles.filterChipTextLight,
                    active && styles.filterChipTextActive,
                    active && isLightTheme && styles.filterChipTextActiveLight,
                  ]}
                >
                  {u.full_name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll}>
        <View style={styles.chipsRow}>
          <Pressable
            style={[
              styles.filterChip,
              isLightTheme && styles.filterChipLight,
              !filters?.location_id && styles.filterChipActive,
              !filters?.location_id && isLightTheme && styles.filterChipActiveLight,
            ]}
            onPress={() => updateFilters({ location_id: '' })}
          >
            <Text
              style={[
                styles.filterChipText,
                isLightTheme && styles.filterChipTextLight,
                !filters?.location_id && styles.filterChipTextActive,
                !filters?.location_id && isLightTheme && styles.filterChipTextActiveLight,
              ]}
            >
              Todas sedes
            </Text>
          </Pressable>
          {locations.map((loc) => {
            const active = filters?.location_id === loc.location_id;
            return (
              <Pressable
                key={loc.location_id}
                style={[
                  styles.filterChip,
                  isLightTheme && styles.filterChipLight,
                  active && styles.filterChipActive,
                  active && isLightTheme && styles.filterChipActiveLight,
                ]}
                onPress={() => updateFilters({ location_id: loc.location_id })}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    isLightTheme && styles.filterChipTextLight,
                    active && styles.filterChipTextActive,
                    active && isLightTheme && styles.filterChipTextActiveLight,
                  ]}
                >
                  {loc.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll}>
        <View style={styles.chipsRow}>
          {ACTIVE_FILTERS.map((opt) => {
            const active = filters?.is_active === opt.value;
            return (
              <Pressable
                key={opt.label}
                style={[
                  styles.filterChip,
                  isLightTheme && styles.filterChipLight,
                  active && styles.filterChipActive,
                  active && isLightTheme && styles.filterChipActiveLight,
                ]}
                onPress={() => updateFilters({ is_active: opt.value })}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    isLightTheme && styles.filterChipTextLight,
                    active && styles.filterChipTextActive,
                    active && isLightTheme && styles.filterChipTextActiveLight,
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <PaginatedList
        themeMode={themeMode}
        title="Asignacion de Cajas"
        loading={loading}
        error={error}
        items={items}
        emptyText="No hay asignaciones para este filtro."
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
          <View key={item.assignment_id} style={[styles.card, isLightTheme && styles.cardLight]}>
            <Text style={[styles.title, isLightTheme && styles.titleLight]}>{item.user_name || 'Cajero'}</Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>{item.cash_register_name || 'Caja'} · {item.location_name || 'Sin sede'}</Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>Asignado: {new Date(item.assigned_at).toLocaleString()}</Text>
            <View style={styles.badgesRow}>
              <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: item.is_active ? '#16a34a' : '#64748b' }]}>
                <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>{item.is_active ? 'Activa' : 'Inactiva'}</Text>
              </View>
            </View>
            <Pressable style={[styles.secondaryBtn, isLightTheme && styles.secondaryBtnLight]} onPress={() => toggleActive(item)}>
              <Text style={[styles.secondaryBtnText, isLightTheme && styles.secondaryBtnTextLight]}>{item.is_active ? 'Desactivar' : 'Activar'}</Text>
            </Pressable>
          </View>
        )}
      />

      <Pressable style={[styles.fab, isLightTheme && styles.fabLight]} onPress={openAssignDialog}>
        <Text style={[styles.fabText, isLightTheme && styles.fabTextLight]}>+ Asignar</Text>
      </Pressable>

      <Modal visible={dialogOpen} transparent animationType="slide" onRequestClose={() => setDialogOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBody, isLightTheme && styles.modalBodyLight]}>
            <ScrollView>
              <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>Asignar caja</Text>

              <Text style={[styles.groupTitle, isLightTheme && styles.groupTitleLight]}>Cajero</Text>
              {users.map((u) => {
                const active = newAssignment.user_id === u.user_id;
                return (
                  <Pressable
                    key={u.user_id}
                    style={[
                      styles.option,
                      isLightTheme && styles.optionLight,
                      active && styles.optionActive,
                      active && isLightTheme && styles.optionActiveLight,
                    ]}
                    onPress={() => setNewAssignment((prev) => ({ ...prev, user_id: u.user_id }))}
                  >
                    <Text style={[styles.optionText, isLightTheme && styles.optionTextLight, active && styles.optionTextActive, active && isLightTheme && styles.optionTextActiveLight]}>{u.full_name}</Text>
                  </Pressable>
                );
              })}

              <Text style={[styles.groupTitle, isLightTheme && styles.groupTitleLight]}>Caja</Text>
              {registers.map((r) => {
                const active = newAssignment.cash_register_id === r.cash_register_id;
                return (
                  <Pressable
                    key={r.cash_register_id}
                    style={[
                      styles.option,
                      isLightTheme && styles.optionLight,
                      active && styles.optionActive,
                      active && isLightTheme && styles.optionActiveLight,
                    ]}
                    onPress={() =>
                      setNewAssignment((prev) => ({ ...prev, cash_register_id: r.cash_register_id }))
                    }
                  >
                    <Text style={[styles.optionText, isLightTheme && styles.optionTextLight, active && styles.optionTextActive, active && isLightTheme && styles.optionTextActiveLight]}>
                      {r.name} ({r.location?.name || 'Sin sede'})
                    </Text>
                  </Pressable>
                );
              })}

              <Pressable style={[styles.primaryBtn, isLightTheme && styles.primaryBtnLight]} onPress={saveAssignment} disabled={saving}>
                <Text style={[styles.primaryBtnText, isLightTheme && styles.primaryBtnTextLight]}>{saving ? 'Guardando...' : 'Guardar'}</Text>
              </Pressable>
            </ScrollView>
            <Pressable onPress={() => setDialogOpen(false)} style={[styles.closeBtn, isLightTheme && styles.closeBtnLight]}>
              <Text style={[styles.closeBtnText, isLightTheme && styles.closeBtnTextLight]}>Cerrar</Text>
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
  filtersScroll: { maxHeight: 44, marginBottom: 8 },
  chipsRow: { flexDirection: 'row', gap: 6 },
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
  meta: { color: '#cbd5e1', marginTop: 2, fontSize: 13 },
  metaLight: { color: '#475569' },
  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#0f172a',
  },
  badgeLight: { backgroundColor: '#f8fafc' },
  badgeText: { color: '#e2e8f0', fontSize: 11, fontWeight: '700' },
  badgeTextLight: { color: '#334155' },
  secondaryBtn: {
    marginTop: 10,
    backgroundColor: '#1e40af',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#dbeafe', fontWeight: '700' },
  secondaryBtnLight: { backgroundColor: '#1d4ed8' },
  secondaryBtnTextLight: { color: '#eff6ff' },
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
  fabLight: { backgroundColor: '#facc15' },
  fabTextLight: { color: '#422006' },
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
  groupTitle: { color: '#93c5fd', marginTop: 10, marginBottom: 4, fontWeight: '700', fontSize: 13, textTransform: 'uppercase' },
  groupTitleLight: { color: '#0369a1' },
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
  optionLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  optionActiveLight: { borderColor: '#0284c7', backgroundColor: '#e0f2fe' },
  optionText: { color: '#cbd5e1', fontWeight: '600' },
  optionTextLight: { color: '#334155' },
  optionTextActive: { color: '#bae6fd' },
  optionTextActiveLight: { color: '#0369a1' },
  primaryBtn: { marginTop: 14, backgroundColor: '#d97706', borderRadius: 8, paddingVertical: 11, alignItems: 'center' },
  primaryBtnText: { color: '#fffbeb', fontWeight: '700' },
  primaryBtnLight: { backgroundColor: '#1d4ed8' },
  primaryBtnTextLight: { color: '#eff6ff' },
  closeBtn: {
    marginTop: 12,
    alignSelf: 'flex-end',
    backgroundColor: '#1d4ed8',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  closeBtnText: { color: '#fff', fontWeight: '700' },
  closeBtnLight: { backgroundColor: '#e2e8f0' },
  closeBtnTextLight: { color: '#1e293b' },
});
