import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import PaginatedList from '../components/PaginatedList';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { listLocations } from '../services/inventoryCatalog.service';
import { getPaymentMethodsForDropdown } from '../services/pos.service';
import {
  createReturn,
  getCompletedReturnQtyByLineIds,
  getSaleById,
  getSales,
  voidSale,
} from '../services/sales.service';

const STATUS_FILTERS = ['', 'COMPLETED', 'VOIDED', 'PARTIAL_RETURN'];
const DATE_FILTERS = [
  { key: 'all', label: 'Todo', days: 0 },
  { key: 'today', label: 'Hoy', days: 1 },
  { key: '7d', label: '7 dias', days: 7 },
  { key: '30d', label: '30 dias', days: 30 },
];

function toStartOfDayIso(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function toEndOfDayIso(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

function resolveDateRangeByDays(days) {
  if (!days) return { from_date: '', to_date: '' };
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - (days - 1));
  return {
    from_date: toStartOfDayIso(from),
    to_date: toEndOfDayIso(now),
  };
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function buildSaleTicketText(sale, currencyFormatter) {
  const lines = (sale?.sale_lines || []).map((line) => {
    const name = line.variant?.product?.name || line.variant?.variant_name || 'Producto';
    return `- ${name} x${line.quantity}: ${currencyFormatter(line.line_total || 0)}`;
  });

  const payments = (sale?.sale_payments || []).map((p) => {
    const method = p.payment_method?.name || 'Pago';
    return `- ${method}: ${currencyFormatter(p.amount || 0)}`;
  });

  return [
    `POSLite · Venta ${sale?.sale_number || '-'}`,
    `Fecha: ${sale?.sold_at ? new Date(sale.sold_at).toLocaleString() : '-'}`,
    `Cliente: ${sale?.customer?.full_name || 'Consumidor final'}`,
    '',
    'Productos:',
    ...(lines.length ? lines : ['- Sin lineas']),
    '',
    `Total: ${currencyFormatter(sale?.total || 0)}`,
    '',
    'Pagos:',
    ...(payments.length ? payments : ['- Sin pagos']),
  ].join('\n');
}

export default function SalesHistoryScreen({
  tenant,
  userProfile,
  formatMoney,
  offlineMode,
  pageSize = 20,
}) {
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [detail, setDetail] = useState(null);

  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [returnSale, setReturnSale] = useState(null);
  const [returnReason, setReturnReason] = useState('');
  const [returnRefunds, setReturnRefunds] = useState([{ payment_method_id: null, amount: '0', reference: '' }]);
  const [paymentMethods, setPaymentMethods] = useState([]);

  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [saleToVoid, setSaleToVoid] = useState(null);
  const [locations, setLocations] = useState([]);

  const {
    items: sales,
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
    cacheNamespace: 'sales-history',
    initialFilters: { status: '', location_id: '', from_date: '', to_date: '' },
    fetchPage: async ({ tenantId, page: nextPage, pageSize: nextPageSize, filters: nextFilters }) =>
      getSales(tenantId, nextPage, nextPageSize, {
        status: nextFilters?.status || null,
        location_id: nextFilters?.location_id || null,
        from_date: nextFilters?.from_date || null,
        to_date: nextFilters?.to_date || null,
      }),
  });

  useEffect(() => {
    const load = async () => {
      if (!tenant?.tenant_id) return;
      const result = await listLocations(tenant.tenant_id);
      if (result.success) setLocations(result.data || []);
    };
    load();
  }, [tenant?.tenant_id]);

  const activeDateFilterKey = (() => {
    const { from_date: fromDate, to_date: toDate } = filters || {};
    if (!fromDate || !toDate) return 'all';
    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 'all';
    const diffMs = to.getTime() - from.getTime();
    const days = Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;
    if (days <= 1) return 'today';
    if (days <= 7) return '7d';
    if (days <= 30) return '30d';
    return 'all';
  })();

  const openDetail = async (saleId) => {
    if (!saleId || !tenant?.tenant_id) return;
    setLoadingDetail(true);
    const result = await getSaleById(tenant.tenant_id, saleId);
    if (!result.success) {
      setError(result.error || 'No fue posible cargar el detalle');
      setLoadingDetail(false);
      return;
    }
    setDetail(result.data);
    setLoadingDetail(false);
  };

  const getLineMaxReturnQty = (line) => {
    const sold = Number(line.quantity) || 0;
    const returned = Number(line.returned_qty) || 0;
    return Math.max(0, sold - returned);
  };

  const getSelectedReturnLines = () => {
    if (!returnSale?.sale_lines) return [];

    return returnSale.sale_lines
      .filter((line) => line.selected && Number(line.return_qty) > 0)
      .map((line) => ({
        sale_line_id: line.sale_line_id,
        qty: Number(line.return_qty),
      }));
  };

  const getExpectedRefundTotal = () => {
    if (!returnSale?.sale_lines) return 0;

    return round2(
      returnSale.sale_lines
        .filter((line) => line.selected && Number(line.return_qty) > 0)
        .reduce((sum, line) => {
          const qty = Number(line.quantity) || 0;
          if (qty <= 0) return sum;
          const perUnit = (Number(line.line_total) || 0) / qty;
          return sum + perUnit * (Number(line.return_qty) || 0);
        }, 0),
    );
  };

  const getRefundsTotal = () => {
    return round2(
      returnRefunds.reduce((sum, refund) => sum + (Number(refund.amount) || 0), 0),
    );
  };

  const distributeRefundsEqually = () => {
    const expected = getExpectedRefundTotal();
    const count = returnRefunds.length;
    if (count <= 0) return;

    const base = round2(expected / count);
    let assigned = 0;
    const next = returnRefunds.map((refund, i) => {
      const amount = i === count - 1 ? round2(expected - assigned) : base;
      assigned += amount;
      return { ...refund, amount: String(amount) };
    });
    setReturnRefunds(next);
  };

  const handlePrintSale = async (sale) => {
    if (!sale?.sale_id || !tenant?.tenant_id) return;

    let fullSale = sale;
    if (!sale.sale_lines || !sale.sale_payments) {
      const result = await getSaleById(tenant.tenant_id, sale.sale_id);
      if (!result.success) {
        setError(result.error || 'No fue posible cargar venta para imprimir');
        return;
      }
      fullSale = result.data;
    }

    const ticketText = buildSaleTicketText(fullSale, formatMoney);
    await Share.share({
      title: `Venta ${fullSale.sale_number || ''}`,
      message: ticketText,
    });
  };

  const openReturnDialog = async (sale) => {
    if (!sale?.sale_id || !tenant?.tenant_id) return;

    const saleResult = await getSaleById(tenant.tenant_id, sale.sale_id);
    if (!saleResult.success) {
      setError(saleResult.error || 'No fue posible cargar venta');
      return;
    }

    const saleData = saleResult.data;
    const lineIds = (saleData.sale_lines || []).map((line) => line.sale_line_id);
    const returnedResult = await getCompletedReturnQtyByLineIds(lineIds);

    if (!returnedResult.success) {
      setError(returnedResult.error || 'No fue posible validar devoluciones previas');
      return;
    }

    (saleData.sale_lines || []).forEach((line) => {
      line.returned_qty = returnedResult.data[line.sale_line_id] || 0;
      line.selected = false;
      line.return_qty = getLineMaxReturnQty(line);
    });

    const paymentResult = await getPaymentMethodsForDropdown(tenant.tenant_id);
    const allowedMethods = paymentResult.success
      ? (paymentResult.data || []).filter((p) => p.code !== 'CREDITO')
      : [];

    setPaymentMethods(allowedMethods);
    setReturnRefunds([
      {
        payment_method_id: allowedMethods[0]?.payment_method_id || null,
        amount: '0',
        reference: '',
      },
    ]);
    setReturnReason('');
    setReturnSale(saleData);
    setReturnDialogOpen(true);
  };

  const processReturn = async () => {
    if (!returnSale || !tenant?.tenant_id || !userProfile?.user_id) return;
    if (offlineMode) {
      setError('No puedes procesar devoluciones en modo offline.');
      return;
    }

    const reason = returnReason.trim();
    if (!reason) {
      setError('El motivo de devolución es obligatorio.');
      return;
    }

    const lines = getSelectedReturnLines();
    if (lines.length === 0) {
      setError('Seleccione al menos un producto.');
      return;
    }

    const invalidQty = lines.find((line) => {
      const sourceLine = returnSale.sale_lines.find((s) => s.sale_line_id === line.sale_line_id);
      return !sourceLine || line.qty > getLineMaxReturnQty(sourceLine);
    });
    if (invalidQty) {
      setError('Una o mas cantidades superan el saldo pendiente por devolver.');
      return;
    }

    const expectedRefund = getExpectedRefundTotal();
    if (expectedRefund <= 0) {
      setError('El total de devolución debe ser mayor que 0.');
      return;
    }

    const refunds = returnRefunds
      .filter((r) => r.payment_method_id && Number(r.amount) > 0)
      .map((r) => ({
        payment_method_id: r.payment_method_id,
        amount: round2(r.amount),
        reference: (r.reference || '').trim() || null,
      }));

    if (refunds.length === 0) {
      setError('Registra al menos un método de reembolso.');
      return;
    }

    const refundsTotal = round2(refunds.reduce((sum, r) => sum + Number(r.amount || 0), 0));
    if (Math.abs(refundsTotal - expectedRefund) > 0.01) {
      setError(
        `El reembolso (${formatMoney(refundsTotal)}) debe cuadrar con la devolución (${formatMoney(
          expectedRefund,
        )})`,
      );
      return;
    }

    setProcessing(true);
    const result = await createReturn(tenant.tenant_id, {
      sale_id: returnSale.sale_id,
      created_by: userProfile.user_id,
      reason,
      lines,
      refunds,
    });

    if (!result.success) {
      setError(result.error || 'No fue posible procesar devolución');
      setProcessing(false);
      return;
    }

    setReturnDialogOpen(false);
    setReturnSale(null);
    await loadPage(page, filters);
    setProcessing(false);
  };

  const confirmVoid = (sale) => {
    setSaleToVoid(sale);
    setVoidDialogOpen(true);
  };

  const doVoidSale = async () => {
    if (!saleToVoid?.sale_id || !tenant?.tenant_id) return;
    if (offlineMode) {
      setError('No puedes anular ventas en modo offline.');
      return;
    }

    setProcessing(true);
    const result = await voidSale(tenant.tenant_id, saleToVoid.sale_id);
    if (!result.success) {
      setError(result.error || 'No fue posible anular la venta');
      setProcessing(false);
      return;
    }

    setVoidDialogOpen(false);
    setSaleToVoid(null);
    await loadPage(page, filters);
    setProcessing(false);
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

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll}>
        {DATE_FILTERS.map((item) => {
          const active = activeDateFilterKey === item.key;
          const range = resolveDateRangeByDays(item.days);
          return (
            <Pressable
              key={item.key}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => updateFilters(range)}
            >
              <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll}>
        <Pressable
          style={[styles.filterChip, !filters?.location_id && styles.filterChipActive]}
          onPress={() => updateFilters({ location_id: '' })}
        >
          <Text style={[styles.filterChipText, !filters?.location_id && styles.filterChipTextActive]}>
            Todas las sedes
          </Text>
        </Pressable>
        {locations.map((loc) => {
          const active = filters?.location_id === loc.location_id;
          return (
            <Pressable
              key={loc.location_id}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => updateFilters({ location_id: loc.location_id })}
            >
              <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                {loc.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <PaginatedList
        title="Historial de Ventas"
        loading={loading}
        error={error}
        items={sales}
        emptyText="Sin ventas para este filtro."
        page={page}
        totalPages={totalPages}
        onPrev={() => changePage(page - 1)}
        onNext={() => changePage(page + 1)}
        footerMeta={
          cacheInfo?.source === 'cache' && cacheInfo?.cachedAt
            ? `Offline cache: ${new Date(cacheInfo.cachedAt).toLocaleString()}`
            : null
        }
        renderItem={(sale) => (
          <View key={sale.sale_id} style={styles.card}>
            <View style={styles.cardTopRow}>
              <Text style={styles.saleNumber}>{sale.sale_number || sale.sale_id?.slice(0, 8)}</Text>
              <Text style={styles.status}>{sale.status}</Text>
            </View>
            <Text style={styles.metaLine}>{new Date(sale.sold_at).toLocaleString()}</Text>
            <Text style={styles.metaLine}>Sede: {sale.location?.name || 'Sin sede'}</Text>
            <Text style={styles.metaLine}>Cliente: {sale.customer?.full_name || 'Consumidor final'}</Text>
            <Text style={styles.total}>{formatMoney(sale.total || 0)}</Text>

            <View style={styles.actionsRow}>
              <Pressable style={[styles.actionBtn, styles.detailBtn]} onPress={() => openDetail(sale.sale_id)}>
                <Text style={styles.actionBtnText}>Detalle</Text>
              </Pressable>
              <Pressable style={[styles.actionBtn, styles.printBtn]} onPress={() => handlePrintSale(sale)}>
                <Text style={styles.actionBtnText}>Imprimir</Text>
              </Pressable>
              {sale.status === 'COMPLETED' ? (
                <>
                  <Pressable style={[styles.actionBtn, styles.returnBtn]} onPress={() => openReturnDialog(sale)}>
                    <Text style={styles.actionBtnText}>Devolver</Text>
                  </Pressable>
                  <Pressable style={[styles.actionBtn, styles.voidBtn]} onPress={() => confirmVoid(sale)}>
                    <Text style={styles.actionBtnText}>Anular</Text>
                  </Pressable>
                </>
              ) : null}
            </View>
          </View>
        )}
      />

      <Modal
        visible={Boolean(detail) || loadingDetail}
        transparent
        animationType="slide"
        onRequestClose={() => setDetail(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBody}>
            {loadingDetail ? (
              <ActivityIndicator color="#38bdf8" />
            ) : (
              <ScrollView>
                <Text style={styles.modalTitle}>Detalle de venta</Text>
                <Text style={styles.metaLine}>{detail?.sale_number || '-'}</Text>
                <Text style={styles.metaLine}>{detail?.customer?.full_name || 'Consumidor final'}</Text>
                <Text style={styles.metaLine}>Total: {formatMoney(detail?.total || 0)}</Text>

                <Text style={styles.groupTitle}>Lineas</Text>
                {(detail?.sale_lines || []).map((line) => (
                  <View key={line.sale_line_id} style={styles.detailRow}>
                    <Text style={styles.metaLine}>
                      {line.variant?.product?.name || line.variant?.variant_name || 'Producto'} x {line.quantity}
                    </Text>
                    <Text style={styles.metaLine}>{formatMoney(line.line_total || 0)}</Text>
                  </View>
                ))}

                <Text style={styles.groupTitle}>Pagos</Text>
                {(detail?.sale_payments || []).map((payment) => (
                  <View key={payment.sale_payment_id} style={styles.detailRow}>
                    <Text style={styles.metaLine}>{payment.payment_method?.name || 'Pago'}</Text>
                    <Text style={styles.metaLine}>{formatMoney(payment.amount || 0)}</Text>
                  </View>
                ))}
              </ScrollView>
            )}

            <Pressable onPress={() => setDetail(null)} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={returnDialogOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setReturnDialogOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBody}>
            <ScrollView>
              <Text style={styles.modalTitle}>Crear Devolución</Text>
              <TextInput
                value={returnReason}
                onChangeText={setReturnReason}
                placeholder="Motivo de devolución"
                placeholderTextColor="#64748b"
                style={[styles.input, { minHeight: 56 }]}
                multiline
              />

              <Text style={styles.groupTitle}>Productos</Text>
              {(returnSale?.sale_lines || []).map((line) => {
                const maxQty = getLineMaxReturnQty(line);
                return (
                  <View key={line.sale_line_id} style={styles.returnLineCard}>
                    <Pressable
                      style={[styles.selectorBtn, line.selected && styles.selectorBtnActive]}
                      onPress={() => {
                        setReturnSale((prev) => ({
                          ...prev,
                          sale_lines: prev.sale_lines.map((l) =>
                            l.sale_line_id === line.sale_line_id ? { ...l, selected: !l.selected } : l,
                          ),
                        }));
                      }}
                    >
                      <Text style={styles.selectorBtnText}>{line.selected ? 'Seleccionado' : 'Seleccionar'}</Text>
                    </Pressable>
                    <Text style={styles.metaLine}>
                      {line.variant?.product?.name || line.variant?.variant_name || 'Producto'}
                    </Text>
                    <Text style={styles.metaLine}>Vendida: {line.quantity} · Ya devuelta: {line.returned_qty || 0}</Text>
                    <View style={styles.qtyEditorRow}>
                      <Text style={styles.metaLine}>Devolver</Text>
                      <TextInput
                        style={styles.qtyInput}
                        value={String(line.return_qty ?? maxQty)}
                        onChangeText={(value) => {
                          let qty = Number(value || 0);
                          if (qty < 0) qty = 0;
                          if (qty > maxQty) qty = maxQty;

                          setReturnSale((prev) => ({
                            ...prev,
                            sale_lines: prev.sale_lines.map((l) =>
                              l.sale_line_id === line.sale_line_id ? { ...l, return_qty: qty } : l,
                            ),
                          }));
                        }}
                        keyboardType="numeric"
                        editable={line.selected}
                      />
                    </View>
                  </View>
                );
              })}

              <Text style={styles.groupTitle}>Reembolso</Text>
              <Text style={styles.metaLine}>
                Total devolución: {formatMoney(getExpectedRefundTotal())} · Total reembolso: {formatMoney(getRefundsTotal())}
              </Text>
              <Pressable style={[styles.actionBtn, styles.detailBtn, { marginTop: 6 }]} onPress={distributeRefundsEqually}>
                <Text style={styles.actionBtnText}>Auto distribuir</Text>
              </Pressable>

              {returnRefunds.map((refund, idx) => (
                <View key={`refund-${idx}`} style={styles.refundCard}>
                  <Text style={styles.metaLine}>Método</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.methodChipsRow}>
                      {paymentMethods.map((method) => {
                        const active = refund.payment_method_id === method.payment_method_id;
                        return (
                          <Pressable
                            key={`${idx}-${method.payment_method_id}`}
                            style={[styles.methodChip, active && styles.methodChipActive]}
                            onPress={() => {
                              setReturnRefunds((prev) =>
                                prev.map((r, i) =>
                                  i === idx ? { ...r, payment_method_id: method.payment_method_id } : r,
                                ),
                              );
                            }}
                          >
                            <Text style={[styles.methodChipText, active && styles.methodChipTextActive]}>
                              {method.name}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </ScrollView>

                  <TextInput
                    style={styles.input}
                    value={String(refund.amount || '')}
                    onChangeText={(value) => {
                      setReturnRefunds((prev) =>
                        prev.map((r, i) => (i === idx ? { ...r, amount: value } : r)),
                      );
                    }}
                    placeholder="Monto"
                    placeholderTextColor="#64748b"
                    keyboardType="numeric"
                  />
                  <TextInput
                    style={styles.input}
                    value={refund.reference || ''}
                    onChangeText={(value) => {
                      setReturnRefunds((prev) =>
                        prev.map((r, i) => (i === idx ? { ...r, reference: value } : r)),
                      );
                    }}
                    placeholder="Referencia (opcional)"
                    placeholderTextColor="#64748b"
                  />

                  <View style={styles.refundActions}>
                    <Pressable
                      style={[styles.actionBtn, styles.printBtn]}
                      onPress={() => {
                        setReturnRefunds((prev) => [
                          ...prev,
                          {
                            payment_method_id: paymentMethods[0]?.payment_method_id || null,
                            amount: '0',
                            reference: '',
                          },
                        ]);
                      }}
                    >
                      <Text style={styles.actionBtnText}>+ Metodo</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.actionBtn, styles.voidBtn, returnRefunds.length <= 1 && styles.pageBtnDisabled]}
                      disabled={returnRefunds.length <= 1}
                      onPress={() => {
                        setReturnRefunds((prev) => prev.filter((_, i) => i !== idx));
                      }}
                    >
                      <Text style={styles.actionBtnText}>Quitar</Text>
                    </Pressable>
                  </View>
                </View>
              ))}

              <Pressable style={[styles.actionBtn, styles.returnBtn, { marginTop: 10 }]} onPress={processReturn} disabled={processing}>
                <Text style={styles.actionBtnText}>{processing ? 'Procesando...' : 'Procesar devolución'}</Text>
              </Pressable>
            </ScrollView>

            <Pressable onPress={() => setReturnDialogOpen(false)} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={voidDialogOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setVoidDialogOpen(false)}
      >
        <View style={styles.modalOverlayCenter}>
          <View style={styles.voidModalCard}>
            <Text style={styles.modalTitle}>Anular Venta</Text>
            <Text style={styles.metaLine}>
              ¿Anular venta #{saleToVoid?.sale_number || '-'} por {formatMoney(saleToVoid?.total || 0)}?
            </Text>
            <View style={styles.inlineActions}>
              <Pressable style={[styles.actionBtn, styles.detailBtn]} onPress={() => setVoidDialogOpen(false)}>
                <Text style={styles.actionBtnText}>Cancelar</Text>
              </Pressable>
              <Pressable style={[styles.actionBtn, styles.voidBtn]} onPress={doVoidSale} disabled={processing}>
                <Text style={styles.actionBtnText}>{processing ? 'Anulando...' : 'Anular'}</Text>
              </Pressable>
            </View>
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
  filterChipActive: { backgroundColor: '#0ea5e9', borderColor: '#0ea5e9' },
  filterChipText: { color: '#cbd5e1', fontSize: 12, fontWeight: '600' },
  filterChipTextActive: { color: '#082f49' },
  list: { flex: 1 },
  card: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  saleNumber: { color: '#f8fafc', fontWeight: '700' },
  status: { color: '#93c5fd', fontSize: 12, fontWeight: '700' },
  metaLine: { color: '#cbd5e1', fontSize: 13, marginBottom: 2 },
  total: { color: '#22d3ee', fontSize: 18, fontWeight: '700', marginTop: 4 },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  actionBtn: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  detailBtn: { backgroundColor: '#1e40af' },
  printBtn: { backgroundColor: '#0369a1' },
  returnBtn: { backgroundColor: '#a16207' },
  voidBtn: { backgroundColor: '#7f1d1d' },
  actionBtnText: { color: '#e2e8f0', fontWeight: '700', fontSize: 12 },
  empty: { color: '#94a3b8', marginTop: 14, textAlign: 'center' },
  error: { color: '#f87171', marginBottom: 8 },
  footerPagination: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
  },
  pageBtn: {
    backgroundColor: '#1e293b',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pageBtnDisabled: { opacity: 0.35 },
  pageBtnText: { color: '#e2e8f0', fontWeight: '700' },
  pageText: { color: '#94a3b8' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalOverlayCenter: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 16 },
  modalBody: {
    maxHeight: '90%',
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    padding: 14,
  },
  voidModalCard: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    padding: 14,
  },
  modalTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  groupTitle: { color: '#22d3ee', marginTop: 12, marginBottom: 4, fontWeight: '700' },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    paddingVertical: 6,
  },
  returnLineCard: {
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    backgroundColor: '#111827',
  },
  selectorBtn: {
    alignSelf: 'flex-start',
    backgroundColor: '#334155',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: 6,
  },
  selectorBtnActive: { backgroundColor: '#0ea5e9' },
  selectorBtnText: { color: '#e2e8f0', fontWeight: '700', fontSize: 12 },
  qtyEditorRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  qtyInput: {
    width: 90,
    minHeight: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0b1220',
    color: '#f8fafc',
    paddingHorizontal: 10,
  },
  input: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    color: '#f8fafc',
    paddingHorizontal: 10,
    marginTop: 8,
  },
  refundCard: {
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    backgroundColor: '#111827',
  },
  methodChipsRow: { flexDirection: 'row', gap: 6 },
  methodChip: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  methodChipActive: { backgroundColor: '#0ea5e9', borderColor: '#0ea5e9' },
  methodChipText: { color: '#cbd5e1', fontSize: 12, fontWeight: '600' },
  methodChipTextActive: { color: '#082f49' },
  refundActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  inlineActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
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
