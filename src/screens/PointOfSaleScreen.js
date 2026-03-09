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
import { Ionicons } from '@expo/vector-icons';
import { useThemeMode } from '../lib/themeMode';
import {
  createSale,
  findVariantByCode,
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
import {
  cancelVoskTranscription,
  ensureEmbeddedModelReady,
  getEmbeddedLlmStatus,
  getEmbeddedModelStatus,
  getCommandEngineMetrics,
  isVoskSttAvailable,
  resolveSaleCommandFromText,
  transcribeWithVosk,
} from '../services/commandEngine';
import { enqueuePendingOp, getPendingOpsCount } from '../storage/sqlite/database';
import { getOrCreateDeviceId } from '../services/device.service';
import { getSimpleCache, saveSimpleCache } from '../services/offlineCache.service';

const OCR_MAX_BYTES = 980 * 1024;
const QUICK_CASH_AMOUNTS = [5000, 10000, 20000, 50000];

function favoritesCacheKey(tenantId, userId) {
  return `pos-favorites:${tenantId}:${userId}`;
}

function draftsCacheKey(tenantId, userId) {
  return `pos-ticket-drafts:${tenantId}:${userId}`;
}

function normalizeLookupText(value) {
  return String(value || '').trim().toLowerCase();
}

function isCashMethodCode(code) {
  const value = normalizeLookupText(code);
  return (
    value === 'cash' ||
    value === 'efectivo' ||
    value === 'cash_efectivo'
  );
}

function isLikelyScannerInput(value) {
  const text = String(value || '').trim();
  if (text.length < 4) return false;
  if (text.includes(' ')) return false;
  return /^[a-z0-9._-]+$/i.test(text);
}

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
  const [favoriteVariants, setFavoriteVariants] = useState([]);
  const [ticketDrafts, setTicketDrafts] = useState([]);
  const [cart, setCart] = useState([]);
  const [searchCustomer, setSearchCustomer] = useState('');
  const [searchingCustomers, setSearchingCustomers] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [payments, setPayments] = useState([{ method: '', amount: 0, reference: '' }]);
  const [currentSession, setCurrentSession] = useState(null);
  const [saleNote, setSaleNote] = useState('');
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [processingInvoice, setProcessingInvoice] = useState(false);
  const [invoiceScanSummary, setInvoiceScanSummary] = useState(null);
  const [chatOrderText, setChatOrderText] = useState('');
  const [processingChatOrder, setProcessingChatOrder] = useState(false);
  const [chatOrderSummary, setChatOrderSummary] = useState(null);
  const [processingVoiceOrder, setProcessingVoiceOrder] = useState(false);
  const [voicePreviewText, setVoicePreviewText] = useState('');
  const [commandEngineMetrics, setCommandEngineMetrics] = useState(null);
  const [embeddedLlmStatus, setEmbeddedLlmStatus] = useState(null);
  const [preparingEmbeddedLlm, setPreparingEmbeddedLlm] = useState(false);
  const [embeddedDownloadProgress, setEmbeddedDownloadProgress] = useState(0);
  const [showAiTools, setShowAiTools] = useState(false);

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

  const effectiveThirdPartyId = selectedCustomer?.customer_id || null;
  const voiceAvailable = useMemo(() => isVoskSttAvailable(), []);
  const localLlmMode = useMemo(
    () => String(process.env.EXPO_PUBLIC_LOCAL_LLM_MODE || 'auto').trim().toLowerCase(),
    [],
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
            setPayments([{ method: pm.data[0].code, amount: 0, reference: '' }]);
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

  useEffect(() => {
    let active = true;
    const loadLocalState = async () => {
      const tenantId = tenant?.tenant_id;
      const userId = userProfile?.user_id;
      if (!tenantId || !userId) return;

      const [favoritesCached, draftsCached] = await Promise.all([
        getSimpleCache(favoritesCacheKey(tenantId, userId)),
        getSimpleCache(draftsCacheKey(tenantId, userId)),
      ]);

      if (!active) return;
      setFavoriteVariants(Array.isArray(favoritesCached?.value) ? favoritesCached.value : []);
      setTicketDrafts(Array.isArray(draftsCached?.value) ? draftsCached.value : []);
    };

    loadLocalState();
    return () => {
      active = false;
    };
  }, [tenant?.tenant_id, userProfile?.user_id]);

  useEffect(() => {
    const tenantId = tenant?.tenant_id;
    const userId = userProfile?.user_id;
    if (!tenantId || !userId) return;
    saveSimpleCache(favoritesCacheKey(tenantId, userId), favoriteVariants);
  }, [favoriteVariants, tenant?.tenant_id, userProfile?.user_id]);

  useEffect(() => {
    const tenantId = tenant?.tenant_id;
    const userId = userProfile?.user_id;
    if (!tenantId || !userId) return;
    saveSimpleCache(draftsCacheKey(tenantId, userId), ticketDrafts);
  }, [ticketDrafts, tenant?.tenant_id, userProfile?.user_id]);

  useEffect(() => {
    if (!tenant?.tenant_id) return;
    getCommandEngineMetrics(tenant.tenant_id).then((result) => {
      if (result.success) {
        setCommandEngineMetrics(result.data);
      }
    });
  }, [tenant?.tenant_id]);

  useEffect(() => {
    refreshEmbeddedLlmStatus();
  }, []);

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

  const isFavoriteVariant = (variantId) => {
    return favoriteVariants.some((variant) => variant.variant_id === variantId);
  };

  const toggleFavoriteVariant = (variant) => {
    if (!variant?.variant_id) return;
    setFavoriteVariants((prev) => {
      const exists = prev.some((item) => item.variant_id === variant.variant_id);
      if (exists) {
        return prev.filter((item) => item.variant_id !== variant.variant_id);
      }
      const payload = {
        variant_id: variant.variant_id,
        sku: variant.sku || '',
        variant_name: variant.variant_name || '',
        product: { name: variant.product?.name || '' },
        cost: Number(variant.cost || 0),
        price: Number(variant.price || 0),
        price_includes_tax: Boolean(variant.price_includes_tax),
      };
      return [payload, ...prev].slice(0, 24);
    });
  };

  const handleSearchInputSubmit = async () => {
    const code = String(search || '').trim();
    if (!isLikelyScannerInput(code)) return;
    if (!tenant?.tenant_id) {
      setError('Tenant invalido para busqueda por codigo.');
      return;
    }
    setError('');
    setMessage('');
    const locationId = currentSession?.cash_register?.location_id || null;
    const result = await findVariantByCode(tenant?.tenant_id, code, locationId, { offlineMode });
    if (!result.success || !result.data) {
      setError(result.error || `No se encontro producto para el codigo ${code}.`);
      return;
    }
    await upsertVariantInCart({ variant: result.data, quantity: 1 });
    setMessage(`Producto agregado por codigo: ${result.data.product?.name || result.data.sku || code}.`);
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

  const refreshEngineMetrics = async () => {
    if (!tenant?.tenant_id) return;
    const metricsResult = await getCommandEngineMetrics(tenant.tenant_id);
    if (metricsResult.success) {
      setCommandEngineMetrics(metricsResult.data);
    }
  };

  const refreshEmbeddedLlmStatus = async () => {
    const [modelStatusResult, runtimeStatusResult] = await Promise.all([
      getEmbeddedModelStatus(),
      getEmbeddedLlmStatus(),
    ]);

    setEmbeddedLlmStatus({
      model: modelStatusResult?.success ? modelStatusResult : null,
      runtime: runtimeStatusResult?.success ? runtimeStatusResult?.data || null : null,
    });
  };

  const handlePrepareEmbeddedLlm = async () => {
    setError('');
    setMessage('');
    setPreparingEmbeddedLlm(true);
    setEmbeddedDownloadProgress(0);
    try {
      const result = await ensureEmbeddedModelReady({
        onProgress: ({ progress }) => {
          setEmbeddedDownloadProgress(Number(progress || 0));
        },
      });

      if (!result.success) {
        setError(result.error || 'No fue posible preparar el modelo local.');
        return;
      }

      const modelMb = Number(
        result.mb || (Number.isFinite(Number(result.bytes)) ? (Number(result.bytes) / (1024 * 1024)).toFixed(2) : 0),
      );
      setMessage(
        result.downloaded
          ? `Modelo local listo (${modelMb} MB).`
          : 'Modelo local ya estaba disponible.',
      );
    } finally {
      setPreparingEmbeddedLlm(false);
      await refreshEmbeddedLlmStatus();
    }
  };

  const runCommandToCart = async ({ commandText, inputType = 'text' }) => {
    const text = String(commandText || '').trim();
    if (!tenant?.tenant_id) {
      setError('Tenant invalido para conversion de comando.');
      return false;
    }
    if (!text) {
      setError('No hay texto de comando para procesar.');
      return false;
    }

    const locationId = currentSession?.cash_register?.location_id || null;
    const catalogResult = await listCatalogForInvoiceMatching(tenant.tenant_id, locationId, 3500);
    if (!catalogResult.success || !catalogResult.data?.length) {
      setError(catalogResult.error || 'No hay catalogo disponible para matching.');
      return false;
    }

    const aiResult = await resolveSaleCommandFromText({
      tenantId: tenant.tenant_id,
      inputText: text,
      inputType,
      offlineMode,
      catalogFingerprint: locationId || 'no-location',
    });
    if (!aiResult.success) {
      setError(aiResult.error || 'No fue posible convertir el comando.');
      await refreshEngineMetrics();
      return false;
    }

    const { matched, unmatched } = matchInvoiceLinesToCatalog(
      aiResult.data.line_items,
      catalogResult.data,
    );

    const customerName = String(aiResult?.data?.order?.customer_name || '').trim();
    let customerSuggestion = null;
    let customerAutoloaded = false;
    if (customerName.length >= 2) {
      const customerLookup = offlineMode
        ? await searchCustomersOffline(tenant.tenant_id, customerName, 20)
        : await searchCustomers(tenant.tenant_id, customerName, 20);
      const customerList = customerLookup.success ? customerLookup.data || [] : [];
      const bestCustomer = findBestCustomerMatch(customerName, customerList);
      if (bestCustomer?.customer) {
        customerSuggestion = bestCustomer.customer;
        if (!selectedCustomer?.customer_id) {
          setSelectedCustomer(bestCustomer.customer);
          setSearchCustomer(bestCustomer.customer.full_name || '');
          setCustomers([]);
          customerAutoloaded = true;
        }
      } else if (!selectedCustomer?.customer_id && customerList.length) {
        setSearchCustomer(customerName);
        setCustomers(customerList.slice(0, 6));
      }
    }

    if (!matched.length) {
      setError('El motor interpreto el comando pero no encontro coincidencias en catalogo.');
      setChatOrderSummary({
        matchedCount: 0,
        unmatched,
        confidence: Number(aiResult?.data?.order?.confidence || 0),
        customerSuggestion,
        customerAutoloaded,
        notes: aiResult?.data?.order?.notes || null,
      });
      await refreshEngineMetrics();
      return false;
    }

    for (const item of matched) {
      await upsertVariantInCart({
        variant: item.variant,
        quantity: item.line.quantity || 1,
        unitPrice: null,
      });
    }

    const aiNotes = String(aiResult?.data?.order?.notes || '').trim();
    if (aiNotes) {
      setSaleNote((prev) => {
        const previous = String(prev || '').trim();
        if (!previous) return aiNotes;
        if (previous.includes(aiNotes)) return previous;
        return `${previous}\n${aiNotes}`;
      });
    }

    setChatOrderSummary({
      matchedCount: matched.length,
      unmatched,
      confidence: Number(aiResult?.data?.order?.confidence || 0),
      customerSuggestion,
      customerAutoloaded,
      notes: aiResult?.data?.order?.notes || null,
    });

    const source = aiResult?.data?.engine?.source || 'engine';
    const sourceLabel = source === 'local_cache'
      ? 'cache local'
      : source === 'deterministic_parser'
        ? 'parser local'
        : source === 'local_llm'
          ? 'llm local'
          : source === 'cloud_llm'
            ? 'llm cloud'
            : source;
    setMessage(
      `Comando convertido (${inputType}): ${matched.length} item(s)${unmatched.length ? `, ${unmatched.length} sin match` : ''}${aiResult?.data?.cache_hit ? ' (cache)' : ''} · via ${sourceLabel}.`,
    );
    await refreshEngineMetrics();
    return true;
  };

  const parseChatOrderWithAgent = async () => {
    setError('');
    setMessage('');
    setChatOrderSummary(null);

    if (processingVoiceOrder) {
      setError('Finaliza o cancela la captura de voz antes de convertir texto.');
      return;
    }
    if (!chatOrderText.trim()) {
      setError('Pega o escribe el pedido del chat.');
      return;
    }

    setProcessingChatOrder(true);
    try {
      await runCommandToCart({
        commandText: chatOrderText,
        inputType: 'text',
      });
    } finally {
      setProcessingChatOrder(false);
      setChatOrderText('');
    }
  };

  const parseVoiceOrderWithVosk = async () => {
    setError('');
    setMessage('');
    setChatOrderSummary(null);

    if (!voiceAvailable) {
      setError('Vosk no esta disponible en este build. Requiere dev-client con modulo nativo.');
      return;
    }

    if (processingVoiceOrder) {
      await cancelVoskTranscription();
      setProcessingVoiceOrder(false);
      return;
    }

    setProcessingVoiceOrder(true);
    setVoicePreviewText('');
    try {
      const voiceResult = await transcribeWithVosk({
        timeoutMs: 7000,
        onPartialText: (partial) => setVoicePreviewText(String(partial || '')),
      });

      if (!voiceResult.success) {
        setError(voiceResult.error || 'No fue posible transcribir voz con Vosk.');
        return;
      }

      const transcript = String(voiceResult?.data?.text || '').trim();
      if (!transcript) {
        setError('No se detecto comando de voz.');
        return;
      }

      setVoicePreviewText(transcript);
      setChatOrderText(transcript);
      await runCommandToCart({
        commandText: transcript,
        inputType: 'voice',
      });
    } finally {
      setProcessingVoiceOrder(false);
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
      { method: paymentMethods[0]?.code || '', amount: remaining, reference: '' },
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

  const applyQuickCash = (amount) => {
    const value = Math.max(0, Number(amount || 0));
    if (value <= 0) return;
    setPayments((prev) => {
      if (!prev.length) return prev;
      const cashIndex = prev.findIndex((payment) => isCashMethodCode(payment.method));
      const index = cashIndex >= 0 ? cashIndex : 0;
      const next = [...prev];
      next[index] = {
        ...next[index],
        amount: Number(next[index].amount || 0) + value,
      };
      return next;
    });
  };

  const setCashExact = () => {
    setPayments((prev) => {
      if (!prev.length) return prev;
      const cashIndex = prev.findIndex((payment) => isCashMethodCode(payment.method));
      const index = cashIndex >= 0 ? cashIndex : 0;
      const next = [...prev];
      next[index] = {
        ...next[index],
        amount: totals.total,
      };
      return next;
    });
  };

  const holdCurrentTicket = () => {
    if (!cart.length) {
      setError('No hay items para guardar en espera.');
      return;
    }
    const draftId = createOperationId();
    const draft = {
      draft_id: draftId,
      created_at: new Date().toISOString(),
      customer: selectedCustomer
        ? {
          customer_id: selectedCustomer.customer_id,
          full_name: selectedCustomer.full_name || '',
          document: selectedCustomer.document || '',
        }
        : null,
      search_customer: searchCustomer,
      sale_note: saleNote,
      cart,
      payments,
    };
    setTicketDrafts((prev) => [draft, ...prev].slice(0, 12));
    clearSale();
    setMessage(`Venta en espera guardada (${ticketDrafts.length + 1} borradores).`);
  };

  const resumeTicketDraft = (draftId) => {
    const draft = ticketDrafts.find((item) => item.draft_id === draftId);
    if (!draft) return;

    setCart(Array.isArray(draft.cart) ? draft.cart : []);
    setPayments(
      Array.isArray(draft.payments) && draft.payments.length > 0
        ? draft.payments.map((p) => ({
          method: p.method || paymentMethods[0]?.code || '',
          amount: Number(p.amount || 0),
          reference: p.reference || '',
        }))
        : [{ method: paymentMethods[0]?.code || '', amount: 0, reference: '' }],
    );
    setSelectedCustomer(draft.customer || null);
    setSearchCustomer(draft.search_customer || draft.customer?.full_name || '');
    setSaleNote(draft.sale_note || '');
    setTicketDrafts((prev) => prev.filter((item) => item.draft_id !== draftId));
    setMessage('Venta recuperada desde espera.');
  };

  const discardTicketDraft = (draftId) => {
    setTicketDrafts((prev) => prev.filter((item) => item.draft_id !== draftId));
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
    setChatOrderText('');
    setChatOrderSummary(null);
    setVoicePreviewText('');
    setPayments([{ method: paymentMethods[0]?.code || '', amount: 0, reference: '' }]);
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
        reference: String(p.reference || '').trim() || null,
      }));

      const payload = {
        location_id: currentSession?.cash_register?.location_id || null,
        cash_session_id: currentSession?.cash_session_id || null,
        customer_id: selectedCustomer?.customer_id || null,
        third_party_id: effectiveThirdPartyId,
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
        <View style={styles.aiHeaderRow}>
          <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Items</Text>
          <Pressable
            onPress={() => setShowAiTools((prev) => !prev)}
            style={[styles.aiToggleBtn, isLightTheme && styles.aiToggleBtnLight]}
          >
            <View style={styles.btnContentRow}>
              <Ionicons
                name={showAiTools ? 'sparkles' : 'sparkles-outline'}
                size={14}
                color={isLightTheme ? '#0369a1' : '#bae6fd'}
              />
              <Text style={[styles.aiToggleText, isLightTheme && styles.aiToggleTextLight]}>
                {showAiTools ? 'IA Ocultar' : 'IA'}
              </Text>
            </View>
          </Pressable>
        </View>
        {showAiTools ? (
          <View style={styles.aiToolsWrap}>
            <View style={styles.invoiceAgentRow}>
              <Pressable
                onPress={scanInvoiceWithAgent}
                disabled={processingInvoice}
                style={[styles.invoiceAgentBtn, processingInvoice && styles.btnDisabled]}
              >
                <View style={styles.btnContentRow}>
                  <Ionicons name="camera-outline" size={16} color="#eff6ff" />
                  <Text style={styles.invoiceAgentBtnText}>
                    {processingInvoice ? 'Analizando factura...' : 'Escanear factura (IA)'}
                  </Text>
                </View>
              </Pressable>
            </View>
            <TextInput
              value={chatOrderText}
              onChangeText={setChatOrderText}
              placeholder="Pega pedido por chat. Ej: para Ana 2 cocas 350ml y 1 arroz diana 500"
              placeholderTextColor="#64748b"
              multiline
              numberOfLines={3}
              style={[styles.input, styles.chatOrderInput, isLightTheme && styles.inputLight]}
            />
            <Pressable
              onPress={parseChatOrderWithAgent}
              disabled={processingChatOrder || processingVoiceOrder}
              style={[styles.chatOrderBtn, (processingChatOrder || processingVoiceOrder) && styles.btnDisabled]}
            >
              <View style={styles.btnContentRow}>
                <Ionicons name="chatbubble-ellipses-outline" size={16} color="#ecfeff" />
                <Text style={styles.chatOrderBtnText}>
                  {processingChatOrder ? 'Convirtiendo chat...' : 'Convertir chat a venta (IA)'}
                </Text>
              </View>
            </Pressable>
            <Pressable
              onPress={parseVoiceOrderWithVosk}
              disabled={!voiceAvailable || processingChatOrder}
              style={[
                styles.voiceOrderBtn,
                (!voiceAvailable || processingChatOrder) && styles.btnDisabled,
                processingVoiceOrder && styles.voiceOrderBtnActive,
              ]}
            >
              <View style={styles.btnContentRow}>
                <Ionicons name="mic-outline" size={16} color="#ecfeff" />
                <Text style={styles.voiceOrderBtnText}>
                  {!voiceAvailable
                    ? 'Voz no disponible (Vosk)'
                    : processingVoiceOrder
                      ? 'Escuchando... tocar para cancelar'
                      : 'Comando por voz (Vosk)'}
                </Text>
              </View>
            </Pressable>
            {voicePreviewText ? (
              <Text style={[styles.voicePreviewText, isLightTheme && styles.voicePreviewTextLight]}>
                Voz: {voicePreviewText}
              </Text>
            ) : null}
            <View style={[styles.embeddedLlmCard, isLightTheme && styles.embeddedLlmCardLight]}>
              <Text style={[styles.embeddedLlmTitle, isLightTheme && styles.embeddedLlmTitleLight]}>
                LLM Local Qwen (modo: {localLlmMode})
              </Text>
              <Text style={[styles.embeddedLlmMeta, isLightTheme && styles.embeddedLlmMetaLight]}>
                Runtime: {embeddedLlmStatus?.runtime?.runtime_available ? 'Disponible' : 'No disponible'}
              </Text>
              <Text style={[styles.embeddedLlmMeta, isLightTheme && styles.embeddedLlmMetaLight]}>
                Modelo:{' '}
                {embeddedLlmStatus?.model?.available
                  ? `${Number(embeddedLlmStatus?.model?.mb || 0)} MB listo`
                  : 'No descargado'}
              </Text>
              {preparingEmbeddedLlm ? (
                <Text style={[styles.embeddedLlmMeta, isLightTheme && styles.embeddedLlmMetaLight]}>
                  Descargando modelo... {Math.round(embeddedDownloadProgress * 100)}%
                </Text>
              ) : null}
              <Pressable
                onPress={handlePrepareEmbeddedLlm}
                disabled={preparingEmbeddedLlm}
                style={[styles.embeddedLlmBtn, preparingEmbeddedLlm && styles.btnDisabled]}
              >
                <View style={styles.btnContentRow}>
                  <Ionicons name="download-outline" size={16} color="#ecfeff" />
                  <Text style={styles.embeddedLlmBtnText}>
                    {preparingEmbeddedLlm ? 'Preparando modelo...' : 'Descargar/actualizar modelo local'}
                  </Text>
                </View>
              </Pressable>
            </View>
          </View>
        ) : null}
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Buscar producto (codigo, SKU o nombre). Lector: escanear + Enter"
          placeholderTextColor="#64748b"
          style={[styles.input, isLightTheme && styles.inputLight]}
          onSubmitEditing={handleSearchInputSubmit}
        />
        {favoriteVariants.length > 0 ? (
          <View style={styles.favoritesWrap}>
            <Text style={[styles.metaText, isLightTheme && styles.metaTextLight]}>Favoritos</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.favoritesRow}>
                {favoriteVariants.map((fav) => (
                  <Pressable
                    key={`fav-${fav.variant_id}`}
                    style={[styles.favoriteChip, isLightTheme && styles.favoriteChipLight]}
                    onPress={() => addToCart(fav)}
                  >
                    <Text style={[styles.favoriteChipText, isLightTheme && styles.favoriteChipTextLight]}>
                      {fav.product?.name || fav.variant_name || fav.sku}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </View>
        ) : null}
        {searchingProducts ? <Text style={[styles.metaText, isLightTheme && styles.metaTextLight]}>Buscando...</Text> : null}
        {results.slice(0, 8).map((item) => (
          <View key={item.variant_id} style={[styles.resultRow, isLightTheme && styles.resultRowLight]}>
            <Pressable onPress={() => addToCart(item)} style={styles.resultInfoCol}>
              <Text style={[styles.resultTitle, isLightTheme && styles.resultTitleLight]}>
                {item.product?.name} {item.variant_name ? `- ${item.variant_name}` : ''}
              </Text>
              <Text style={[styles.resultMeta, isLightTheme && styles.resultMetaLight]}>
                {item.sku} · {formatMoney(item.price)} · Stock: {item.stock_available ?? '-'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => toggleFavoriteVariant(item)}
              style={[styles.favoriteBtn, isFavoriteVariant(item.variant_id) && styles.favoriteBtnActive]}
            >
              <Ionicons
                name={isFavoriteVariant(item.variant_id) ? 'star' : 'star-outline'}
                size={14}
                color={isFavoriteVariant(item.variant_id) ? '#fef08a' : '#cbd5e1'}
              />
            </Pressable>
          </View>
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
        {chatOrderSummary ? (
          <View style={[styles.invoiceSummaryCard, isLightTheme && styles.invoiceSummaryCardLight]}>
            <Text style={[styles.invoiceSummaryTitle, isLightTheme && styles.invoiceSummaryTitleLight]}>
              Conversion chat
            </Text>
            <Text style={[styles.invoiceSummaryLine, isLightTheme && styles.invoiceSummaryLineLight]}>
              Cargados: {chatOrderSummary.matchedCount || 0}
            </Text>
            <Text style={[styles.invoiceSummaryLine, isLightTheme && styles.invoiceSummaryLineLight]}>
              Confianza IA: {Math.round(Number(chatOrderSummary.confidence || 0) * 100)}%
            </Text>
            {chatOrderSummary?.customerSuggestion?.full_name ? (
              <Text style={[styles.invoiceSummaryLine, isLightTheme && styles.invoiceSummaryLineLight]}>
                Cliente sugerido: {chatOrderSummary.customerSuggestion.full_name}
                {chatOrderSummary.customerAutoloaded ? ' (cargado)' : ''}
              </Text>
            ) : null}
            {chatOrderSummary?.notes ? (
              <Text style={[styles.invoiceSummaryLine, isLightTheme && styles.invoiceSummaryLineLight]}>
                Nota IA: {chatOrderSummary.notes}
              </Text>
            ) : null}
            {chatOrderSummary?.unmatched?.length ? (
              <Text style={styles.invoiceSummaryWarn}>
                Sin match: {chatOrderSummary.unmatched.slice(0, 3).map((x) => x.raw_name).join(' · ')}
              </Text>
            ) : null}
            {commandEngineMetrics?.totals?.requests > 0 ? (
              <Text style={[styles.invoiceSummaryLine, isLightTheme && styles.invoiceSummaryLineLight]}>
                Engine hit-rate cache: {Math.round(Number(commandEngineMetrics?.totals?.hit_rate || 0) * 100)}%
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
        <View style={styles.feSummaryRow}>
          <Text style={[styles.metaText, isLightTheme && styles.metaTextLight]}>
            Documento a emitir: {effectiveThirdPartyId ? 'FE' : 'FV'}
          </Text>
        </View>
      </View>

      <View style={[styles.panel, isLightTheme && styles.panelLight]}>
        <View style={styles.aiHeaderRow}>
          <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Ventas en espera</Text>
          <Pressable
            onPress={holdCurrentTicket}
            disabled={cart.length === 0}
            style={[styles.holdBtn, cart.length === 0 && styles.btnDisabled]}
          >
            <View style={styles.btnContentRow}>
              <Ionicons name="pause-circle-outline" size={14} color="#ecfeff" />
              <Text style={styles.holdBtnText}>Guardar en espera</Text>
            </View>
          </Pressable>
        </View>
        {!ticketDrafts.length ? (
          <Text style={[styles.metaText, isLightTheme && styles.metaTextLight]}>
            Sin borradores en espera.
          </Text>
        ) : (
          ticketDrafts.slice(0, 4).map((draft) => (
            <View key={draft.draft_id} style={[styles.draftRow, isLightTheme && styles.draftRowLight]}>
              <View style={styles.draftInfo}>
                <Text style={[styles.resultTitle, isLightTheme && styles.resultTitleLight]}>
                  {draft.customer?.full_name || 'Consumidor final'} · {draft.cart?.length || 0} item(s)
                </Text>
                <Text style={[styles.resultMeta, isLightTheme && styles.resultMetaLight]}>
                  {new Date(draft.created_at).toLocaleString()}
                </Text>
              </View>
              <View style={styles.draftActions}>
                <Pressable style={[styles.actionMiniBtn, styles.detailMiniBtn]} onPress={() => resumeTicketDraft(draft.draft_id)}>
                  <Text style={styles.actionMiniText}>Retomar</Text>
                </Pressable>
                <Pressable style={[styles.actionMiniBtn, styles.removeMiniBtn]} onPress={() => discardTicketDraft(draft.draft_id)}>
                  <Text style={styles.actionMiniText}>Quitar</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
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
            <TextInput
              value={String(p.reference || '')}
              onChangeText={(v) => updatePayment(i, { reference: v })}
              placeholder="Referencia (opcional)"
              placeholderTextColor="#64748b"
              style={[styles.paymentRefInput, isLightTheme && styles.paymentInputLight]}
            />
            <Pressable onPress={() => removePayment(i)} style={styles.paymentRemove}>
              <Text style={styles.removeBtn}>x</Text>
            </Pressable>
          </View>
        ))}
        <Pressable onPress={addPayment} style={styles.addPaymentBtn}>
          <View style={styles.btnContentRow}>
            <Ionicons name="add-circle-outline" size={16} color={isLightTheme ? '#334155' : '#e2e8f0'} />
            <Text style={[styles.addPaymentText, isLightTheme && styles.addPaymentTextLight]}>Agregar pago</Text>
          </View>
        </Pressable>
        <View style={styles.quickCashWrap}>
          <Pressable onPress={setCashExact} style={[styles.quickCashBtn, styles.quickCashExactBtn]}>
            <Text style={styles.quickCashText}>Exacto</Text>
          </Pressable>
          {QUICK_CASH_AMOUNTS.map((value) => (
            <Pressable key={`cash-${value}`} onPress={() => applyQuickCash(value)} style={styles.quickCashBtn}>
              <Text style={styles.quickCashText}>+{formatMoney(value)}</Text>
            </Pressable>
          ))}
        </View>
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
        <View style={styles.btnContentRow}>
          <Ionicons name={offlineMode ? 'cloud-upload-outline' : 'card-outline'} size={18} color="#082f49" />
          <Text style={styles.chargeText}>
            {processing
              ? 'Procesando...'
              : offlineMode
                ? `Guardar offline ${formatMoney(totals.total)}`
                : `Cobrar ${formatMoney(totals.total)}`}
          </Text>
        </View>
      </Pressable>

      <Pressable onPress={clearSale} disabled={cart.length === 0} style={[styles.clearBtn, cart.length === 0 && styles.btnDisabled]}>
        <View style={styles.btnContentRow}>
          <Ionicons name="trash-outline" size={16} color="#fca5a5" />
          <Text style={styles.clearText}>Limpiar</Text>
        </View>
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
  btnContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  aiHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  aiToggleBtn: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#0f172a',
  },
  aiToggleBtnLight: {
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
  },
  aiToggleText: {
    color: '#bae6fd',
    fontSize: 12,
    fontWeight: '700',
  },
  aiToggleTextLight: {
    color: '#0369a1',
  },
  aiToolsWrap: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    padding: 8,
    marginBottom: 8,
    backgroundColor: '#0f172a',
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
  chatOrderInput: {
    minHeight: 74,
    textAlignVertical: 'top',
  },
  chatOrderBtn: {
    backgroundColor: '#0f766e',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 8,
  },
  chatOrderBtnText: {
    color: '#ecfeff',
    fontWeight: '700',
    fontSize: 13,
  },
  voiceOrderBtn: {
    backgroundColor: '#0f3f76',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 6,
  },
  voiceOrderBtnActive: {
    backgroundColor: '#7c2d12',
  },
  voiceOrderBtnText: {
    color: '#ecfeff',
    fontWeight: '700',
    fontSize: 13,
  },
  voicePreviewText: {
    color: '#bae6fd',
    fontSize: 12,
    marginBottom: 6,
  },
  voicePreviewTextLight: {
    color: '#0369a1',
  },
  embeddedLlmCard: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 8,
    backgroundColor: '#0b1b2f',
    marginBottom: 6,
  },
  embeddedLlmCardLight: {
    borderColor: '#cbd5e1',
    backgroundColor: '#eef6ff',
  },
  embeddedLlmTitle: {
    color: '#dbeafe',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  embeddedLlmTitleLight: {
    color: '#1e3a8a',
  },
  embeddedLlmMeta: {
    color: '#cbd5e1',
    fontSize: 11,
    marginBottom: 2,
  },
  embeddedLlmMetaLight: {
    color: '#334155',
  },
  embeddedLlmBtn: {
    marginTop: 6,
    backgroundColor: '#1d4ed8',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  embeddedLlmBtnText: {
    color: '#eff6ff',
    fontSize: 12,
    fontWeight: '700',
  },
  favoritesWrap: {
    marginBottom: 6,
  },
  favoritesRow: {
    flexDirection: 'row',
    gap: 6,
    paddingTop: 4,
  },
  favoriteChip: {
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#1e293b',
  },
  favoriteChipLight: {
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
  },
  favoriteChipText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600',
  },
  favoriteChipTextLight: {
    color: '#334155',
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
    flexDirection: 'row',
    alignItems: 'center',
  },
  resultRowLight: {
    borderTopColor: '#e2e8f0',
  },
  resultInfoCol: {
    flex: 1,
  },
  favoriteBtn: {
    marginLeft: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e293b',
  },
  favoriteBtnActive: {
    borderColor: '#eab308',
    backgroundColor: '#422006',
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
  feSummaryRow: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#243041',
    paddingTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  holdBtn: {
    borderWidth: 1,
    borderColor: '#0f766e',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#115e59',
  },
  holdBtnText: {
    color: '#ccfbf1',
    fontSize: 12,
    fontWeight: '700',
  },
  draftRow: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    backgroundColor: '#0f172a',
    padding: 8,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  draftRowLight: {
    borderColor: '#dbe4ef',
    backgroundColor: '#f8fafc',
  },
  draftInfo: {
    flex: 1,
  },
  draftActions: {
    flexDirection: 'row',
    gap: 6,
  },
  actionMiniBtn: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  detailMiniBtn: {
    backgroundColor: '#1d4ed8',
  },
  removeMiniBtn: {
    backgroundColor: '#7f1d1d',
  },
  actionMiniText: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '700',
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
  paymentRefInput: {
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 8,
    color: '#f8fafc',
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: '#111827',
    marginTop: 6,
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
  quickCashWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  quickCashBtn: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#0f172a',
  },
  quickCashExactBtn: {
    borderColor: '#0369a1',
    backgroundColor: '#0c4a6e',
  },
  quickCashText: {
    color: '#dbeafe',
    fontSize: 12,
    fontWeight: '700',
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
