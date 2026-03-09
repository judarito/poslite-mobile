import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DatePickerField from '../components/DatePickerField';
import PaginatedList from '../components/PaginatedList';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { useThemeMode } from '../lib/themeMode';
import { getLatestPageCache, getPageCache } from '../services/offlineCache.service';
import { listLocations } from '../services/inventoryCatalog.service';
import { getPaymentMethodsForDropdown } from '../services/pos.service';
import {
  createReturn,
  discardPendingOfflineSale,
  estimatePendingSaleTotal,
  getCompletedReturnQtyByLineIds,
  getPendingOfflineSaleByOperationId,
  getPendingOfflineSales,
  getSaleById,
  getSales,
  retryPendingOfflineSale,
  retrySaleElectronicInvoicing,
  updatePendingOfflineSalePayload,
  validatePendingOfflineSaleStock,
  voidSale,
} from '../services/sales.service';
import { syncPendingOperations } from '../services/sync.service';
import { getPendingOpsCount } from '../storage/sqlite/database';

const STATUS_FILTERS = ['', 'COMPLETED', 'VOIDED', 'PARTIAL_RETURN', 'PENDING_SYNC', 'FAILED_SYNC'];
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

function applyClientFilters(rows = [], filters = {}) {
  const statusFilter = String(filters?.status || '');
  const locationFilter = String(filters?.location_id || '');
  const fromDate = filters?.from_date ? new Date(filters.from_date) : null;
  const toDate = filters?.to_date ? new Date(filters.to_date) : null;

  return (rows || []).filter((sale) => {
    if (statusFilter && String(sale.status || '') !== statusFilter) return false;
    if (locationFilter && String(sale.location_id || '') !== locationFilter) return false;
    const soldAt = new Date(sale.sold_at);
    if (fromDate && soldAt < fromDate) return false;
    if (toDate && soldAt > toDate) return false;
    return true;
  });
}

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
    `OfirOne · Venta ${sale?.sale_number || '-'}`,
    `Fecha: ${sale?.sold_at ? new Date(sale.sold_at).toLocaleString() : '-'}`,
    `Cliente: ${sale?.customer?.full_name || 'Consumidor final'}`,
    `Documento: ${sale?.invoice_type || 'FV'}`,
    sale?.dian_status ? `Estado DIAN: ${sale.dian_status}` : null,
    sale?.cufe ? `CUFE: ${sale.cufe}` : null,
    '',
    'Productos:',
    ...(lines.length ? lines : ['- Sin lineas']),
    '',
    `Total: ${currencyFormatter(sale?.total || 0)}`,
    '',
    'Pagos:',
    ...(payments.length ? payments : ['- Sin pagos']),
  ].filter(Boolean).join('\n');
}

function getDianStatusTone(status = '') {
  const value = String(status || '').toUpperCase();
  if (value === 'ACCEPTED') return 'accepted';
  if (value === 'REJECTED' || value === 'ERROR') return 'error';
  if (value === 'PROCESSING' || value === 'PENDING') return 'pending';
  return 'neutral';
}

function shouldAllowFeRetry(sale) {
  if (!sale || sale?.is_local_pending) return false;
  const status = String(sale?.dian_status || '').toUpperCase();
  return status === 'PENDING' || status === 'REJECTED' || status === 'ERROR';
}

export default function SalesHistoryScreen({
  tenant,
  userProfile,
  formatMoney,
  offlineMode,
  pendingOpsCount = 0,
  onPendingOpsChange,
  pageSize = 20,
}) {
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';
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
  const [fromDateInput, setFromDateInput] = useState('');
  const [toDateInput, setToDateInput] = useState('');
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editSale, setEditSale] = useState(null);
  const [editLines, setEditLines] = useState([]);

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
    fetchPage: async ({ tenantId, page: nextPage, pageSize: nextPageSize, filters: nextFilters }) => {
      const serverResult = await getSales(tenantId, nextPage, nextPageSize, {
        status: nextFilters?.status || null,
        location_id: nextFilters?.location_id || null,
        from_date: nextFilters?.from_date || null,
        to_date: nextFilters?.to_date || null,
      });

      if (!serverResult?.success) return serverResult;

      if (nextPage !== 1) return serverResult;

      const pendingResult = await getPendingOfflineSales(tenantId, {
        status: nextFilters?.status || null,
        location_id: nextFilters?.location_id || null,
        from_date: nextFilters?.from_date || null,
        to_date: nextFilters?.to_date || null,
      });

      const pendingRows = pendingResult?.success ? pendingResult.data || [] : [];
      if (!pendingRows.length) return serverResult;

      return {
        success: true,
        data: [...pendingRows, ...(serverResult.data || [])],
        total: Number(serverResult.total || 0) + pendingRows.length,
      };
    },
    fetchOfflinePage: async ({ tenantId, page: nextPage, pageSize: nextPageSize, filters: nextFilters }) => {
      const pendingResult = await getPendingOfflineSales(tenantId, {
        status: nextFilters?.status || null,
        location_id: nextFilters?.location_id || null,
        from_date: nextFilters?.from_date || null,
        to_date: nextFilters?.to_date || null,
      });
      const pendingRows = pendingResult?.success ? pendingResult.data || [] : [];

      const exactCache = await getPageCache({
        namespace: 'sales-history',
        tenantId,
        page: nextPage,
        pageSize: nextPageSize,
        filters: nextFilters,
      });
      const latestCache = exactCache
        ? exactCache
        : await getLatestPageCache({ namespace: 'sales-history', tenantId });

      const cachedServerRowsRaw = latestCache?.items || [];
      const cachedServerRows = applyClientFilters(
        cachedServerRowsRaw.filter((row) => !row?.is_local_pending),
        nextFilters,
      );

      if (nextPage === 1) {
        const merged = [...pendingRows, ...cachedServerRows];
        return {
          success: true,
          data: merged.slice(0, nextPageSize),
          total: merged.length,
          source: 'offline-local',
          cachedAt: latestCache?.cachedAt || null,
        };
      }

      const start = (nextPage - 1) * nextPageSize;
      const pageRows = cachedServerRows.slice(start, start + nextPageSize);
      return {
        success: true,
        data: pageRows,
        total: cachedServerRows.length + pendingRows.length,
        source: 'offline-local',
        cachedAt: latestCache?.cachedAt || null,
      };
    },
  });

  useEffect(() => {
    const load = async () => {
      if (!tenant?.tenant_id) return;
      const result = await listLocations(tenant.tenant_id);
      if (result.success) setLocations(result.data || []);
    };
    load();
  }, [tenant?.tenant_id]);

  useEffect(() => {
    loadPage(1, filters);
  }, [pendingOpsCount]);

  useEffect(() => {
    const formatIsoToYmd = (iso) => {
      if (!iso) return '';
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return '';
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    setFromDateInput(formatIsoToYmd(filters?.from_date));
    setToDateInput(formatIsoToYmd(filters?.to_date));
  }, [filters?.from_date, filters?.to_date]);

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

  const retryFe = async (sale) => {
    if (!sale?.sale_id || !tenant?.tenant_id) return;
    if (offlineMode) {
      setError('No puedes reintentar FE en modo offline.');
      return;
    }

    setProcessing(true);
    const result = await retrySaleElectronicInvoicing(tenant.tenant_id, sale.sale_id);
    if (!result.success) {
      setError(result.error || 'No fue posible reintentar facturacion electronica');
      setProcessing(false);
      return;
    }

    if (result.mode === 'manual_reset') {
      Alert.alert(
        'FE en cola',
        'La venta quedo en estado PENDING para reproceso. El envio depende del backend FE.',
      );
    }

    if (detail?.sale_id === sale.sale_id) {
      const refreshed = await getSaleById(tenant.tenant_id, sale.sale_id);
      if (refreshed.success) {
        setDetail(refreshed.data);
      }
    }

    await loadPage(page, filters);
    setProcessing(false);
  };

  const refreshPendingCount = async () => {
    if (!onPendingOpsChange) return;
    const next = await getPendingOpsCount({
      tenantId: tenant?.tenant_id || null,
      userId: null,
    });
    onPendingOpsChange(next);
  };

  const retryPendingSale = async (sale) => {
    const operationId = sale?.operation_id;
    if (!operationId) return;
    setProcessing(true);
    const result = await retryPendingOfflineSale(operationId);
    if (!result.success) {
      setError(result.error || 'No fue posible reintentar venta offline');
      setProcessing(false);
      return;
    }

    const payload = sale?.local_payload || {};
    if (!offlineMode) {
      const stockCheck = await validatePendingOfflineSaleStock(tenant?.tenant_id, payload);
      if (!stockCheck.success) {
        setError(stockCheck.error || 'No fue posible validar stock antes de sincronizar.');
        setProcessing(false);
        return;
      }
      if (!stockCheck.ok) {
        const firstIssue = stockCheck.issues?.[0];
        if (firstIssue?.variant_id) {
          const label = [firstIssue.product_name, firstIssue.variant_name, firstIssue.sku]
            .filter(Boolean)
            .join(' · ');
          setError(
            `Stock insuficiente en sede de la venta: ${label || firstIssue.variant_id}. Disponible: ${firstIssue.available}, Requerido: ${firstIssue.required}.`,
          );
        } else {
          setError(stockCheck.issues?.[0]?.message || 'No pasa validación de stock.');
        }
        setProcessing(false);
        return;
      }
    }

    if (!offlineMode) {
      await syncPendingOperations({
        limit: 20,
        tenantId: tenant?.tenant_id || null,
        userId: null,
      });
    }

    const stateAfter = await getPendingOfflineSaleByOperationId(operationId);
    if (stateAfter.success && stateAfter.data?.status === 'FAILED_SYNC') {
      setError(
        stateAfter.data.sync_error ||
          'La venta sigue fallando al sincronizar. Revisa inventario en la sede y vuelve a intentar.',
      );
    }

    await refreshPendingCount();
    await loadPage(1, filters);
    setProcessing(false);
  };

  const discardPendingSale = (sale) => {
    const operationId = sale?.operation_id;
    if (!operationId) return;
    Alert.alert('Descartar venta offline', `Se descartara ${sale.sale_number || 'la venta'} de la cola local.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Descartar',
        style: 'destructive',
        onPress: async () => {
          setProcessing(true);
          const result = await discardPendingOfflineSale(operationId);
          if (!result.success) {
            setError(result.error || 'No fue posible descartar venta offline');
            setProcessing(false);
            return;
          }
          await refreshPendingCount();
          await loadPage(1, filters);
          setProcessing(false);
        },
      },
    ]);
  };

  const openEditPendingSale = async (sale) => {
    const operationId = sale?.operation_id;
    if (!operationId) return;
    const result = await getPendingOfflineSaleByOperationId(operationId);
    if (!result.success) {
      setError(result.error || 'No fue posible cargar borrador offline');
      return;
    }
    const payload = result.data?.payload || sale.local_payload || {};
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    if (!lines.length) {
      setError('La venta offline no tiene lineas editables.');
      return;
    }
    setEditSale({
      ...sale,
      operation_id: operationId,
      payload,
    });
    setEditLines(
      lines.map((line, idx) => ({
        key: `${line.variant_id || idx}-${idx}`,
        variant_id: line.variant_id,
        sku: line.sku || null,
        product_name: line.product_name || line.productName || null,
        variant_name: line.variant_name || line.variantName || null,
        qty: Number(line.qty || 1),
        unit_price: Number(line.unit_price || 0),
        discount: Number(line.discount || 0),
      })),
    );
    setEditDialogOpen(true);
  };

  const saveEditedPendingSale = async () => {
    if (!editSale?.operation_id || !tenant?.tenant_id) return;
    const normalizedLines = editLines
      .map((line) => ({
        variant_id: line.variant_id,
        sku: line.sku || null,
        product_name: line.product_name || null,
        variant_name: line.variant_name || null,
        qty: Math.max(0, Math.round(Number(line.qty || 0))),
        unit_price: Number(line.unit_price || 0),
        discount: Number(line.discount || 0),
        discount_type: 'AMOUNT',
      }))
      .filter((line) => line.qty > 0 && line.variant_id);

    if (!normalizedLines.length) {
      setError('Debe quedar al menos una linea con cantidad mayor que cero.');
      return;
    }

    setProcessing(true);
    const totalResult = await estimatePendingSaleTotal(tenant.tenant_id, normalizedLines);
    if (!totalResult.success) {
      setError(totalResult.error || 'No fue posible estimar total para sincronizar');
      setProcessing(false);
      return;
    }

    const currentPayments = Array.isArray(editSale.payload?.payments) ? editSale.payload.payments : [];
    const firstPayment = currentPayments[0] || { payment_method_code: 'EFECTIVO' };
    const nextPayload = {
      ...(editSale.payload || {}),
      lines: normalizedLines,
      payments: [
        {
          payment_method_code: firstPayment.payment_method_code || 'EFECTIVO',
          amount: Number(totalResult.total || 0),
          reference: firstPayment.reference || null,
        },
      ],
    };

    const updateResult = await updatePendingOfflineSalePayload(editSale.operation_id, nextPayload);
    if (!updateResult.success) {
      setError(updateResult.error || 'No fue posible guardar cambios de venta offline');
      setProcessing(false);
      return;
    }

    if (!offlineMode) {
      const stockCheck = await validatePendingOfflineSaleStock(tenant?.tenant_id, nextPayload);
      if (!stockCheck.success) {
        setError(stockCheck.error || 'No fue posible validar stock antes de sincronizar.');
        setProcessing(false);
        return;
      }
      if (!stockCheck.ok) {
        const firstIssue = stockCheck.issues?.[0];
        if (firstIssue?.variant_id) {
          const label = [firstIssue.product_name, firstIssue.variant_name, firstIssue.sku]
            .filter(Boolean)
            .join(' · ');
          setError(
            `Stock insuficiente en sede de la venta: ${label || firstIssue.variant_id}. Disponible: ${firstIssue.available}, Requerido: ${firstIssue.required}.`,
          );
        } else {
          setError(stockCheck.issues?.[0]?.message || 'No pasa validación de stock.');
        }
        setProcessing(false);
        return;
      }
    }

    const retryResult = await retryPendingOfflineSale(editSale.operation_id);
    if (!retryResult.success) {
      setError(retryResult.error || 'No fue posible enviar venta a reintento');
      setProcessing(false);
      return;
    }

    if (!offlineMode) {
      await syncPendingOperations({
        limit: 20,
        tenantId: tenant?.tenant_id || null,
        userId: null,
      });
    }

    const stateAfter = await getPendingOfflineSaleByOperationId(editSale.operation_id);
    if (stateAfter.success && stateAfter.data?.status === 'FAILED_SYNC') {
      setError(
        stateAfter.data.sync_error ||
          'Sigue fallando. Revisa stock disponible en sede o reduce cantidad.',
      );
    } else {
      setEditDialogOpen(false);
      setEditSale(null);
      setEditLines([]);
    }

    await refreshPendingCount();
    await loadPage(1, filters);
    setProcessing(false);
  };

  const parseYmdToDate = (value) => {
    if (!value) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const [, y, m, d] = match;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    if (
      Number.isNaN(date.getTime()) ||
      date.getFullYear() !== Number(y) ||
      date.getMonth() !== Number(m) - 1 ||
      date.getDate() !== Number(d)
    ) {
      return null;
    }
    return date;
  };

  const applyCustomDateRange = () => {
    const fromDate = parseYmdToDate(fromDateInput);
    const toDate = parseYmdToDate(toDateInput);

    if (fromDateInput && !fromDate) {
      setError('Fecha "Desde" invalida. Usa formato YYYY-MM-DD.');
      return;
    }
    if (toDateInput && !toDate) {
      setError('Fecha "Hasta" invalida. Usa formato YYYY-MM-DD.');
      return;
    }
    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      setError('"Desde" no puede ser mayor que "Hasta".');
      return;
    }

    updateFilters({
      from_date: fromDate ? toStartOfDayIso(fromDate) : '',
      to_date: toDate ? toEndOfDayIso(toDate) : '',
    });
  };

  const clearCustomDateRange = () => {
    setFromDateInput('');
    setToDateInput('');
    updateFilters({ from_date: '', to_date: '' });
  };

  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll}>
        {STATUS_FILTERS.map((s) => {
          const active = (filters?.status || '') === s;
          const label = s || 'TODOS';
          return (
            <Pressable
              key={label}
              style={[styles.filterChip, isLightTheme && styles.filterChipLight, active && styles.filterChipActive]}
              onPress={() => updateFilters({ status: s })}
            >
              <Text style={[styles.filterChipText, isLightTheme && styles.filterChipTextLight, active && styles.filterChipTextActive]}>{label}</Text>
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
              style={[styles.filterChip, isLightTheme && styles.filterChipLight, active && styles.filterChipActive]}
              onPress={() => updateFilters(range)}
            >
              <Text style={[styles.filterChipText, isLightTheme && styles.filterChipTextLight, active && styles.filterChipTextActive]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={[styles.dateRangeCard, isLightTheme && styles.dateRangeCardLight]}>
        <Text style={[styles.dateRangeTitle, isLightTheme && styles.dateRangeTitleLight]}>Rango de fechas</Text>
        <View style={styles.dateRangeInputsRow}>
          <DatePickerField
            label="Desde"
            value={fromDateInput}
            onChange={setFromDateInput}
            maximumDate={toDateInput || undefined}
            style={styles.dateInput}
          />
          <DatePickerField
            label="Hasta"
            value={toDateInput}
            onChange={setToDateInput}
            minimumDate={fromDateInput || undefined}
            style={styles.dateInput}
          />
        </View>
        <View style={styles.dateActionsRow}>
          <Pressable style={[styles.actionBtn, styles.detailBtn]} onPress={applyCustomDateRange}>
            <Text style={styles.actionBtnText}>Aplicar</Text>
          </Pressable>
          <Pressable style={[styles.actionBtn, styles.printBtn]} onPress={clearCustomDateRange}>
            <Text style={styles.actionBtnText}>Limpiar</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll}>
        <Pressable
          style={[styles.filterChip, isLightTheme && styles.filterChipLight, !filters?.location_id && styles.filterChipActive]}
          onPress={() => updateFilters({ location_id: '' })}
        >
          <Text style={[styles.filterChipText, isLightTheme && styles.filterChipTextLight, !filters?.location_id && styles.filterChipTextActive]}>
            Todas las sedes
          </Text>
        </Pressable>
        {locations.map((loc) => {
          const active = filters?.location_id === loc.location_id;
          return (
            <Pressable
              key={loc.location_id}
              style={[styles.filterChip, isLightTheme && styles.filterChipLight, active && styles.filterChipActive]}
              onPress={() => updateFilters({ location_id: loc.location_id })}
            >
              <Text style={[styles.filterChipText, isLightTheme && styles.filterChipTextLight, active && styles.filterChipTextActive]}>
                {loc.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <PaginatedList
        themeMode={themeMode}
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
          <View key={sale.sale_id} style={[styles.card, isLightTheme && styles.cardLight]}>
            <View style={styles.cardTopRow}>
              <Text style={[styles.saleNumber, isLightTheme && styles.saleNumberLight]}>{sale.sale_number || sale.sale_id?.slice(0, 8)}</Text>
              <Text
                style={[
                  styles.status,
                  sale.status === 'PENDING_SYNC' && styles.statusPending,
                  sale.status === 'FAILED_SYNC' && styles.statusFailed,
                ]}
              >
                {sale.status}
              </Text>
            </View>
            <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>{new Date(sale.sold_at).toLocaleString()}</Text>
            <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>Sede: {sale.location?.name || 'Sin sede'}</Text>
            <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>Cliente: {sale.customer?.full_name || 'Consumidor final'}</Text>
            <View style={styles.feMetaRow}>
              <Text style={[styles.feInvoiceType, isLightTheme && styles.feInvoiceTypeLight]}>
                Documento: {sale.invoice_type || 'FV'}
              </Text>
              {sale.dian_status ? (
                <View
                  style={[
                    styles.feChip,
                    getDianStatusTone(sale.dian_status) === 'accepted' && styles.feChipAccepted,
                    getDianStatusTone(sale.dian_status) === 'error' && styles.feChipError,
                    getDianStatusTone(sale.dian_status) === 'pending' && styles.feChipPending,
                  ]}
                >
                  <Text style={styles.feChipText}>{sale.dian_status}</Text>
                </View>
              ) : null}
            </View>
            {sale.cufe ? (
              <Text style={[styles.metaLine, isLightTheme && styles.metaLineLight]}>
                CUFE: {String(sale.cufe).slice(0, 18)}...
              </Text>
            ) : null}
            {sale.sync_error ? <Text style={styles.syncErrorLine}>Error sync: {sale.sync_error}</Text> : null}
            <Text style={styles.total}>{formatMoney(sale.total || 0)}</Text>

            <View style={styles.actionsRow}>
              {!sale.is_local_pending ? (
                <>
                  <Pressable style={[styles.actionBtn, styles.detailBtn]} onPress={() => openDetail(sale.sale_id)}>
                    <Text style={styles.actionBtnText}>Detalle</Text>
                  </Pressable>
                  <Pressable style={[styles.actionBtn, styles.printBtn]} onPress={() => handlePrintSale(sale)}>
                    <Text style={styles.actionBtnText}>Imprimir</Text>
                  </Pressable>
                </>
              ) : null}
              {sale.is_local_pending ? (
                <>
                  {sale.status === 'FAILED_SYNC' ? (
                    <Pressable
                      style={[styles.actionBtn, styles.retryBtn, processing && styles.pageBtnDisabled]}
                      disabled={processing}
                      onPress={() => retryPendingSale(sale)}
                    >
                      <Text style={styles.actionBtnText}>Reintentar</Text>
                    </Pressable>
                  ) : null}
                  {sale.status === 'FAILED_SYNC' ? (
                    <Pressable
                      style={[styles.actionBtn, styles.detailBtn, processing && styles.pageBtnDisabled]}
                      disabled={processing}
                      onPress={() => openEditPendingSale(sale)}
                    >
                      <Text style={styles.actionBtnText}>Editar</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    style={[styles.actionBtn, styles.voidBtn, processing && styles.pageBtnDisabled]}
                    disabled={processing}
                    onPress={() => discardPendingSale(sale)}
                  >
                    <Text style={styles.actionBtnText}>Descartar</Text>
                  </Pressable>
                </>
              ) : null}
              {sale.status === 'COMPLETED' ? (
                <>
                  {shouldAllowFeRetry(sale) ? (
                    <Pressable
                      style={[styles.actionBtn, styles.retryBtn, processing && styles.pageBtnDisabled]}
                      onPress={() => retryFe(sale)}
                      disabled={processing}
                    >
                      <Text style={styles.actionBtnText}>Reintentar FE</Text>
                    </Pressable>
                  ) : null}
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
                <Text style={styles.metaLine}>Documento: {detail?.invoice_type || 'FV'}</Text>
                {detail?.dian_status ? <Text style={styles.metaLine}>Estado DIAN: {detail.dian_status}</Text> : null}
                {detail?.cufe ? <Text style={styles.metaLine}>CUFE: {detail.cufe}</Text> : null}
                {detail?.dian_consecutive ? (
                  <Text style={styles.metaLine}>Consecutivo DIAN: {detail.dian_consecutive}</Text>
                ) : null}
                {detail?.third_party?.legal_name ? (
                  <Text style={styles.metaLine}>
                    Receptor FE: {detail.third_party.legal_name} ({detail.third_party.document_number || 'N/D'})
                  </Text>
                ) : null}
                {shouldAllowFeRetry(detail) ? (
                  <Pressable
                    style={[styles.actionBtn, styles.retryBtn, processing && styles.pageBtnDisabled, { marginTop: 8 }]}
                    disabled={processing}
                    onPress={() => retryFe(detail)}
                  >
                    <Text style={styles.actionBtnText}>Reintentar FE</Text>
                  </Pressable>
                ) : null}

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

      <Modal
        visible={editDialogOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setEditDialogOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalBody}>
            <ScrollView>
              <Text style={styles.modalTitle}>Editar venta offline</Text>
              <Text style={styles.metaLine}>Ajusta cantidades para reintentar sincronizacion.</Text>
              {editLines.map((line, idx) => (
                <View key={line.key} style={styles.returnLineCard}>
                  <Text style={styles.metaLine}>Variante: {line.variant_id?.slice(0, 8) || '-'}</Text>
                  <Text style={styles.metaLine}>Precio: {formatMoney(line.unit_price || 0)}</Text>
                  <Text style={styles.metaLine}>Descuento: {formatMoney(line.discount || 0)}</Text>
                  <View style={styles.qtyEditorRow}>
                    <Text style={styles.metaLine}>Cantidad</Text>
                    <TextInput
                      style={styles.qtyInput}
                      value={String(line.qty || 0)}
                      onChangeText={(value) => {
                        const qty = Math.max(0, Math.round(Number(value || 0)));
                        setEditLines((prev) =>
                          prev.map((l, i) => (i === idx ? { ...l, qty } : l)),
                        );
                      }}
                      keyboardType="numeric"
                    />
                  </View>
                </View>
              ))}

              <Pressable
                style={[styles.actionBtn, styles.retryBtn, { marginTop: 10 }, processing && styles.pageBtnDisabled]}
                onPress={saveEditedPendingSale}
                disabled={processing}
              >
                <Text style={styles.actionBtnText}>{processing ? 'Guardando...' : 'Guardar y reintentar'}</Text>
              </Pressable>
            </ScrollView>

            <Pressable onPress={() => setEditDialogOpen(false)} style={styles.closeBtn}>
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
  containerLight: { backgroundColor: '#f8fafc' },
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
  filterChipLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  filterChipActive: { backgroundColor: '#0ea5e9', borderColor: '#0ea5e9' },
  filterChipText: { color: '#cbd5e1', fontSize: 12, fontWeight: '600' },
  filterChipTextLight: { color: '#334155' },
  filterChipTextActive: { color: '#082f49' },
  dateRangeCard: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  dateRangeCardLight: { backgroundColor: '#ffffff', borderColor: '#dbe4ef' },
  dateRangeTitle: { color: '#e2e8f0', fontWeight: '700', marginBottom: 8 },
  dateRangeTitleLight: { color: '#0f172a' },
  dateRangeInputsRow: { flexDirection: 'row', gap: 8 },
  dateInput: { flex: 1, marginTop: 0 },
  dateActionsRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  list: { flex: 1 },
  card: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  cardLight: { backgroundColor: '#ffffff', borderColor: '#dbe4ef' },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  saleNumber: { color: '#f8fafc', fontWeight: '700' },
  saleNumberLight: { color: '#0f172a' },
  status: { color: '#93c5fd', fontSize: 12, fontWeight: '700' },
  statusPending: { color: '#fbbf24' },
  statusFailed: { color: '#f87171' },
  metaLine: { color: '#cbd5e1', fontSize: 13, marginBottom: 2 },
  metaLineLight: { color: '#475569' },
  feMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2, marginBottom: 2 },
  feInvoiceType: { color: '#cbd5e1', fontSize: 12, fontWeight: '700' },
  feInvoiceTypeLight: { color: '#334155' },
  feChip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#334155',
  },
  feChipPending: { backgroundColor: '#92400e' },
  feChipAccepted: { backgroundColor: '#166534' },
  feChipError: { backgroundColor: '#991b1b' },
  feChipText: { color: '#e2e8f0', fontSize: 11, fontWeight: '700' },
  syncErrorLine: { color: '#fca5a5', fontSize: 12, marginBottom: 2 },
  total: { color: '#22d3ee', fontSize: 18, fontWeight: '700', marginTop: 4 },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  actionBtn: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  detailBtn: { backgroundColor: '#1e40af' },
  printBtn: { backgroundColor: '#0369a1' },
  retryBtn: { backgroundColor: '#b45309' },
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
  inputLight: {
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    color: '#0f172a',
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
