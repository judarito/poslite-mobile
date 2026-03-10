import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import PaginatedList from '../components/PaginatedList';
import SearchableSelectField from '../components/SearchableSelectField';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { useThemeMode } from '../lib/themeMode';
import {
  closeCashSession,
  createCashMovement,
  getCashSessionCloseSummary,
  listActiveCashRegisters,
  listCashMovements,
  listCashSessions,
  openCashSession,
} from '../services/cashMenu.service';

const STATUS_FILTERS = ['', 'OPEN', 'CLOSED', 'FORCE_CLOSED'];
const STATUS_FILTER_LABELS = {
  OPEN: 'Abiertas',
  CLOSED: 'Cerradas',
  FORCE_CLOSED: 'Cierre forzado',
};

export default function CashSessionsScreen({
  tenant,
  userProfile,
  offlineMode,
  pageSize = 20,
  formatMoney,
}) {
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';
  const [registers, setRegisters] = useState([]);
  const [openDialog, setOpenDialog] = useState(false);
  const [closeDialog, setCloseDialog] = useState(false);
  const [movementDialog, setMovementDialog] = useState(false);
  const [detailDialog, setDetailDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [savingMovement, setSavingMovement] = useState(false);
  const [selectedSession, setSelectedSession] = useState(null);
  const [movementRows, setMovementRows] = useState([]);
  const [closeSummary, setCloseSummary] = useState(null);
  const registerSelectOptions = useMemo(
    () =>
      (registers || []).map((r) => ({
        key: r.cash_register_id,
        label: `${r.name} (${r.location?.name || 'Sin sede'})`,
        searchText: `${r.name} ${r.location?.name || ''}`,
      })),
    [registers],
  );

  const [openData, setOpenData] = useState({ cash_register_id: null, opening_amount: '0' });
  const [closeData, setCloseData] = useState({ counted: '' });
  const [movementData, setMovementData] = useState({ type: 'INCOME', category: '', amount: '', note: '' });

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
    cacheNamespace: 'cash-sessions',
    initialFilters: { status: '' },
    fetchPage: async ({ page: nextPage, pageSize: nextPageSize, filters: nextFilters, tenantId }) => {
      const offset = (nextPage - 1) * nextPageSize;
      return listCashSessions({
        tenantId,
        status: nextFilters?.status || null,
        limit: nextPageSize,
        offset,
      });
    },
  });

  useEffect(() => {
    const load = async () => {
      if (!tenant?.tenant_id) return;
      const result = await listActiveCashRegisters(tenant.tenant_id);
      if (result.success) setRegisters(result.data || []);
    };
    load();
  }, [tenant?.tenant_id]);

  const money =
    formatMoney ||
    ((value) => `$ ${Math.round(Number(value || 0)).toLocaleString('es-CO')}`);

  const openSessionModal = () => {
    setOpenData({ cash_register_id: null, opening_amount: '0' });
    setOpenDialog(true);
  };

  const saveOpenSession = async () => {
    if (offlineMode) {
      setError('Sesiones de caja no permite escritura en modo offline.');
      return;
    }
    if (!openData.cash_register_id) {
      setError('Selecciona una caja registradora.');
      return;
    }

    setSaving(true);
    const result = await openCashSession({
      tenantId: tenant?.tenant_id,
      cashRegisterId: openData.cash_register_id,
      userId: userProfile?.user_id,
      openingAmount: Number(openData.opening_amount || 0),
    });

    if (!result.success) {
      setError(result.error || 'No fue posible abrir sesion');
      setSaving(false);
      return;
    }

    setOpenDialog(false);
    await loadPage(page, filters);
    setSaving(false);
  };

  const openCloseModal = async (session) => {
    setSelectedSession(session);
    setCloseData({ counted: '' });
    setCloseSummary(null);

    const summary = await getCashSessionCloseSummary({
      tenantId: tenant?.tenant_id,
      sessionId: session.cash_session_id,
    });
    if (summary.success) {
      setCloseSummary(summary.data);
    } else {
      setError(summary.error || 'No fue posible cargar resumen de cierre');
    }

    setCloseDialog(true);
  };

  const saveCloseSession = async () => {
    if (offlineMode) {
      setError('No puedes cerrar cajas en modo offline.');
      return;
    }

    const counted = Number(closeData.counted || 0);
    if (!counted && counted !== 0) {
      setError('Ingresa efectivo contado.');
      return;
    }

    setClosing(true);
    const result = await closeCashSession({
      tenantId: tenant?.tenant_id,
      sessionId: selectedSession?.cash_session_id,
      userId: userProfile?.user_id,
      closingAmountCounted: counted,
    });

    if (!result.success) {
      setError(result.error || 'No fue posible cerrar sesion');
      setClosing(false);
      return;
    }

    setCloseDialog(false);
    await loadPage(page, filters);
    setClosing(false);
  };

  const closeDifference =
    closeData?.counted === '' || !closeSummary
      ? 0
      : Number(closeData.counted || 0) - Number(closeSummary.expected_cash || 0);
  const closeDifferenceStatus =
    closeDifference === 0 ? 'Cuadra perfecto' : closeDifference > 0 ? 'Sobrante en caja' : 'Faltante en caja';

  const openMovementModal = (session) => {
    setSelectedSession(session);
    setMovementData({ type: 'INCOME', category: '', amount: '', note: '' });
    setMovementDialog(true);
  };

  const saveMovement = async () => {
    if (offlineMode) {
      setError('Movimientos de caja no permite escritura en modo offline.');
      return;
    }

    const amount = Number(movementData.amount || 0);
    if (!amount || amount <= 0) {
      setError('Monto debe ser mayor a cero.');
      return;
    }

    setSavingMovement(true);
    const result = await createCashMovement({
      tenantId: tenant?.tenant_id,
      sessionId: selectedSession?.cash_session_id,
      type: movementData.type,
      category: movementData.category,
      amount,
      note: movementData.note,
      userId: userProfile?.user_id,
    });

    if (!result.success) {
      setError(result.error || 'No fue posible registrar movimiento');
      setSavingMovement(false);
      return;
    }

    setMovementDialog(false);
    await loadPage(page, filters);
    setSavingMovement(false);
  };

  const openDetailModal = async (session) => {
    setSelectedSession(session);
    const result = await listCashMovements({
      tenantId: tenant?.tenant_id,
      sessionId: session.cash_session_id,
      limit: 50,
      offset: 0,
    });
    if (result.success) setMovementRows(result.data || []);
    else setMovementRows([]);
    setDetailDialog(true);
  };

  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={styles.filtersBlock}>
        <SearchableSelectField
          title="Estado"
          themeMode={themeMode}
          valueLabel="Todas"
          clearLabel="Todas"
          placeholder="Todas"
          searchPlaceholder="Buscar estado..."
          options={STATUS_FILTERS.filter(Boolean).map((status) => ({
            key: status,
            label: STATUS_FILTER_LABELS[status] || status,
          }))}
          selectedKey={filters?.status || ''}
          onSelect={(nextValue) => updateFilters({ status: nextValue || '' })}
        />
      </View>

      <PaginatedList
        themeMode={themeMode}
        title="Sesiones de Caja"
        loading={loading}
        error={error}
        items={items}
        emptyText="No hay sesiones de caja."
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
          <View key={item.cash_session_id} style={[styles.card, isLightTheme && styles.cardLight]}>
            <Text style={[styles.title, isLightTheme && styles.titleLight]}>{item.cash_register?.name || 'Caja'} · {item.cash_register?.location?.name || ''}</Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>Abierta: {new Date(item.opened_at).toLocaleString()} · {item.opened_by_user?.full_name || '-'}</Text>
            <View style={styles.badgesRow}>
              <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: item.status === 'OPEN' ? '#16a34a' : '#64748b' }]}>
                <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>{item.status}</Text>
              </View>
              <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: '#235ea9' }]}>
                <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>Apertura {money(item.opening_amount || 0)}</Text>
              </View>
              {item.status === 'CLOSED' ? (
                <View style={[styles.badge, isLightTheme && styles.badgeLight, { borderColor: Number(item.difference || 0) >= 0 ? '#16a34a' : '#ef4444' }]}>
                  <Text style={[styles.badgeText, isLightTheme && styles.badgeTextLight]}>Dif {money(item.difference || 0)}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.actions}>
              <Pressable style={[styles.secondaryBtn, isLightTheme && styles.secondaryBtnLight]} onPress={() => openDetailModal(item)}>
                <Text style={[styles.secondaryBtnText, isLightTheme && styles.secondaryBtnTextLight]}>Detalle</Text>
              </Pressable>
              {item.status === 'OPEN' ? (
                <>
                  <Pressable style={[styles.secondaryBtn, isLightTheme && styles.secondaryBtnLight]} onPress={() => openMovementModal(item)}>
                    <Text style={[styles.secondaryBtnText, isLightTheme && styles.secondaryBtnTextLight]}>Movimiento</Text>
                  </Pressable>
                  <Pressable style={[styles.dangerBtn, isLightTheme && styles.dangerBtnLight]} onPress={() => openCloseModal(item)}>
                    <Text style={[styles.dangerBtnText, isLightTheme && styles.dangerBtnTextLight]}>Cerrar</Text>
                  </Pressable>
                </>
              ) : null}
            </View>
          </View>
        )}
      />

      <Pressable style={[styles.fab, isLightTheme && styles.fabLight]} onPress={openSessionModal}>
        <Text style={[styles.fabText, isLightTheme && styles.fabTextLight]}>+ Abrir Caja</Text>
      </Pressable>

      <Modal visible={openDialog} transparent animationType="slide" onRequestClose={() => setOpenDialog(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBody, isLightTheme && styles.modalBodyLight]}>
            <ScrollView>
              <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>Abrir sesion de caja</Text>
              <SearchableSelectField
                title="Caja registradora"
                themeMode={themeMode}
                valueLabel="Seleccionar caja"
                clearLabel="Sin caja"
                placeholder="Seleccionar caja"
                searchPlaceholder="Buscar caja..."
                options={registerSelectOptions}
                selectedKey={openData.cash_register_id}
                onSelect={(nextValue) => setOpenData((prev) => ({ ...prev, cash_register_id: nextValue }))}
              />

              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={openData.opening_amount}
                onChangeText={(v) => setOpenData((prev) => ({ ...prev, opening_amount: v }))}
                placeholder="Monto de apertura"
                placeholderTextColor="#64748b"
                keyboardType="numeric"
              />

              <Pressable style={[styles.primaryBtn, isLightTheme && styles.primaryBtnLight]} onPress={saveOpenSession} disabled={saving}>
                <Text style={[styles.primaryBtnText, isLightTheme && styles.primaryBtnTextLight]}>{saving ? 'Guardando...' : 'Abrir Caja'}</Text>
              </Pressable>
            </ScrollView>
            <Pressable onPress={() => setOpenDialog(false)} style={[styles.closeBtn, isLightTheme && styles.closeBtnLight]}><Text style={[styles.closeBtnText, isLightTheme && styles.closeBtnTextLight]}>Cerrar</Text></Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={closeDialog} transparent animationType="slide" onRequestClose={() => setCloseDialog(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBody, isLightTheme && styles.modalBodyLight]}>
            <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>Cerrar sesion</Text>
            {closeSummary ? (
              <ScrollView>
                <View style={[styles.infoCard, isLightTheme && styles.infoCardLight]}>
                  <Text style={[styles.summaryLine, isLightTheme && styles.summaryLineLight]}>Caja: {selectedSession?.cash_register?.name || '-'}</Text>
                  <Text style={[styles.summaryLine, isLightTheme && styles.summaryLineLight]}>Abierta: {selectedSession?.opened_at ? new Date(selectedSession.opened_at).toLocaleString() : '-'}</Text>
                  <Text style={[styles.summaryLine, isLightTheme && styles.summaryLineLight]}>Por: {selectedSession?.opened_by_user?.full_name || '-'}</Text>
                </View>

                <View style={[styles.summaryCard, isLightTheme && styles.summaryCardLight]}>
                  <Text style={[styles.summaryTitle, isLightTheme && styles.summaryTitleLight]}>Resumen de Ventas</Text>
                  <Text style={[styles.summaryLine, isLightTheme && styles.summaryLineLight]}>Total ventas: {closeSummary.sales_count}</Text>
                  <Text style={[styles.summaryLine, isLightTheme && styles.summaryLineLight]}>Ingresos ventas: {money(closeSummary.sales_total || 0)}</Text>
                </View>
                {Number(closeSummary.layaway_count || 0) > 0 ? (
                  <View style={[styles.summaryCard, isLightTheme && styles.summaryCardLight]}>
                    <Text style={[styles.summaryTitle, isLightTheme && styles.summaryTitleLight]}>Abonos Plan Separe</Text>
                    <Text style={[styles.summaryLine, isLightTheme && styles.summaryLineLight]}>Total abonos: {closeSummary.layaway_count}</Text>
                    <Text style={[styles.summaryLine, isLightTheme && styles.summaryLineLight]}>Ingresos abonos: {money(closeSummary.layaway_total || 0)}</Text>
                  </View>
                ) : null}

                <View style={[styles.summaryCard, isLightTheme && styles.summaryCardLight]}>
                  <Text style={[styles.summaryTitle, isLightTheme && styles.summaryTitleLight]}>Pagos por Metodo</Text>
                  {(closeSummary.payments_by_method || []).length === 0 ? (
                    <Text style={[styles.summaryLine, isLightTheme && styles.summaryLineLight]}>Sin pagos</Text>
                  ) : (
                    (closeSummary.payments_by_method || []).map((pm) => (
                      <Text key={pm.code} style={[styles.summaryLine, isLightTheme && styles.summaryLineLight]}>
                        {pm.name}: {money(pm.total || 0)}
                      </Text>
                    ))
                  )}
                </View>

                <View style={[styles.summaryCard, isLightTheme && styles.summaryCardLight]}>
                  <Text style={[styles.summaryTitle, isLightTheme && styles.summaryTitleLight]}>Movimientos de Caja</Text>
                  <Text style={[styles.summaryLine, isLightTheme && styles.summaryLineLight]}>Ingresos: {money(closeSummary.income_total || 0)}</Text>
                  <Text style={[styles.summaryLine, isLightTheme && styles.summaryLineLight]}>Gastos: {money(closeSummary.expense_total || 0)}</Text>
                </View>

                <View style={[styles.summaryCard, isLightTheme && styles.summaryCardLight]}>
                  <Text style={[styles.summaryTitle, isLightTheme && styles.summaryTitleLight]}>Arqueo</Text>
                  <Text style={[styles.summaryLine, isLightTheme && styles.summaryLineLight]}>Apertura: {money(selectedSession?.opening_amount || 0)}</Text>
                  <Text style={[styles.summaryLine, isLightTheme && styles.summaryLineLight]}>Ventas efectivo: {money((closeSummary.cash_sales || 0) - (closeSummary.layaway_cash || 0))}</Text>
                  {Number(closeSummary.layaway_cash || 0) > 0 ? (
                    <Text style={[styles.summaryLine, isLightTheme && styles.summaryLineLight]}>Abonos separe (efectivo): {money(closeSummary.layaway_cash || 0)}</Text>
                  ) : null}
                  <Text style={[styles.summaryLine, isLightTheme && styles.summaryLineLight]}>Otros ingresos: {money(closeSummary.income_total || 0)}</Text>
                  <Text style={[styles.summaryLine, isLightTheme && styles.summaryLineLight]}>Gastos: -{money(closeSummary.expense_total || 0)}</Text>
                  <Text style={[styles.summaryLine, isLightTheme && styles.summaryLineLight]}>Efectivo esperado: {money(closeSummary.expected_cash || 0)}</Text>
                </View>

                <TextInput
                  style={[styles.input, isLightTheme && styles.inputLight]}
                  value={closeData.counted}
                  onChangeText={(v) => setCloseData({ counted: v })}
                  placeholder="Efectivo contado"
                  placeholderTextColor="#64748b"
                  keyboardType="numeric"
                />
                <Text
                  style={[
                    styles.differenceText,
                    closeDifference === 0
                      ? { color: '#16a34a' }
                      : closeDifference > 0
                        ? { color: '#f59e0b' }
                        : { color: '#ef4444' },
                  ]}
                >
                  Diferencia: {money(closeDifference)}
                </Text>
                <Text style={[styles.meta, isLightTheme && styles.metaLight]}>{closeDifferenceStatus}</Text>
              </ScrollView>
            ) : (
              <Text style={[styles.meta, isLightTheme && styles.metaLight]}>Cargando resumen...</Text>
            )}
            <Pressable style={[styles.primaryBtn, isLightTheme && styles.primaryBtnLight]} onPress={saveCloseSession} disabled={closing}>
              <Text style={[styles.primaryBtnText, isLightTheme && styles.primaryBtnTextLight]}>{closing ? 'Cerrando...' : 'Confirmar Cierre'}</Text>
            </Pressable>
            <Pressable onPress={() => setCloseDialog(false)} style={[styles.closeBtn, isLightTheme && styles.closeBtnLight]}><Text style={[styles.closeBtnText, isLightTheme && styles.closeBtnTextLight]}>Cancelar</Text></Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={movementDialog} transparent animationType="slide" onRequestClose={() => setMovementDialog(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBody, isLightTheme && styles.modalBodyLight]}>
            <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>Movimiento de caja</Text>
            <View style={styles.actions}>
              <Pressable
                style={[
                  styles.secondaryBtn,
                  isLightTheme && styles.secondaryBtnLight,
                  movementData.type === 'INCOME' && styles.optionActive,
                  movementData.type === 'INCOME' && isLightTheme && styles.optionActiveLight,
                ]}
                onPress={() => setMovementData((prev) => ({ ...prev, type: 'INCOME' }))}
              >
                <Text style={[styles.secondaryBtnText, isLightTheme && styles.secondaryBtnTextLight]}>Ingreso</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.secondaryBtn,
                  isLightTheme && styles.secondaryBtnLight,
                  movementData.type === 'EXPENSE' && styles.optionActive,
                  movementData.type === 'EXPENSE' && isLightTheme && styles.optionActiveLight,
                ]}
                onPress={() => setMovementData((prev) => ({ ...prev, type: 'EXPENSE' }))}
              >
                <Text style={[styles.secondaryBtnText, isLightTheme && styles.secondaryBtnTextLight]}>Gasto</Text>
              </Pressable>
            </View>
            <TextInput
              style={[styles.input, isLightTheme && styles.inputLight]}
              value={movementData.category}
              onChangeText={(v) => setMovementData((prev) => ({ ...prev, category: v }))}
              placeholder="Categoria"
              placeholderTextColor="#64748b"
            />
            <TextInput
              style={[styles.input, isLightTheme && styles.inputLight]}
              value={movementData.amount}
              onChangeText={(v) => setMovementData((prev) => ({ ...prev, amount: v }))}
              placeholder="Monto"
              placeholderTextColor="#64748b"
              keyboardType="numeric"
            />
            <TextInput
              style={[styles.input, isLightTheme && styles.inputLight, { minHeight: 70 }]}
              value={movementData.note}
              onChangeText={(v) => setMovementData((prev) => ({ ...prev, note: v }))}
              placeholder="Nota"
              placeholderTextColor="#64748b"
              multiline
            />
            <Pressable style={[styles.primaryBtn, isLightTheme && styles.primaryBtnLight]} onPress={saveMovement} disabled={savingMovement}>
              <Text style={[styles.primaryBtnText, isLightTheme && styles.primaryBtnTextLight]}>{savingMovement ? 'Guardando...' : 'Guardar movimiento'}</Text>
            </Pressable>
            <Pressable onPress={() => setMovementDialog(false)} style={[styles.closeBtn, isLightTheme && styles.closeBtnLight]}><Text style={[styles.closeBtnText, isLightTheme && styles.closeBtnTextLight]}>Cancelar</Text></Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={detailDialog} transparent animationType="slide" onRequestClose={() => setDetailDialog(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBody, isLightTheme && styles.modalBodyLight]}>
            <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>Movimientos de sesion</Text>
            <ScrollView>
              {movementRows.length === 0 ? <Text style={[styles.meta, isLightTheme && styles.metaLight]}>Sin movimientos</Text> : null}
              {movementRows.map((m) => (
                <View key={m.cash_movement_id} style={[styles.card, isLightTheme && styles.cardLight]}>
                  <Text style={[styles.title, isLightTheme && styles.titleLight]}>{m.type === 'INCOME' ? 'Ingreso' : 'Gasto'} · {money(m.amount || 0)}</Text>
                  <Text style={[styles.meta, isLightTheme && styles.metaLight]}>{m.category || 'Sin categoria'}</Text>
                  <Text style={[styles.meta, isLightTheme && styles.metaLight]}>{new Date(m.created_at).toLocaleString()}</Text>
                  {m.note ? <Text style={[styles.meta, isLightTheme && styles.metaLight]}>{m.note}</Text> : null}
                </View>
              ))}
            </ScrollView>
            <Pressable onPress={() => setDetailDialog(false)} style={[styles.closeBtn, isLightTheme && styles.closeBtnLight]}><Text style={[styles.closeBtnText, isLightTheme && styles.closeBtnTextLight]}>Cerrar</Text></Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060b16', padding: 12 },
  containerLight: { backgroundColor: '#edf2fb' },
  filtersBlock: { marginBottom: 8 },
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
  filterChipActive: { borderColor: '#235ea9', backgroundColor: '#235ea9' },
  filterChipLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  filterChipActiveLight: { borderColor: '#235ea9', backgroundColor: '#e6f0ff' },
  filterChipText: { color: '#cbd5e1', fontSize: 12, fontWeight: '600' },
  filterChipTextLight: { color: '#334155' },
  filterChipTextActive: { color: '#eff6ff' },
  filterChipTextActiveLight: { color: '#235ea9' },
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
  actions: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  secondaryBtn: { backgroundColor: '#235ea9', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center' },
  secondaryBtnText: { color: '#dbeafe', fontWeight: '700' },
  secondaryBtnLight: { backgroundColor: '#235ea9' },
  secondaryBtnTextLight: { color: '#eff6ff' },
  dangerBtn: { backgroundColor: '#7f1d1d', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center' },
  dangerBtnText: { color: '#fee2e2', fontWeight: '700' },
  dangerBtnLight: { backgroundColor: '#dc2626' },
  dangerBtnTextLight: { color: '#fff1f2' },
  fab: {
    backgroundColor: '#57d65a',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  fabText: { color: '#062915', fontWeight: '800' },
  fabLight: { backgroundColor: '#57d65a' },
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
  groupTitle: { color: '#93c5fd', marginTop: 10, marginBottom: 4, fontWeight: '700', fontSize: 13, textTransform: 'uppercase' },
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
  primaryBtnText: { color: '#062915', fontWeight: '700' },
  primaryBtnLight: { backgroundColor: '#57d65a' },
  primaryBtnTextLight: { color: '#062915' },
  closeBtn: {
    marginTop: 12,
    alignSelf: 'flex-end',
    backgroundColor: '#235ea9',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  closeBtnText: { color: '#fff', fontWeight: '700' },
  closeBtnLight: { backgroundColor: '#e2e8f0' },
  closeBtnTextLight: { color: '#1e293b' },
  summaryCard: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#111827',
    marginTop: 8,
  },
  summaryCardLight: { borderColor: '#dbe4ef', backgroundColor: '#f8fafc' },
  summaryTitle: { color: '#eff6ff', fontWeight: '700', marginBottom: 4, fontSize: 13 },
  summaryTitleLight: { color: '#235ea9' },
  summaryLine: { color: '#e2e8f0', fontSize: 12, marginTop: 2 },
  summaryLineLight: { color: '#334155' },
  differenceText: { fontSize: 14, fontWeight: '700', marginTop: 10 },
  infoCard: {
    borderWidth: 1,
    borderColor: '#235ea9',
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#235ea9',
    marginTop: 8,
  },
  infoCardLight: { borderColor: '#93c5fd', backgroundColor: '#eff6ff' },
});
