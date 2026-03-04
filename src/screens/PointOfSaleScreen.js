import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useThemeMode } from '../lib/themeMode';
import {
  createSale,
  getCurrentUserOpenSession,
  getPaymentMethodsForDropdown,
  getTaxInfoForVariant,
  listCatalogForInvoiceMatching,
  searchCustomers,
  searchCustomersOffline,
  searchVariantsOffline,
  searchVariants,
  warmPosCatalog,
  warmCustomersCatalog,
} from '../services/pos.service';
import { analyzeInvoiceWithImage, matchInvoiceLinesToCatalog } from '../services/invoiceAgent.service';
import { enqueuePendingOp, getPendingOpsCount } from '../storage/sqlite/database';
import { getOrCreateDeviceId } from '../services/device.service';

const OCR_MAX_BYTES = 980 * 1024;

function estimateBase64Bytes(base64) {
  const raw = String(base64 || '');
  if (!raw) return 0;
  return Math.ceil((raw.length * 3) / 4);
}

async function buildOptimizedImageForOcr(asset) {
  if (!asset?.uri) {
    return { success: false, error: 'No se pudo obtener URI de imagen.' };
  }

  let ImageManipulator;
  try {
    ImageManipulator = require('expo-image-manipulator');
  } catch (_e) {
    return {
      success: false,
      error: 'Falta expo-image-manipulator. Instala dependencia o toma una foto mas cercana.',
    };
  }

  const widths = [1400, 1200, 1000, 800];
  const qualities = [0.35, 0.22, 0.14, 0.1];

  for (const width of widths) {
    for (const quality of qualities) {
      const result = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width } }],
        {
          compress: quality,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        },
      );

      if (result?.base64 && estimateBase64Bytes(result.base64) <= OCR_MAX_BYTES) {
        return {
          success: true,
          data: { base64: result.base64, mimeType: 'image/jpeg' },
        };
      }
    }
  }

  return {
    success: false,
    error: 'No se pudo reducir la foto por debajo de 1MB para OCR. Acerca mas la camara y evita fondo extra.',
  };
}

function calculateDiscount(subtotal, discountValue, discountType) {
  const value = Number(discountValue || 0);
  if (!value || value <= 0) return 0;
  if (discountType === 'PERCENT') {
    return Math.round((subtotal * (value / 100)) * 100) / 100;
  }
  return Math.round(Math.min(value, subtotal) * 100) / 100;
}

function applyLineTaxes(line, taxResult, priceAfterDiscount) {
  if (taxResult.success && taxResult.rate) {
    line.tax_rate = taxResult.rate;
    line.tax_code = taxResult.code;
    line.tax_name = taxResult.name;

    if (line.price_includes_tax) {
      const total = priceAfterDiscount;
      const base = total / (1 + line.tax_rate);
      const tax = total - base;
      line.base_amount = Math.round(base);
      line.tax_amount = Math.round(tax);
      line.line_total = Math.round(total);
      return;
    }

    const base = priceAfterDiscount;
    const tax = base * line.tax_rate;
    line.base_amount = Math.round(base);
    line.tax_amount = Math.round(tax);
    line.line_total = Math.round(base + tax);
    return;
  }

  line.base_amount = Math.round(priceAfterDiscount);
  line.tax_amount = 0;
  line.tax_rate = 0;
  line.tax_code = null;
  line.tax_name = null;
  line.line_total = Math.round(priceAfterDiscount);
}

function createOperationId() {
  const rand = Math.random().toString(36).slice(2, 10);
  return `sale_${Date.now().toString(36)}_${rand}`;
}

function isTransientNetworkError(message) {
  const text = String(message || '').toLowerCase();
  return (
    text.includes('network') ||
    text.includes('fetch') ||
    text.includes('timeout') ||
    text.includes('connection') ||
    text.includes('failed to fetch')
  );
}

function normalizeMatchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreCustomerName(targetName, customer) {
  const target = normalizeMatchText(targetName);
  const candidate = normalizeMatchText(customer?.full_name || '');
  if (!target || !candidate) return 0;
  if (target === candidate) return 1;
  if (candidate.includes(target) || target.includes(candidate)) return 0.92;

  const targetTokens = target.split(' ').filter((t) => t.length > 1);
  const candidateTokens = candidate.split(' ').filter((t) => t.length > 1);
  if (!targetTokens.length || !candidateTokens.length) return 0;

  const candidateSet = new Set(candidateTokens);
  const common = targetTokens.filter((token) => candidateSet.has(token)).length;
  return common / targetTokens.length;
}

function findBestCustomerMatch(targetName, customersList) {
  const list = Array.isArray(customersList) ? customersList : [];
  let best = null;
  for (const c of list) {
    const score = scoreCustomerName(targetName, c);
    if (!best || score > best.score) best = { customer: c, score };
  }
  if (!best || best.score < 0.55) return null;
  return best;
}

export default function PointOfSaleScreen({
  tenant,
  userProfile,
  tenantSettings,
  offlineMode,
  onPendingOpsChange,
  onSaleCompleted,
}) {
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';
  const [loadingInit, setLoadingInit] = useState(true);
  const [search, setSearch] = useState('');
  const [searchingProducts, setSearchingProducts] = useState(false);
  const [results, setResults] = useState([]);
  const [cart, setCart] = useState([]);
  const [searchCustomer, setSearchCustomer] = useState('');
  const [searchingCustomers, setSearchingCustomers] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [payments, setPayments] = useState([{ method: '', amount: 0 }]);
  const [currentSession, setCurrentSession] = useState(null);
  const [saleNote, setSaleNote] = useState('');
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [processingInvoice, setProcessingInvoice] = useState(false);
  const [invoiceScanSummary, setInvoiceScanSummary] = useState(null);

  const currency = tenant?.currency_code || 'COP';
  const roundingMethod = tenantSettings?.rounding_method || 'normal';
  const roundingMultiple = Number(tenantSettings?.rounding_multiple || 100);

  const applyRounding = (amount) => {
    const numeric = Number(amount || 0);
    if (!Number.isFinite(numeric)) return 0;
    if (roundingMethod === 'none' || roundingMultiple <= 1) {
      return Math.round(numeric);
    }

    const divided = numeric / roundingMultiple;
    let roundedUnit = Math.round(divided);
    if (roundingMethod === 'up') roundedUnit = Math.ceil(divided);
    if (roundingMethod === 'down') roundedUnit = Math.floor(divided);
    return Math.round(roundedUnit * roundingMultiple);
  };
  const formatMoney = (value) => {
    try {
      return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      }).format(Number(value || 0));
    } catch (_e) {
      return `$ ${Math.round(Number(value || 0)).toLocaleString('es-CO')}`;
    }
  };

  const totals = useMemo(() => {
    let subtotal = 0;
    let discount = 0;
    let tax = 0;
    let totalRaw = 0;

    cart.forEach((line) => {
      subtotal += line.base_amount || 0;
      discount += line.discount || 0;
      tax += line.tax_amount || 0;
      totalRaw += line.line_total || 0;
    });

    const total = applyRounding(totalRaw);

    return {
      subtotal,
      discount,
      tax,
      totalRaw: Math.round(totalRaw),
      roundingAdjustment: Math.round(total - totalRaw),
      total,
    };
  }, [cart, roundingMethod, roundingMultiple]);

  const paidTotal = useMemo(
    () => payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0),
    [payments],
  );
  const remaining = useMemo(() => Math.max(0, totals.total - paidTotal), [totals.total, paidTotal]);
  const change = useMemo(() => Math.max(0, paidTotal - totals.total), [totals.total, paidTotal]);

  const isAdmin = useMemo(
    () => (userProfile?.roles || []).some((role) => role?.name === 'ADMINISTRADOR'),
    [userProfile],
  );

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoadingInit(true);
      try {
        const tenantId = tenant?.tenant_id;
        const userId = userProfile?.user_id;
        if (!tenantId || !userId) return;

        const [pm, session] = await Promise.all([
          getPaymentMethodsForDropdown(tenantId, { offlineMode }),
          getCurrentUserOpenSession(tenantId, userId, { offlineMode }),
        ]);

        if (!active) return;

        if (pm.success) {
          setPaymentMethods(pm.data);
          if (pm.data.length > 0) {
            setPayments([{ method: pm.data[0].code, amount: 0 }]);
          }
        }
        if (session.success) {
          setCurrentSession(session.data);
        }

        if (!offlineMode) {
          await Promise.all([
            warmPosCatalog(tenantId, session?.data?.cash_register?.location_id || null),
            warmCustomersCatalog(tenantId),
          ]);
        }
      } finally {
        if (active) setLoadingInit(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [tenant?.tenant_id, userProfile?.user_id, offlineMode]);

  useEffect(() => {
    if (!search || search.length < 2) {
      setResults([]);
      return;
    }

    let active = true;
    const t = setTimeout(async () => {
      setSearchingProducts(true);
      const tenantId = tenant?.tenant_id;
      if (!tenantId) {
        if (active) setSearchingProducts(false);
        return;
      }
      const locationId = currentSession?.cash_register?.location_id || null;
      const r = offlineMode
        ? await searchVariantsOffline(tenantId, search, 20, locationId)
        : await searchVariants(tenantId, search, 20, locationId);
      if (active) {
        setResults(r.success ? r.data : []);
        setSearchingProducts(false);
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [search, tenant?.tenant_id, currentSession?.cash_register?.location_id, offlineMode]);

  useEffect(() => {
    if (!searchCustomer || searchCustomer.length < 2) {
      setCustomers([]);
      return;
    }

    let active = true;
    const t = setTimeout(async () => {
      setSearchingCustomers(true);
      const tenantId = tenant?.tenant_id;
      if (!tenantId) {
        if (active) setSearchingCustomers(false);
        return;
      }
      const r = offlineMode
        ? await searchCustomersOffline(tenantId, searchCustomer, 20)
        : await searchCustomers(tenantId, searchCustomer, 20);
      if (active) {
        setCustomers(r.success ? r.data : []);
        setSearchingCustomers(false);
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [searchCustomer, tenant?.tenant_id, offlineMode]);

  const upsertSinglePaymentIfNeeded = (nextTotal) => {
    const rounded = applyRounding(nextTotal);
    setPayments((prev) => {
      if (prev.length === 1) {
        return [{ ...prev[0], amount: rounded }];
      }
      return prev;
    });
  };

  const upsertVariantInCart = async ({ variant, quantity = 1, unitPrice = null }) => {
    setError('');
    const qtyToAdd = Math.max(1, Math.round(Number(quantity || 1)));
    const explicitUnitPrice = Number(unitPrice || 0);
    const initialUnitPrice = explicitUnitPrice > 0 ? explicitUnitPrice : Number(variant.price || 0);
    const taxResult = await getTaxInfoForVariant(tenant?.tenant_id, variant.variant_id);

    setCart((prev) => {
      const next = [...prev];
      const existingIndex = next.findIndex((line) => line.variant_id === variant.variant_id);

      if (existingIndex >= 0) {
        const line = { ...next[existingIndex] };
        line.quantity += qtyToAdd;
        if (explicitUnitPrice > 0) line.unit_price = explicitUnitPrice;
        const lineSubtotal = line.quantity * line.unit_price;
        const discountAmount = calculateDiscount(lineSubtotal, line.discount_line, line.discount_line_type);
        line.discount = discountAmount;
        applyLineTaxes(
          line,
          { success: true, rate: line.tax_rate, code: line.tax_code, name: line.tax_name },
          lineSubtotal - discountAmount,
        );
        next[existingIndex] = line;
      } else {
        const line = {
          variant_id: variant.variant_id,
          sku: variant.sku,
          productName: variant.product?.name || '',
          variantName: variant.variant_name || '',
          quantity: qtyToAdd,
          unit_price: initialUnitPrice,
          unit_cost: Number(variant.cost || 0),
          price_includes_tax: Boolean(variant.price_includes_tax),
          discount_line: 0,
          discount_line_type: 'AMOUNT',
          discount: 0,
          base_amount: 0,
          tax_amount: 0,
          tax_rate: 0,
          tax_code: null,
          tax_name: null,
          line_total: initialUnitPrice,
        };
        const lineSubtotal = line.quantity * line.unit_price;
        applyLineTaxes(line, taxResult, lineSubtotal);
        next.push(line);
      }

      upsertSinglePaymentIfNeeded(next.reduce((sum, l) => sum + (l.line_total || 0), 0));
      return next;
    });
  };

  const addToCart = async (variant) => {
    await upsertVariantInCart({ variant, quantity: 1 });
    setSearch('');
    setResults([]);
  };

  const scanInvoiceWithAgent = async () => {
    setError('');
    setMessage('');
    setInvoiceScanSummary(null);

    if (offlineMode) {
      setError('Escaneo de factura requiere conexion online.');
      return;
    }
    if (!tenant?.tenant_id) {
      setError('Tenant invalido para escaneo.');
      return;
    }

    let ImagePicker;
    try {
      ImagePicker = require('expo-image-picker');
    } catch (_e) {
      setError('Falta dependencia expo-image-picker. Instala y recompila la app.');
      return;
    }

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission?.granted && Platform.OS !== 'web') {
      setError('Permiso de camara denegado.');
      return;
    }

    const pickerOptions = {
      mediaTypes: ImagePicker.MediaTypeOptions?.Images ?? 'images',
      allowsEditing: false,
      quality: 0.6,
      base64: false,
      exif: false,
    };

    const capture = Platform.OS === 'web'
      ? await ImagePicker.launchImageLibraryAsync(pickerOptions)
      : await ImagePicker.launchCameraAsync(pickerOptions);

    if (capture?.canceled) return;

    const asset = capture?.assets?.[0];
    if (!asset?.uri) {
      setError('No se pudo obtener la imagen capturada.');
      return;
    }

    setProcessingInvoice(true);
    try {
      const imageResult = await buildOptimizedImageForOcr(asset);
      if (!imageResult.success) {
        setError(imageResult.error || 'No fue posible optimizar la imagen para OCR.');
        return;
      }

      const locationId = currentSession?.cash_register?.location_id || null;
      const catalogResult = await listCatalogForInvoiceMatching(tenant.tenant_id, locationId, 3500);
      if (!catalogResult.success || !catalogResult.data?.length) {
        setError(catalogResult.error || 'No hay catalogo disponible para matching.');
        return;
      }

      const aiResult = await analyzeInvoiceWithImage({
        tenantId: tenant.tenant_id,
        imageBase64: imageResult.data.base64,
        mimeType: imageResult.data.mimeType || 'image/jpeg',
      });
      if (!aiResult.success) {
        setError(aiResult.error || 'No fue posible analizar la factura.');
        return;
      }

      const { matched, unmatched } = matchInvoiceLinesToCatalog(
        aiResult.data.line_items,
        catalogResult.data,
      );

      const vendorName = String(aiResult?.data?.invoice?.vendor_name || '').trim();
      let customerSuggestion = null;
      let customerAutoloaded = false;
      if (vendorName.length >= 2) {
        const customerLookup = offlineMode
          ? await searchCustomersOffline(tenant.tenant_id, vendorName, 20)
          : await searchCustomers(tenant.tenant_id, vendorName, 20);
        const customerList = customerLookup.success ? customerLookup.data || [] : [];
        const bestCustomer = findBestCustomerMatch(vendorName, customerList);
        if (bestCustomer?.customer) {
          customerSuggestion = bestCustomer.customer;
          if (!selectedCustomer?.customer_id) {
            setSelectedCustomer(bestCustomer.customer);
            setSearchCustomer(bestCustomer.customer.full_name || '');
            setCustomers([]);
            customerAutoloaded = true;
          }
        } else if (!selectedCustomer?.customer_id && customerList.length) {
          setSearchCustomer(vendorName);
          setCustomers(customerList.slice(0, 6));
        }
      }

      if (!matched.length) {
        setError('La IA leyó la factura pero no encontró coincidencias con tu catalogo.');
        setInvoiceScanSummary({
          matchedCount: 0,
          unmatched,
          invoice: aiResult.data.invoice || {},
          customerSuggestion,
          customerAutoloaded,
        });
        return;
      }

      for (const item of matched) {
        await upsertVariantInCart({
          variant: item.variant,
          quantity: item.line.quantity || 1,
          unitPrice: null,
        });
      }

      setInvoiceScanSummary({
        matchedCount: matched.length,
        unmatched,
        invoice: aiResult.data.invoice || {},
        customerSuggestion,
        customerAutoloaded,
      });
      setMessage(
        `Factura procesada: ${matched.length} item(s) cargados al carrito${unmatched.length ? `, ${unmatched.length} sin match` : ''}.`,
      );
    } finally {
      setProcessingInvoice(false);
    }
  };

  const updateLineQuantity = (index, raw) => {
    const qty = Math.max(1, Number(raw || 1));
    setCart((prev) => {
      const next = [...prev];
      const line = { ...next[index] };
      line.quantity = qty;
      const lineSubtotal = line.quantity * line.unit_price;
      const discountAmount = calculateDiscount(lineSubtotal, line.discount_line, line.discount_line_type);
      line.discount = discountAmount;
      applyLineTaxes(line, { success: true, rate: line.tax_rate, code: line.tax_code, name: line.tax_name }, lineSubtotal - discountAmount);
      next[index] = line;
      upsertSinglePaymentIfNeeded(next.reduce((sum, l) => sum + (l.line_total || 0), 0));
      return next;
    });
  };

  const updateLineDiscount = (index, raw) => {
    const value = Math.max(0, Number(raw || 0));
    setCart((prev) => {
      const next = [...prev];
      const line = { ...next[index] };
      line.discount_line = value;
      const lineSubtotal = line.quantity * line.unit_price;
      const discountAmount = calculateDiscount(lineSubtotal, line.discount_line, line.discount_line_type);
      line.discount = discountAmount;
      applyLineTaxes(line, { success: true, rate: line.tax_rate, code: line.tax_code, name: line.tax_name }, lineSubtotal - discountAmount);
      next[index] = line;
      upsertSinglePaymentIfNeeded(next.reduce((sum, l) => sum + (l.line_total || 0), 0));
      return next;
    });
  };

  const toggleLineDiscountType = (index, type) => {
    setCart((prev) => {
      const next = [...prev];
      const line = { ...next[index] };
      line.discount_line_type = type;
      const lineSubtotal = line.quantity * line.unit_price;
      const discountAmount = calculateDiscount(lineSubtotal, line.discount_line, line.discount_line_type);
      line.discount = discountAmount;
      applyLineTaxes(line, { success: true, rate: line.tax_rate, code: line.tax_code, name: line.tax_name }, lineSubtotal - discountAmount);
      next[index] = line;
      upsertSinglePaymentIfNeeded(next.reduce((sum, l) => sum + (l.line_total || 0), 0));
      return next;
    });
  };

  const removeLine = (index) => {
    setCart((prev) => {
      const next = prev.filter((_, i) => i !== index);
      upsertSinglePaymentIfNeeded(next.reduce((sum, l) => sum + (l.line_total || 0), 0));
      return next;
    });
  };

  const addPayment = () => {
    setPayments((prev) => [
      ...prev,
      { method: paymentMethods[0]?.code || '', amount: remaining },
    ]);
  };

  const removePayment = (index) => {
    setPayments((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
  };

  const updatePayment = (index, patch) => {
    setPayments((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };

  const clearSale = () => {
    setCart([]);
    setSaleNote('');
    setSelectedCustomer(null);
    setSearchCustomer('');
    setCustomers([]);
    setSearch('');
    setResults([]);
    setMessage('');
    setError('');
    setPayments([{ method: paymentMethods[0]?.code || '', amount: 0 }]);
  };

  const handleProcessSale = async () => {
    setError('');
    setMessage('');

    if (!tenant?.tenant_id || !userProfile?.user_id) return;
    if (cart.length === 0) {
      setError('Agrega productos para continuar.');
      return;
    }
    if (remaining > 0) {
      setError(`Falta pago por ${formatMoney(remaining)}.`);
      return;
    }
    if (!currentSession?.cash_session_id) {
      setError('Debe abrir una caja antes de vender.');
      return;
    }
    if (payments.some((p) => !p.method || Number(p.amount || 0) <= 0)) {
      setError('Verifica metodos y montos de pago.');
      return;
    }

    setProcessing(true);
    try {
      const operationId = createOperationId();
      const lines = cart.map((line) => {
        const taxRate = line.tax_rate || 0;
        const inclTax = line.price_includes_tax && taxRate > 0;
        const factor = inclTax ? 1 + taxRate : 1;
        return {
          variant_id: line.variant_id,
          qty: line.quantity,
          unit_price: inclTax ? Math.round(line.unit_price / factor) : line.unit_price,
          discount: inclTax ? Math.round((line.discount || 0) / factor) : line.discount || 0,
          discount_type: 'AMOUNT',
        };
      });

      const adjustedPayments = [...payments];
      if (change > 0 && adjustedPayments.length > 0) {
        adjustedPayments[adjustedPayments.length - 1] = {
          ...adjustedPayments[adjustedPayments.length - 1],
          amount: Number(adjustedPayments[adjustedPayments.length - 1].amount || 0) - change,
        };
      }

      const paymentsPayload = adjustedPayments.map((p) => ({
        payment_method_code: p.method,
        amount: Number(p.amount || 0),
        reference: null,
      }));

      const payload = {
        location_id: currentSession?.cash_register?.location_id || null,
        cash_session_id: currentSession?.cash_session_id || null,
        customer_id: selectedCustomer?.customer_id || null,
        sold_by: userProfile.user_id,
        lines,
        payments: paymentsPayload,
        note: saleNote || null,
      };

      if (offlineMode) {
        const deviceId = await getOrCreateDeviceId();
        await enqueuePendingOp({
          opId: operationId,
          opType: 'CREATE_SALE',
          tenantId: tenant.tenant_id,
          userId: userProfile.user_id,
          deviceId,
          payload,
        });
        const pendingCount = await getPendingOpsCount();
        if (onPendingOpsChange) {
          onPendingOpsChange(pendingCount);
        }
        clearSale();
        setMessage(`Venta guardada offline. Pendientes por sincronizar: ${pendingCount}`);
        return;
      }

      const result = await createSale(tenant.tenant_id, {
        ...payload,
        operation_id: operationId,
      });

      if (!result.success) {
        if (isTransientNetworkError(result.error)) {
          const deviceId = await getOrCreateDeviceId();
          await enqueuePendingOp({
            opId: operationId,
            opType: 'CREATE_SALE',
            tenantId: tenant.tenant_id,
            userId: userProfile.user_id,
            deviceId,
            payload,
          });
          const pendingCount = await getPendingOpsCount();
          if (onPendingOpsChange) {
            onPendingOpsChange(pendingCount);
          }
          clearSale();
          setMessage(
            `Sin conexión estable. Venta encolada para sincronizar (${pendingCount} pendientes).`,
          );
          return;
        }
        setError(result.error || 'No se pudo procesar la venta.');
        return;
      }

      clearSale();
      const pendingCount = await getPendingOpsCount();
      if (onPendingOpsChange) {
        onPendingOpsChange(pendingCount);
      }
      setMessage(`Venta registrada. ID: ${result.data.sale_id}`);
      if (onSaleCompleted) {
        await onSaleCompleted();
      }
    } finally {
      setProcessing(false);
    }
  };

  if (loadingInit) {
    return (
      <View style={[styles.centered, isLightTheme && styles.centeredLight]}>
        <ActivityIndicator size="large" color="#38bdf8" />
        <Text style={[styles.centerText, isLightTheme && styles.centerTextLight]}>Inicializando POS...</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, isLightTheme && styles.titleLight]}>Punto de Venta</Text>
        <Text style={currentSession ? styles.sessionOk : styles.sessionWarn}>
          {currentSession
            ? `Caja: ${currentSession?.cash_register?.name || 'Activa'}`
            : 'Sin caja abierta'}
        </Text>
      </View>

      <View style={[styles.panel, isLightTheme && styles.panelLight]}>
        <View style={styles.invoiceAgentRow}>
          <Pressable
            onPress={scanInvoiceWithAgent}
            disabled={processingInvoice}
            style={[styles.invoiceAgentBtn, processingInvoice && styles.btnDisabled]}
          >
            <Text style={styles.invoiceAgentBtnText}>
              {processingInvoice ? 'Analizando factura...' : 'Escanear factura (IA)'}
            </Text>
          </Pressable>
        </View>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Buscar producto (codigo, SKU o nombre)"
          placeholderTextColor="#64748b"
          style={[styles.input, isLightTheme && styles.inputLight]}
        />
        {searchingProducts ? <Text style={[styles.metaText, isLightTheme && styles.metaTextLight]}>Buscando...</Text> : null}
        {results.slice(0, 8).map((item) => (
          <Pressable
            key={item.variant_id}
            style={[styles.resultRow, isLightTheme && styles.resultRowLight]}
            onPress={() => addToCart(item)}
          >
            <Text style={[styles.resultTitle, isLightTheme && styles.resultTitleLight]}>
              {item.product?.name} {item.variant_name ? `- ${item.variant_name}` : ''}
            </Text>
            <Text style={[styles.resultMeta, isLightTheme && styles.resultMetaLight]}>
              {item.sku} · {formatMoney(item.price)} · Stock: {item.stock_available ?? '-'}
            </Text>
          </Pressable>
        ))}
        {invoiceScanSummary ? (
          <View style={[styles.invoiceSummaryCard, isLightTheme && styles.invoiceSummaryCardLight]}>
            <Text style={[styles.invoiceSummaryTitle, isLightTheme && styles.invoiceSummaryTitleLight]}>
              Lectura factura
            </Text>
            <Text style={[styles.invoiceSummaryLine, isLightTheme && styles.invoiceSummaryLineLight]}>
              Cargados: {invoiceScanSummary.matchedCount || 0}
            </Text>
            {invoiceScanSummary?.invoice?.vendor_name ? (
              <Text style={[styles.invoiceSummaryLine, isLightTheme && styles.invoiceSummaryLineLight]}>
                Proveedor: {invoiceScanSummary.invoice.vendor_name}
              </Text>
            ) : null}
            {invoiceScanSummary?.customerSuggestion?.full_name ? (
              <Text style={[styles.invoiceSummaryLine, isLightTheme && styles.invoiceSummaryLineLight]}>
                Cliente sugerido: {invoiceScanSummary.customerSuggestion.full_name}
                {invoiceScanSummary.customerAutoloaded ? ' (cargado)' : ''}
              </Text>
            ) : null}
            {invoiceScanSummary?.unmatched?.length ? (
              <Text style={styles.invoiceSummaryWarn}>
                Sin match: {invoiceScanSummary.unmatched.slice(0, 3).map((x) => x.raw_name).join(' · ')}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={[styles.panel, isLightTheme && styles.panelLight]}>
        <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Cliente (opcional)</Text>
        <TextInput
          value={searchCustomer}
          onChangeText={setSearchCustomer}
          placeholder="Buscar cliente"
          placeholderTextColor="#64748b"
          style={[styles.input, isLightTheme && styles.inputLight]}
        />
        {searchingCustomers ? <Text style={[styles.metaText, isLightTheme && styles.metaTextLight]}>Buscando cliente...</Text> : null}
        {customers.slice(0, 6).map((c) => (
          <Pressable
            key={c.customer_id}
            style={[styles.resultRow, isLightTheme && styles.resultRowLight]}
            onPress={() => {
              setSelectedCustomer(c);
              setSearchCustomer(c.full_name || '');
              setCustomers([]);
            }}
          >
            <Text style={[styles.resultTitle, isLightTheme && styles.resultTitleLight]}>{c.full_name}</Text>
            <Text style={[styles.resultMeta, isLightTheme && styles.resultMetaLight]}>{c.document || c.phone || '-'}</Text>
          </Pressable>
        ))}
      </View>

      <View style={[styles.panel, isLightTheme && styles.panelLight]}>
        <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Carrito</Text>
        {cart.length === 0 ? <Text style={[styles.metaText, isLightTheme && styles.metaTextLight]}>Agrega productos para iniciar.</Text> : null}
        {cart.map((line, index) => (
          <View key={line.variant_id} style={[styles.lineCard, isLightTheme && styles.lineCardLight]}>
            <View style={styles.lineTop}>
              <Text style={[styles.lineTitle, isLightTheme && styles.lineTitleLight]}>{line.productName}</Text>
              <Pressable onPress={() => removeLine(index)}>
                <Text style={styles.removeBtn}>x</Text>
              </Pressable>
            </View>
            <Text style={[styles.resultMeta, isLightTheme && styles.resultMetaLight]}>{line.variantName || 'Predeterminado'} · {line.sku}</Text>
            <View style={styles.lineControls}>
              <TextInput
                value={String(line.quantity)}
                onChangeText={(v) => updateLineQuantity(index, v)}
                keyboardType="numeric"
                style={[styles.qtyInput, isLightTheme && styles.qtyInputLight]}
              />
              <Text style={[styles.linePrice, isLightTheme && styles.linePriceLight]}>{formatMoney(line.unit_price)}</Text>
              {isAdmin ? (
                <View style={styles.discountBox}>
                  <View style={styles.discountTypeRow}>
                    <Pressable
                      onPress={() => toggleLineDiscountType(index, 'AMOUNT')}
                      style={[
                        styles.discountTypeBtn,
                        isLightTheme && styles.discountTypeBtnLight,
                        line.discount_line_type === 'AMOUNT' && styles.discountTypeBtnActive,
                      ]}
                    >
                      <Text style={[styles.discountTypeText, isLightTheme && styles.discountTypeTextLight]}>$</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => toggleLineDiscountType(index, 'PERCENT')}
                      style={[
                        styles.discountTypeBtn,
                        isLightTheme && styles.discountTypeBtnLight,
                        line.discount_line_type === 'PERCENT' && styles.discountTypeBtnActive,
                      ]}
                    >
                      <Text style={[styles.discountTypeText, isLightTheme && styles.discountTypeTextLight]}>%</Text>
                    </Pressable>
                  </View>
                  <TextInput
                    value={String(line.discount_line || 0)}
                    onChangeText={(v) => updateLineDiscount(index, v)}
                    keyboardType="numeric"
                    style={[styles.discountInput, isLightTheme && styles.discountInputLight]}
                  />
                </View>
              ) : null}
            </View>
            <Text style={[styles.lineTotal, isLightTheme && styles.lineTotalLight]}>Total linea: {formatMoney(line.line_total)}</Text>
          </View>
        ))}
      </View>

      <View style={[styles.panel, isLightTheme && styles.panelLight]}>
        <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Totales</Text>
        <View style={styles.totalRow}><Text style={[styles.totalLabel, isLightTheme && styles.totalLabelLight]}>Subtotal</Text><Text style={[styles.totalValue, isLightTheme && styles.totalValueLight]}>{formatMoney(totals.subtotal)}</Text></View>
        {totals.discount > 0 ? (
          <View style={styles.totalRow}><Text style={[styles.totalLabel, isLightTheme && styles.totalLabelLight]}>Descuento</Text><Text style={[styles.totalValue, isLightTheme && styles.totalValueLight]}>-{formatMoney(totals.discount)}</Text></View>
        ) : null}
        <View style={styles.totalRow}><Text style={[styles.totalLabel, isLightTheme && styles.totalLabelLight]}>IVA</Text><Text style={[styles.totalValue, isLightTheme && styles.totalValueLight]}>{formatMoney(totals.tax)}</Text></View>
        {totals.roundingAdjustment !== 0 ? (
          <View style={styles.totalRow}>
            <Text style={[styles.totalLabel, isLightTheme && styles.totalLabelLight]}>Ajuste redondeo</Text>
            <Text style={[styles.totalValue, isLightTheme && styles.totalValueLight]}>{formatMoney(totals.roundingAdjustment)}</Text>
          </View>
        ) : null}
        <View style={styles.totalRowStrong}><Text style={[styles.totalStrong, isLightTheme && styles.totalStrongLight]}>TOTAL</Text><Text style={styles.totalStrongValue}>{formatMoney(totals.total)}</Text></View>
      </View>

      <View style={[styles.panel, isLightTheme && styles.panelLight]}>
        <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Formas de Pago</Text>
        {payments.map((p, i) => (
          <View key={`payment-${i}`} style={[styles.paymentRow, isLightTheme && styles.paymentRowLight]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.methodScroller}>
              <View style={styles.methodRow}>
                {paymentMethods.map((m) => (
                  <Pressable
                    key={`${i}-${m.code}`}
                    style={[styles.methodBtn, p.method === m.code && styles.methodBtnActive]}
                    onPress={() => updatePayment(i, { method: m.code })}
                  >
                    <Text style={[styles.methodBtnText, isLightTheme && styles.methodBtnTextLight]}>{m.name}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
            <TextInput
              value={String(p.amount || 0)}
              onChangeText={(v) => updatePayment(i, { amount: Number(v || 0) })}
              keyboardType="numeric"
              style={[styles.paymentInput, isLightTheme && styles.paymentInputLight]}
            />
            <Pressable onPress={() => removePayment(i)} style={styles.paymentRemove}>
              <Text style={styles.removeBtn}>x</Text>
            </Pressable>
          </View>
        ))}
        <Pressable onPress={addPayment} style={styles.addPaymentBtn}>
          <Text style={[styles.addPaymentText, isLightTheme && styles.addPaymentTextLight]}>+ Agregar pago</Text>
        </Pressable>
        {change > 0 ? <Text style={styles.okText}>Cambio: {formatMoney(change)}</Text> : null}
        {remaining > 0 ? <Text style={styles.warnText}>Falta: {formatMoney(remaining)}</Text> : null}
      </View>

      <View style={[styles.panel, isLightTheme && styles.panelLight]}>
        <TextInput
          value={saleNote}
          onChangeText={setSaleNote}
          placeholder="Nota (opcional)"
          placeholderTextColor="#64748b"
          style={[styles.input, isLightTheme && styles.inputLight]}
        />
      </View>

      {message ? <Text style={styles.okText}>{message}</Text> : null}
      {error ? <Text style={styles.warnText}>{error}</Text> : null}

      <Pressable
        onPress={handleProcessSale}
        disabled={processing || cart.length === 0 || remaining > 0}
        style={[styles.chargeBtn, (processing || cart.length === 0 || remaining > 0) && styles.btnDisabled]}
      >
        <Text style={styles.chargeText}>
          {processing
            ? 'Procesando...'
            : offlineMode
              ? `Guardar offline ${formatMoney(totals.total)}`
              : `Cobrar ${formatMoney(totals.total)}`}
        </Text>
      </Pressable>

      <Pressable onPress={clearSale} disabled={cart.length === 0} style={[styles.clearBtn, cart.length === 0 && styles.btnDisabled]}>
        <Text style={styles.clearText}>Limpiar</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    paddingBottom: 24,
    backgroundColor: '#0b0f14',
  },
  containerLight: {
    backgroundColor: '#f8fafc',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0b0f14',
  },
  centeredLight: {
    backgroundColor: '#f8fafc',
  },
  centerText: {
    marginTop: 10,
    color: '#cbd5e1',
  },
  centerTextLight: {
    color: '#475569',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '700',
  },
  titleLight: {
    color: '#0f172a',
  },
  sessionOk: {
    color: '#4ade80',
    fontSize: 12,
  },
  sessionWarn: {
    color: '#f59e0b',
    fontSize: 12,
  },
  panel: {
    marginBottom: 10,
    borderRadius: 12,
    backgroundColor: '#171b23',
    borderWidth: 1,
    borderColor: '#2a3240',
    padding: 10,
  },
  panelLight: {
    backgroundColor: '#ffffff',
    borderColor: '#dbe4ef',
  },
  invoiceAgentRow: {
    marginBottom: 8,
  },
  invoiceAgentBtn: {
    backgroundColor: '#1d4ed8',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  invoiceAgentBtnText: {
    color: '#eff6ff',
    fontWeight: '700',
    fontSize: 13,
  },
  invoiceSummaryCard: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    padding: 8,
    backgroundColor: '#0f172a',
  },
  invoiceSummaryCardLight: {
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
  },
  invoiceSummaryTitle: {
    color: '#bae6fd',
    fontWeight: '700',
    marginBottom: 4,
  },
  invoiceSummaryTitleLight: {
    color: '#0369a1',
  },
  invoiceSummaryLine: {
    color: '#cbd5e1',
    fontSize: 12,
    marginTop: 2,
  },
  invoiceSummaryLineLight: {
    color: '#334155',
  },
  invoiceSummaryWarn: {
    color: '#fca5a5',
    fontSize: 12,
    marginTop: 4,
  },
  sectionTitle: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  sectionTitleLight: {
    color: '#0f172a',
  },
  input: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginBottom: 6,
  },
  inputLight: {
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    color: '#0f172a',
  },
  metaText: {
    color: '#94a3b8',
    fontSize: 12,
  },
  metaTextLight: {
    color: '#64748b',
  },
  resultRow: {
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#243041',
  },
  resultRowLight: {
    borderTopColor: '#e2e8f0',
  },
  resultTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '600',
  },
  resultTitleLight: {
    color: '#0f172a',
  },
  resultMeta: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  resultMetaLight: {
    color: '#64748b',
  },
  lineCard: {
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    padding: 8,
    backgroundColor: '#111827',
  },
  lineCardLight: {
    borderColor: '#dbe4ef',
    backgroundColor: '#f8fafc',
  },
  lineTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lineTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    paddingRight: 8,
  },
  lineTitleLight: {
    color: '#0f172a',
  },
  removeBtn: {
    color: '#f87171',
    fontWeight: '800',
    fontSize: 16,
  },
  lineControls: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  qtyInput: {
    width: 58,
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 8,
    color: '#f8fafc',
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#0f172a',
  },
  qtyInputLight: {
    borderColor: '#cbd5e1',
    color: '#0f172a',
    backgroundColor: '#ffffff',
  },
  linePrice: {
    color: '#cbd5e1',
    width: 96,
  },
  linePriceLight: {
    color: '#475569',
  },
  discountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  discountTypeRow: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 8,
    overflow: 'hidden',
  },
  discountTypeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#0f172a',
  },
  discountTypeBtnLight: {
    backgroundColor: '#ffffff',
  },
  discountTypeBtnActive: {
    backgroundColor: '#2563eb',
  },
  discountTypeText: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '700',
  },
  discountTypeTextLight: {
    color: '#334155',
  },
  discountInput: {
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 8,
    color: '#f8fafc',
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#0f172a',
    minWidth: 62,
  },
  discountInputLight: {
    borderColor: '#cbd5e1',
    color: '#0f172a',
    backgroundColor: '#ffffff',
  },
  lineTotal: {
    color: '#e2e8f0',
    fontWeight: '700',
    marginTop: 8,
  },
  lineTotalLight: {
    color: '#0f172a',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  totalRowStrong: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 8,
  },
  totalLabel: {
    color: '#cbd5e1',
  },
  totalLabelLight: {
    color: '#475569',
  },
  totalValue: {
    color: '#f8fafc',
  },
  totalValueLight: {
    color: '#0f172a',
  },
  totalStrong: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: '800',
  },
  totalStrongLight: {
    color: '#0f172a',
  },
  totalStrongValue: {
    color: '#38bdf8',
    fontSize: 34,
    fontWeight: '800',
    lineHeight: 38,
  },
  paymentRow: {
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 8,
    backgroundColor: '#0f172a',
  },
  paymentRowLight: {
    borderColor: '#dbe4ef',
    backgroundColor: '#f8fafc',
  },
  methodScroller: {
    marginBottom: 8,
  },
  methodRow: {
    flexDirection: 'row',
    gap: 6,
  },
  methodBtn: {
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  methodBtnActive: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  methodBtnText: {
    color: '#f8fafc',
    fontSize: 12,
  },
  methodBtnTextLight: {
    color: '#334155',
  },
  paymentInput: {
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 8,
    color: '#f8fafc',
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: '#111827',
  },
  paymentInputLight: {
    borderColor: '#cbd5e1',
    color: '#0f172a',
    backgroundColor: '#ffffff',
  },
  paymentRemove: {
    position: 'absolute',
    right: 8,
    top: 8,
  },
  addPaymentBtn: {
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  addPaymentText: {
    color: '#e2e8f0',
    fontWeight: '700',
  },
  addPaymentTextLight: {
    color: '#334155',
  },
  okText: {
    color: '#4ade80',
    marginBottom: 8,
  },
  warnText: {
    color: '#f87171',
    marginBottom: 8,
  },
  chargeBtn: {
    backgroundColor: '#0ea5e9',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginBottom: 8,
  },
  chargeText: {
    color: '#082f49',
    fontWeight: '800',
    fontSize: 17,
  },
  clearBtn: {
    backgroundColor: '#3f1d2e',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  clearText: {
    color: '#fca5a5',
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
