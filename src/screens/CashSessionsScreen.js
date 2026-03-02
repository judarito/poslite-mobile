import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import PaginatedList from '../components/PaginatedList';
import { usePaginatedList } from '../hooks/usePaginatedList';
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

export default function CashSessionsScreen({
  tenant,
  userProfile,
  offlineMode,
  pageSize = 20,
  formatMoney,
}) {
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
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll}>
        <View style={styles.chipsRow}>
          {STATUS_FILTERS.map((status) => {
            const active = (filters?.status || '') === status;
            return (
              <Pressable
                key={status || 'all'}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => updateFilters({ status })}
              >
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                  {status || 'Todas'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <PaginatedList
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
          <View key={item.cash_session_id} style={styles.card}>
            <Text style={styles.title}>{item.cash_register?.name || 'Caja'} · {item.cash_register?.location?.name || ''}</Text>
            <Text style={styles.meta}>Abierta: {new Date(item.opened_at).toLocaleString()} · {item.opened_by_user?.full_name || '-'}</Text>
            <View style={styles.badgesRow}>
              <View style={[styles.badge, { borderColor: item.status === 'OPEN' ? '#16a34a' : '#64748b' }]}>
                <Text style={styles.badgeText}>{item.status}</Text>
              </View>
              <View style={[styles.badge, { borderColor: '#0ea5e9' }]}>
                <Text style={styles.badgeText}>Apertura {money(item.opening_amount || 0)}</Text>
              </View>
              {item.status === 'CLOSED' ? (
                <View style={[styles.badge, { borderColor: Number(item.difference || 0) >= 0 ? '#16a34a' : '#ef4444' }]}>
                  <Text style={styles.badgeText}>Dif {money(item.difference || 0)}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.actions}>
              <Pressable style={styles.secondaryBtn} onPress={() => openDetailModal(item)}>
                <Text style={styles.secondaryBtnText}>Detalle</Text>
              </Pressable>
              {item.status === 'OPEN' ? (
                <>
                  <Pressable style={styles.secondaryBtn} onPress={() => openMovementModal(item)}>
                    <Text style={styles.secondaryBtnText}>Movimiento</Text>
                  </Pressable>
                  <Pressable style={styles.dangerBtn} onPress={() => openCloseModal(item)}>
                    <Text style={styles.dangerBtnText}>Cerrar</Text>
                  </Pressable>
                </>
              ) : null}
            </View>
          </View>
        )}
      />

      <Pressable style={styles.fab} onPress={openSessionModal}>
        <Text style={styles.fabText}>+ Abrir Caja</Text>
      </Pressable>

      <Modal visible={openDialog} transparent animationType="slide" onRequestClose={() => setOpenDialog(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBody}>
            <ScrollView>
              <Text style={styles.modalTitle}>Abrir sesion de caja</Text>
              <Text style={styles.groupTitle}>Caja registradora</Text>
              {registers.map((r) => {
                const active = openData.cash_register_id === r.cash_register_id;
                return (
                  <Pressable
                    key={r.cash_register_id}
                    style={[styles.option, active && styles.optionActive]}
                    onPress={() => setOpenData((prev) => ({ ...prev, cash_register_id: r.cash_register_id }))}
                  >
                    <Text style={[styles.optionText, active && styles.optionTextActive]}>
                      {r.name} ({r.location?.name || 'Sin sede'})
                    </Text>
                  </Pressable>
                );
              })}

              <TextInput
                style={styles.input}
                value={openData.opening_amount}
                onChangeText={(v) => setOpenData((prev) => ({ ...prev, opening_amount: v }))}
                placeholder="Monto de apertura"
                placeholderTextColor="#64748b"
                keyboardType="numeric"
              />

              <Pressable style={styles.primaryBtn} onPress={saveOpenSession} disabled={saving}>
                <Text style={styles.primaryBtnText}>{saving ? 'Guardando...' : 'Abrir Caja'}</Text>
              </Pressable>
            </ScrollView>
            <Pressable onPress={() => setOpenDialog(false)} style={styles.closeBtn}><Text style={styles.closeBtnText}>Cerrar</Text></Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={closeDialog} transparent animationType="slide" onRequestClose={() => setCloseDialog(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBody}>
            <Text style={styles.modalTitle}>Cerrar sesion</Text>
            {closeSummary ? (
              <ScrollView>
                <View style={styles.infoCard}>
                  <Text style={styles.summaryLine}>Caja: {selectedSession?.cash_register?.name || '-'}</Text>
                  <Text style={styles.summaryLine}>Abierta: {selectedSession?.opened_at ? new Date(selectedSession.opened_at).toLocaleString() : '-'}</Text>
                  <Text style={styles.summaryLine}>Por: {selectedSession?.opened_by_user?.full_name || '-'}</Text>
                </View>

                <View style={styles.summaryCard}>
                  <Text style={styles.summaryTitle}>Resumen de Ventas</Text>
                  <Text style={styles.summaryLine}>Total ventas: {closeSummary.sales_count}</Text>
                  <Text style={styles.summaryLine}>Ingresos ventas: {money(closeSummary.sales_total || 0)}</Text>
                </View>
                {Number(closeSummary.layaway_count || 0) > 0 ? (
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryTitle}>Abonos Plan Separe</Text>
                    <Text style={styles.summaryLine}>Total abonos: {closeSummary.layaway_count}</Text>
                    <Text style={styles.summaryLine}>Ingresos abonos: {money(closeSummary.layaway_total || 0)}</Text>
                  </View>
                ) : null}

                <View style={styles.summaryCard}>
                  <Text style={styles.summaryTitle}>Pagos por Metodo</Text>
                  {(closeSummary.payments_by_method || []).length === 0 ? (
                    <Text style={styles.summaryLine}>Sin pagos</Text>
                  ) : (
                    (closeSummary.payments_by_method || []).map((pm) => (
                      <Text key={pm.code} style={styles.summaryLine}>
                        {pm.name}: {money(pm.total || 0)}
                      </Text>
                    ))
                  )}
                </View>

                <View style={styles.summaryCard}>
                  <Text style={styles.summaryTitle}>Movimientos de Caja</Text>
                  <Text style={styles.summaryLine}>Ingresos: {money(closeSummary.income_total || 0)}</Text>
                  <Text style={styles.summaryLine}>Gastos: {money(closeSummary.expense_total || 0)}</Text>
                </View>

                <View style={styles.summaryCard}>
                  <Text style={styles.summaryTitle}>Arqueo</Text>
                  <Text style={styles.summaryLine}>Apertura: {money(selectedSession?.opening_amount || 0)}</Text>
                  <Text style={styles.summaryLine}>Ventas efectivo: {money((closeSummary.cash_sales || 0) - (closeSummary.layaway_cash || 0))}</Text>
                  {Number(closeSummary.layaway_cash || 0) > 0 ? (
                    <Text style={styles.summaryLine}>Abonos separe (efectivo): {money(closeSummary.layaway_cash || 0)}</Text>
                  ) : null}
                  <Text style={styles.summaryLine}>Otros ingresos: {money(closeSummary.income_total || 0)}</Text>
                  <Text style={styles.summaryLine}>Gastos: -{money(closeSummary.expense_total || 0)}</Text>
                  <Text style={styles.summaryLine}>Efectivo esperado: {money(closeSummary.expected_cash || 0)}</Text>
                </View>

                <TextInput
                  style={styles.input}
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
                <Text style={styles.meta}>{closeDifferenceStatus}</Text>
              </ScrollView>
            ) : (
              <Text style={styles.meta}>Cargando resumen...</Text>
            )}
            <Pressable style={styles.primaryBtn} onPress={saveCloseSession} disabled={closing}>
              <Text style={styles.primaryBtnText}>{closing ? 'Cerrando...' : 'Confirmar Cierre'}</Text>
            </Pressable>
            <Pressable onPress={() => setCloseDialog(false)} style={styles.closeBtn}><Text style={styles.closeBtnText}>Cancelar</Text></Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={movementDialog} transparent animationType="slide" onRequestClose={() => setMovementDialog(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBody}>
            <Text style={styles.modalTitle}>Movimiento de caja</Text>
            <View style={styles.actions}>
              <Pressable
                style={[styles.secondaryBtn, movementData.type === 'INCOME' && styles.optionActive]}
                onPress={() => setMovementData((prev) => ({ ...prev, type: 'INCOME' }))}
              >
                <Text style={styles.secondaryBtnText}>Ingreso</Text>
              </Pressable>
              <Pressable
                style={[styles.secondaryBtn, movementData.type === 'EXPENSE' && styles.optionActive]}
                onPress={() => setMovementData((prev) => ({ ...prev, type: 'EXPENSE' }))}
              >
                <Text style={styles.secondaryBtnText}>Gasto</Text>
              </Pressable>
            </View>
            <TextInput
              style={styles.input}
              value={movementData.category}
              onChangeText={(v) => setMovementData((prev) => ({ ...prev, category: v }))}
              placeholder="Categoria"
              placeholderTextColor="#64748b"
            />
            <TextInput
              style={styles.input}
              value={movementData.amount}
              onChangeText={(v) => setMovementData((prev) => ({ ...prev, amount: v }))}
              placeholder="Monto"
              placeholderTextColor="#64748b"
              keyboardType="numeric"
            />
            <TextInput
              style={[styles.input, { minHeight: 70 }]}
              value={movementData.note}
              onChangeText={(v) => setMovementData((prev) => ({ ...prev, note: v }))}
              placeholder="Nota"
              placeholderTextColor="#64748b"
              multiline
            />
            <Pressable style={styles.primaryBtn} onPress={saveMovement} disabled={savingMovement}>
              <Text style={styles.primaryBtnText}>{savingMovement ? 'Guardando...' : 'Guardar movimiento'}</Text>
            </Pressable>
            <Pressable onPress={() => setMovementDialog(false)} style={styles.closeBtn}><Text style={styles.closeBtnText}>Cancelar</Text></Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={detailDialog} transparent animationType="slide" onRequestClose={() => setDetailDialog(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBody}>
            <Text style={styles.modalTitle}>Movimientos de sesion</Text>
            <ScrollView>
              {movementRows.length === 0 ? <Text style={styles.meta}>Sin movimientos</Text> : null}
              {movementRows.map((m) => (
                <View key={m.cash_movement_id} style={styles.card}>
                  <Text style={styles.title}>{m.type === 'INCOME' ? 'Ingreso' : 'Gasto'} · {money(m.amount || 0)}</Text>
                  <Text style={styles.meta}>{m.category || 'Sin categoria'}</Text>
                  <Text style={styles.meta}>{new Date(m.created_at).toLocaleString()}</Text>
                  {m.note ? <Text style={styles.meta}>{m.note}</Text> : null}
                </View>
              ))}
            </ScrollView>
            <Pressable onPress={() => setDetailDialog(false)} style={styles.closeBtn}><Text style={styles.closeBtnText}>Cerrar</Text></Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0f14', padding: 12 },
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
  filterChipText: { color: '#cbd5e1', fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: '#bae6fd' },
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
  actions: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  secondaryBtn: { backgroundColor: '#1e40af', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center' },
  secondaryBtnText: { color: '#dbeafe', fontWeight: '700' },
  dangerBtn: { backgroundColor: '#7f1d1d', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center' },
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
  summaryCard: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#111827',
    marginTop: 8,
  },
  summaryTitle: { color: '#bae6fd', fontWeight: '700', marginBottom: 4, fontSize: 13 },
  summaryLine: { color: '#e2e8f0', fontSize: 12, marginTop: 2 },
  differenceText: { fontSize: 14, fontWeight: '700', marginTop: 10 },
  infoCard: {
    borderWidth: 1,
    borderColor: '#1d4ed8',
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#0b2942',
    marginTop: 8,
  },
});
