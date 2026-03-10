import { useEffect, useState } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import PaginatedList from '../components/PaginatedList';
import SearchableSelectField from '../components/SearchableSelectField';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { useThemeMode } from '../lib/themeMode';
import {
  addLayawayPayment,
  cancelLayaway,
  completeLayaway,
  getLayawayContracts,
  getLayawayDetail,
} from '../services/layaway.service';
import { getPaymentMethodsForDropdown } from '../services/pos.service';

const STATUS_FILTERS = ['', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'EXPIRED'];
const STATUS_FILTER_LABELS = {
  ACTIVE: 'Activos',
  COMPLETED: 'Completados',
  CANCELLED: 'Cancelados',
  EXPIRED: 'Vencidos',
};
const STATUS_FILTER_OPTIONS = STATUS_FILTERS.filter(Boolean).map((value) => ({
  key: value,
  label: STATUS_FILTER_LABELS[value] || value,
}));

export default function LayawayScreen({
  tenant,
  userProfile,
  formatMoney,
  offlineMode,
  pageSize = 20,
}) {
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detail, setDetail] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [payMethodCode, setPayMethodCode] = useState('CASH');
  const [payRef, setPayRef] = useState('');
  const [paymentMethods, setPaymentMethods] = useState([]);
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

  useEffect(() => {
    let active = true;
    const loadPaymentMethods = async () => {
      if (!tenant?.tenant_id) return;
      const result = await getPaymentMethodsForDropdown(tenant.tenant_id, { offlineMode });
      if (!active) return;
      if (result.success) {
        const list = Array.isArray(result.data) ? result.data : [];
        setPaymentMethods(list);
        const currentExists = list.some((m) => m.code === payMethodCode);
        if (!currentExists) {
          setPayMethodCode(list[0]?.code || 'CASH');
        }
      }
    };

    loadPaymentMethods();
    return () => {
      active = false;
    };
  }, [tenant?.tenant_id, offlineMode]);

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
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={styles.filtersBlock}>
        <SearchableSelectField
          title="Estado"
          themeMode={themeMode}
          valueLabel="Todos"
          clearLabel="Todos"
          placeholder="Todos"
          searchPlaceholder="Buscar estado..."
          options={STATUS_FILTER_OPTIONS}
          selectedKey={filters?.status || ''}
          onSelect={(nextValue) => updateFilters({ status: nextValue || '' })}
        />
      </View>

      <PaginatedList
        themeMode={themeMode}
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
          <Pressable key={item.layaway_id} style={[styles.card, isLightTheme && styles.cardLight]} onPress={() => openDetail(item.layaway_id)}>
            <View style={styles.cardTopRow}>
              <Text style={[styles.saleNumber, isLightTheme && styles.saleNumberLight]}>{item.contract_number || item.layaway_id?.slice(0, 8)}</Text>
              <Text style={styles.status}>{item.status}</Text>
            </View>
            <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>Cliente: {item.customer_name || 'Sin cliente'}</Text>
            <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>Saldo: {formatMoney(item.balance || 0)}</Text>
            <Text style={styles.total}>{formatMoney(item.total || 0)}</Text>
          </Pressable>
        )}
      />

      <Modal visible={Boolean(detail) || loadingDetail} transparent animationType="slide" onRequestClose={() => setDetail(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBody, isLightTheme && styles.modalBodyLight]}>
            {loadingDetail ? (
              <ActivityIndicator color="#4ade80" />
            ) : (
              <ScrollView>
                <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>Contrato</Text>
                <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>{detail?.contract_number || detail?.layaway_id}</Text>
                <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>Cliente: {detail?.customer?.full_name || '-'}</Text>
                <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>Total: {formatMoney(detail?.total || 0)}</Text>
                <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>Pagado: {formatMoney(detail?.paid_total || 0)}</Text>
                <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>Saldo: {formatMoney(detail?.balance || 0)}</Text>
                <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>Estado: {detail?.status || '-'}</Text>

                <Text style={styles.groupTitle}>Items</Text>
                {(detail?.items || []).map((line) => (
                  <View key={line.layaway_item_id} style={styles.detailRow}>
                    <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>{line.variant?.product?.name || line.variant?.variant_name || '-'}</Text>
                    <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>x {line.quantity}</Text>
                  </View>
                ))}

                <Text style={styles.groupTitle}>Abonos</Text>
                {(detail?.payments || []).map((payment) => (
                  <View key={payment.layaway_payment_id} style={styles.detailRow}>
                    <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>{payment.payment_method_name || payment.payment_method_code || 'Pago'}</Text>
                    <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>{formatMoney(payment.amount || 0)}</Text>
                  </View>
                ))}

                {detail?.status === 'ACTIVE' ? (
                  <View style={[styles.actionBox, isLightTheme && styles.actionBoxLight]}>
                    <Text style={styles.groupTitle}>Registrar abono</Text>
                    <TextInput
                      style={[styles.input, isLightTheme && styles.inputLight]}
                      value={payAmount}
                      onChangeText={setPayAmount}
                      placeholder="Monto"
                      placeholderTextColor="#64748b"
                      keyboardType="numeric"
                    />
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.methodScroller}>
                      <View style={styles.methodRow}>
                        {(paymentMethods || []).map((m) => (
                          <Pressable
                            key={m.code}
                            style={[styles.methodBtn, payMethodCode === m.code && styles.methodBtnActive]}
                            onPress={() => setPayMethodCode(m.code)}
                          >
                            <Text style={[styles.methodBtnText, isLightTheme && styles.methodBtnTextLight]}>{m.name}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </ScrollView>
                    <TextInput
                      style={[styles.input, isLightTheme && styles.inputLight]}
                      value={payRef}
                      onChangeText={setPayRef}
                      placeholder="Referencia (opcional)"
                      placeholderTextColor="#64748b"
                    />
                    <Pressable style={styles.primaryBtn} onPress={handleAddPayment} disabled={busyAction}>
                      <View style={styles.btnContentRow}>
                        <Ionicons name={busyAction ? 'hourglass-outline' : 'wallet-outline'} size={16} color="#ecfdf5" />
                        <Text style={styles.primaryBtnText}>{busyAction ? 'Procesando...' : 'Guardar abono'}</Text>
                      </View>
                    </Pressable>

                    <View style={styles.inlineActions}>
                      <Pressable style={styles.secondaryBtn} onPress={handleComplete} disabled={busyAction}>
                        <View style={styles.btnContentRow}>
                          <Ionicons name="checkmark-circle-outline" size={16} color="#dbeafe" />
                          <Text style={styles.secondaryBtnText}>Completar</Text>
                        </View>
                      </Pressable>
                      <Pressable style={styles.dangerBtn} onPress={handleCancel} disabled={busyAction}>
                        <View style={styles.btnContentRow}>
                          <Ionicons name="close-circle-outline" size={16} color="#fee2e2" />
                          <Text style={styles.dangerBtnText}>Cancelar</Text>
                        </View>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </ScrollView>
            )}

            <Pressable onPress={() => setDetail(null)} style={styles.closeBtn}>
              <View style={styles.btnContentRow}>
                <Ionicons name="chevron-down-circle-outline" size={16} color="#fff" />
                <Text style={styles.closeBtnText}>Cerrar</Text>
              </View>
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
  title: { color: '#f8fafc', fontSize: 20, fontWeight: '700', marginBottom: 10 },
  filtersBlock: { marginBottom: 8 },
  filtersScroll: { maxHeight: 40, marginBottom: 8 },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
  },
  filterChipLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  filterChipActive: { backgroundColor: '#235ea9', borderColor: '#235ea9' },
  filterChipText: { color: '#cbd5e1', fontSize: 12, fontWeight: '600' },
  filterChipTextLight: { color: '#334155' },
  filterChipTextActive: { color: '#eff6ff' },
  list: { flex: 1 },
  card: { backgroundColor: '#111827', borderWidth: 1, borderColor: '#1f2937', borderRadius: 12, padding: 12, marginBottom: 8 },
  cardLight: { backgroundColor: '#ffffff', borderColor: '#dbe4ef' },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  saleNumber: { color: '#f8fafc', fontWeight: '700' },
  saleNumberLight: { color: '#0f172a' },
  status: { color: '#86efac', fontSize: 12, fontWeight: '700' },
  metaLine: { color: '#cbd5e1', fontSize: 13, marginBottom: 2 },
  metaLineLight: { color: '#475569' },
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
  modalBodyLight: { backgroundColor: '#f8fafc' },
  modalTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  modalTitleLight: { color: '#0f172a' },
  groupTitle: { color: '#4ade80', marginTop: 10, marginBottom: 4, fontWeight: '700' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, borderBottomWidth: 1, borderBottomColor: '#1e293b', paddingVertical: 6 },
  actionBox: { marginTop: 8, borderWidth: 1, borderColor: '#1f2937', borderRadius: 10, padding: 10 },
  actionBoxLight: { borderColor: '#dbe4ef', backgroundColor: '#ffffff' },
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
  btnContentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  methodScroller: { marginTop: 8, marginBottom: 2 },
  methodRow: { flexDirection: 'row', gap: 6 },
  methodBtn: {
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#0f172a',
  },
  methodBtnActive: {
    backgroundColor: '#235ea9',
    borderColor: '#235ea9',
  },
  methodBtnText: { color: '#f8fafc', fontSize: 12 },
  methodBtnTextLight: { color: '#334155' },
  primaryBtn: { marginTop: 10, backgroundColor: '#57d65a', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  primaryBtnText: { color: '#062915', fontWeight: '700' },
  inlineActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  secondaryBtn: { flex: 1, backgroundColor: '#235ea9', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  secondaryBtnText: { color: '#dbeafe', fontWeight: '700' },
  dangerBtn: { flex: 1, backgroundColor: '#7f1d1d', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  dangerBtnText: { color: '#fee2e2', fontWeight: '700' },
  closeBtn: { marginTop: 12, alignSelf: 'flex-end', backgroundColor: '#235ea9', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  closeBtnText: { color: '#fff', fontWeight: '700' },
});
