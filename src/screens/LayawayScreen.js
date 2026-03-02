import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import PaginatedList from '../components/PaginatedList';
import { usePaginatedList } from '../hooks/usePaginatedList';
import {
  addLayawayPayment,
  cancelLayaway,
  completeLayaway,
  getLayawayContracts,
  getLayawayDetail,
} from '../services/layaway.service';

const STATUS_FILTERS = ['', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED'];

export default function LayawayScreen({
  tenant,
  userProfile,
  formatMoney,
  offlineMode,
  pageSize = 20,
}) {
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detail, setDetail] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethodCode, setPayMethodCode] = useState('CASH');
  const [payRef, setPayRef] = useState('');
  const [busyAction, setBusyAction] = useState(false);

  const {
    items: contracts,
    page,
    totalPages,
    loading,
    error,
    cacheInfo,
    setError,
    filters,
    updateFilters,
    changePage,
    loadPage,
  } = usePaginatedList({
    tenantId: tenant?.tenant_id,
    pageSize,
    offlineMode,
    cacheNamespace: 'layaway-contracts',
    initialFilters: { status: '' },
    fetchPage: async ({ tenantId, page: nextPage, pageSize: nextPageSize, filters: nextFilters }) =>
      getLayawayContracts(tenantId, nextPage, nextPageSize, nextFilters?.status || null),
  });

  const openDetail = async (layawayId) => {
    setLoadingDetail(true);
    const result = await getLayawayDetail(tenant?.tenant_id, layawayId);
    if (!result.success) {
      setError(result.error || 'No fue posible cargar detalle');
      setLoadingDetail(false);
      return;
    }
    setDetail(result.data);
    setLoadingDetail(false);
  };

  const refreshDetail = async () => {
    if (!detail?.layaway_id) return;
    const refreshed = await getLayawayDetail(tenant?.tenant_id, detail.layaway_id);
    if (refreshed.success) setDetail(refreshed.data);
  };

  const handleAddPayment = async () => {
    if (offlineMode) {
      setError('Plan separe no permite pagos en modo offline.');
      return;
    }

    const amount = Number(payAmount || 0);
    if (!detail?.layaway_id || !amount || amount <= 0 || !userProfile?.user_id) {
      setError('Verifica monto y usuario para registrar el abono.');
      return;
    }

    setBusyAction(true);
    const result = await addLayawayPayment(tenant.tenant_id, detail.layaway_id, {
      payment_method_code: payMethodCode || 'CASH',
      amount,
      paid_by: userProfile.user_id,
      reference: payRef || null,
      cash_session_id: null,
    });

    if (!result.success) {
      setError(result.error || 'No fue posible registrar abono.');
    } else {
      setPayAmount('');
      setPayRef('');
      await refreshDetail();
      await loadPage(page, filters);
    }
    setBusyAction(false);
  };

  const handleComplete = async () => {
    if (!detail?.layaway_id || !userProfile?.user_id) return;
    setBusyAction(true);
    const result = await completeLayaway(tenant.tenant_id, detail.layaway_id, userProfile.user_id, null);
    if (!result.success) {
      setError(result.error || 'No fue posible completar contrato.');
    } else {
      await refreshDetail();
      await loadPage(page, filters);
    }
    setBusyAction(false);
  };

  const handleCancel = async () => {
    if (!detail?.layaway_id || !userProfile?.user_id) return;
    setBusyAction(true);
    const result = await cancelLayaway(
      tenant.tenant_id,
      detail.layaway_id,
      userProfile.user_id,
      'CANCELLED',
      null,
    );
    if (!result.success) {
      setError(result.error || 'No fue posible cancelar contrato.');
    } else {
      await refreshDetail();
      await loadPage(page, filters);
    }
    setBusyAction(false);
  };

  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll}>
        {STATUS_FILTERS.map((s) => {
          const active = (filters?.status || '') === s;
          const label = s || 'TODOS';
          return (
            <Pressable
              key={label}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => updateFilters({ status: s })}
            >
              <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <PaginatedList
        title="Plan Separe"
        loading={loading}
        error={error}
        items={contracts}
        emptyText="No hay contratos para este filtro."
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
          <Pressable key={item.layaway_id} style={styles.card} onPress={() => openDetail(item.layaway_id)}>
            <View style={styles.cardTopRow}>
              <Text style={styles.saleNumber}>{item.contract_number || item.layaway_id?.slice(0, 8)}</Text>
              <Text style={styles.status}>{item.status}</Text>
            </View>
            <Text style={styles.metaLine}>Cliente: {item.customer_name || 'Sin cliente'}</Text>
            <Text style={styles.metaLine}>Saldo: {formatMoney(item.balance || 0)}</Text>
            <Text style={styles.total}>{formatMoney(item.total || 0)}</Text>
          </Pressable>
        )}
      />

      <Modal visible={Boolean(detail) || loadingDetail} transparent animationType="slide" onRequestClose={() => setDetail(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBody}>
            {loadingDetail ? (
              <ActivityIndicator color="#4ade80" />
            ) : (
              <ScrollView>
                <Text style={styles.modalTitle}>Contrato</Text>
                <Text style={styles.metaLine}>{detail?.contract_number || detail?.layaway_id}</Text>
                <Text style={styles.metaLine}>Cliente: {detail?.customer?.full_name || '-'}</Text>
                <Text style={styles.metaLine}>Total: {formatMoney(detail?.total || 0)}</Text>
                <Text style={styles.metaLine}>Pagado: {formatMoney(detail?.paid_total || 0)}</Text>
                <Text style={styles.metaLine}>Saldo: {formatMoney(detail?.balance || 0)}</Text>
                <Text style={styles.metaLine}>Estado: {detail?.status || '-'}</Text>

                <Text style={styles.groupTitle}>Items</Text>
                {(detail?.items || []).map((line) => (
                  <View key={line.layaway_item_id} style={styles.detailRow}>
                    <Text style={styles.metaLine}>{line.variant?.product?.name || line.variant?.variant_name || '-'}</Text>
                    <Text style={styles.metaLine}>x {line.quantity}</Text>
                  </View>
                ))}

                <Text style={styles.groupTitle}>Abonos</Text>
                {(detail?.payments || []).map((payment) => (
                  <View key={payment.layaway_payment_id} style={styles.detailRow}>
                    <Text style={styles.metaLine}>{payment.payment_method_name || payment.payment_method_code || 'Pago'}</Text>
                    <Text style={styles.metaLine}>{formatMoney(payment.amount || 0)}</Text>
                  </View>
                ))}

                {detail?.status === 'ACTIVE' ? (
                  <View style={styles.actionBox}>
                    <Text style={styles.groupTitle}>Registrar abono</Text>
                    <TextInput
                      style={styles.input}
                      value={payAmount}
                      onChangeText={setPayAmount}
                      placeholder="Monto"
                      placeholderTextColor="#64748b"
                      keyboardType="numeric"
                    />
                    <TextInput
                      style={styles.input}
                      value={payMethodCode}
                      onChangeText={setPayMethodCode}
                      placeholder="Metodo (CASH, CARD, TRANSFER...)"
                      placeholderTextColor="#64748b"
                    />
                    <TextInput
                      style={styles.input}
                      value={payRef}
                      onChangeText={setPayRef}
                      placeholder="Referencia (opcional)"
                      placeholderTextColor="#64748b"
                    />
                    <Pressable style={styles.primaryBtn} onPress={handleAddPayment} disabled={busyAction}>
                      <Text style={styles.primaryBtnText}>{busyAction ? 'Procesando...' : 'Guardar abono'}</Text>
                    </Pressable>

                    <View style={styles.inlineActions}>
                      <Pressable style={styles.secondaryBtn} onPress={handleComplete} disabled={busyAction}>
                        <Text style={styles.secondaryBtnText}>Completar</Text>
                      </Pressable>
                      <Pressable style={styles.dangerBtn} onPress={handleCancel} disabled={busyAction}>
                        <Text style={styles.dangerBtnText}>Cancelar</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </ScrollView>
            )}

            <Pressable onPress={() => setDetail(null)} style={styles.closeBtn}>
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
  title: { color: '#f8fafc', fontSize: 20, fontWeight: '700', marginBottom: 10 },
  filtersScroll: { maxHeight: 40, marginBottom: 8 },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
  },
  filterChipActive: { backgroundColor: '#22c55e', borderColor: '#22c55e' },
  filterChipText: { color: '#cbd5e1', fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: '#052e16' },
  list: { flex: 1 },
  card: { backgroundColor: '#111827', borderWidth: 1, borderColor: '#1f2937', borderRadius: 12, padding: 12, marginBottom: 8 },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  saleNumber: { color: '#f8fafc', fontWeight: '700' },
  status: { color: '#86efac', fontSize: 12, fontWeight: '700' },
  metaLine: { color: '#cbd5e1', fontSize: 13, marginBottom: 2 },
  total: { color: '#34d399', fontSize: 18, fontWeight: '700', marginTop: 4 },
  empty: { color: '#94a3b8', marginTop: 14, textAlign: 'center' },
  error: { color: '#f87171', marginBottom: 8 },
  footerPagination: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8 },
  pageBtn: { backgroundColor: '#1e293b', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  pageBtnDisabled: { opacity: 0.35 },
  pageBtnText: { color: '#e2e8f0', fontWeight: '700' },
  pageText: { color: '#94a3b8' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalBody: { maxHeight: '88%', backgroundColor: '#0f172a', borderTopLeftRadius: 14, borderTopRightRadius: 14, padding: 14 },
  modalTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  groupTitle: { color: '#4ade80', marginTop: 10, marginBottom: 4, fontWeight: '700' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, borderBottomWidth: 1, borderBottomColor: '#1e293b', paddingVertical: 6 },
  actionBox: { marginTop: 8, borderWidth: 1, borderColor: '#1f2937', borderRadius: 10, padding: 10 },
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
  primaryBtn: { marginTop: 10, backgroundColor: '#16a34a', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  primaryBtnText: { color: '#ecfdf5', fontWeight: '700' },
  inlineActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  secondaryBtn: { flex: 1, backgroundColor: '#1e40af', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  secondaryBtnText: { color: '#dbeafe', fontWeight: '700' },
  dangerBtn: { flex: 1, backgroundColor: '#7f1d1d', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  dangerBtnText: { color: '#fee2e2', fontWeight: '700' },
  closeBtn: { marginTop: 12, alignSelf: 'flex-end', backgroundColor: '#1d4ed8', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  closeBtnText: { color: '#fff', fontWeight: '700' },
});
