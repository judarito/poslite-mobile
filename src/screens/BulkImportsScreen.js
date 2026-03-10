import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
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
import { getSimpleCache, saveSimpleCache } from '../services/offlineCache.service';
import { listBulkImportErrors, listBulkImports } from '../services/bulkImports.service';
import { importProductsFromRows, parseProductsFromPhoto } from '../services/productPhotoImport.service';

const TYPES = [
  { value: 'product_variants', label: 'Productos/variantes' },
  { value: 'third_parties', label: 'Terceros' },
];

const OCR_MAX_BYTES = 980 * 1024;

function cacheKey(tenantId, type) {
  return `bulk-imports:${tenantId || 'na'}:${type || 'all'}`;
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

function createDraftRow(seed = {}) {
  return {
    local_id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    product_name: String(seed.product_name || '').trim(),
    variant_name: String(seed.variant_name || 'Predeterminada').trim() || 'Predeterminada',
    category_name: String(seed.category_name || '').trim(),
    unit_price: seed.unit_price == null ? '' : String(seed.unit_price),
    unit_cost: seed.unit_cost == null ? '' : String(seed.unit_cost),
    initial_stock: seed.initial_stock == null ? '' : String(seed.initial_stock),
    notes: String(seed.notes || '').trim(),
    confidence: Number(seed.confidence || 0),
  };
}

export default function BulkImportsScreen({ tenant, offlineMode }) {
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';
  const [selectedType, setSelectedType] = useState('product_variants');
  const [rows, setRows] = useState([]);
  const [errors, setErrors] = useState([]);
  const [errorsModal, setErrorsModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cacheAt, setCacheAt] = useState('');
  const [info, setInfo] = useState('');

  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [importingRows, setImportingRows] = useState(false);
  const [showAiTools, setShowAiTools] = useState(false);
  const [draftRows, setDraftRows] = useState([]);
  const [previewModal, setPreviewModal] = useState(false);
  const [defaultUnitCode, setDefaultUnitCode] = useState('UND');
  const [defaultLocationCode, setDefaultLocationCode] = useState('');
  const [defaultCategoryName, setDefaultCategoryName] = useState('');
  const [parserWarnings, setParserWarnings] = useState([]);
  const [parserMeta, setParserMeta] = useState({ model: '', tokens: null });

  const validDraftRows = useMemo(
    () =>
      draftRows.filter((row) => {
        const name = String(row.product_name || '').trim();
        const price = Number(row.unit_price);
        return Boolean(name) && Number.isFinite(price) && price > 0;
      }),
    [draftRows],
  );

  const loadHistory = async () => {
    if (!tenant?.tenant_id) return;

    setLoading(true);
    setError('');

    if (offlineMode) {
      const cached = await getSimpleCache(cacheKey(tenant.tenant_id, selectedType));
      if (cached?.value) {
        setRows(cached.value.rows || []);
        setCacheAt(cached.value.cachedAt || '');
      } else {
        setRows([]);
        setCacheAt('');
        setError('No hay cache local del historial de carga masiva para este filtro.');
      }
      setLoading(false);
      return;
    }

    const result = await listBulkImports({
      tenantId: tenant.tenant_id,
      importType: selectedType,
      limit: 60,
    });

    if (!result.success) {
      const cached = await getSimpleCache(cacheKey(tenant.tenant_id, selectedType));
      if (cached?.value) {
        setRows(cached.value.rows || []);
        setCacheAt(cached.value.cachedAt || '');
        setError(result.error || 'Sin conexion. Mostrando cache local.');
      } else {
        setRows([]);
        setCacheAt('');
        setError(result.error || 'No se pudo cargar historial.');
      }
      setLoading(false);
      return;
    }

    const now = new Date().toISOString();
    setRows(result.data || []);
    setCacheAt(now);
    await saveSimpleCache(cacheKey(tenant.tenant_id, selectedType), {
      rows: result.data || [],
      cachedAt: now,
    });
    setLoading(false);
  };

  useEffect(() => {
    loadHistory();
  }, [selectedType, tenant?.tenant_id, offlineMode]);

  const openErrors = async (importId) => {
    if (offlineMode) {
      setError('Detalle de errores no disponible en offline.');
      return;
    }

    const result = await listBulkImportErrors(importId);
    if (!result.success) {
      setError(result.error || 'No se pudo cargar detalle de errores.');
      return;
    }

    setErrors(result.data || []);
    setErrorsModal(true);
  };

  const pickAndParseImage = async (source = 'camera') => {
    setError('');
    setInfo('');
    setParserWarnings([]);
    setParserMeta({ model: '', tokens: null });

    if (offlineMode) {
      setError('La carga por foto requiere conexion online.');
      return;
    }
    if (!tenant?.tenant_id) {
      setError('Tenant invalido.');
      return;
    }

    let ImagePicker;
    try {
      ImagePicker = require('expo-image-picker');
    } catch (_e) {
      setError('Falta dependencia expo-image-picker. Instala y recompila la app.');
      return;
    }

    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission?.granted && Platform.OS !== 'web') {
        setError('Permiso de camara denegado.');
        return;
      }
    } else {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission?.granted && Platform.OS !== 'web') {
        setError('Permiso de galeria denegado.');
        return;
      }
    }

    const pickerOptions = {
      mediaTypes: ImagePicker.MediaTypeOptions?.Images ?? 'images',
      allowsEditing: false,
      quality: 0.6,
      base64: false,
      exif: false,
    };

    const capture = source === 'camera'
      ? await ImagePicker.launchCameraAsync(pickerOptions)
      : await ImagePicker.launchImageLibraryAsync(pickerOptions);

    if (capture?.canceled) return;
    const asset = capture?.assets?.[0];
    if (!asset?.uri) {
      setError('No se pudo obtener la imagen seleccionada.');
      return;
    }

    setProcessingPhoto(true);
    try {
      const optimized = await buildOptimizedImageForOcr(asset);
      if (!optimized.success) {
        setError(optimized.error || 'No fue posible optimizar la imagen para OCR.');
        return;
      }

      const parsed = await parseProductsFromPhoto({
        tenantId: tenant.tenant_id,
        imageBase64: optimized.data.base64,
        mimeType: optimized.data.mimeType || 'image/jpeg',
      });

      if (!parsed.success) {
        setError(parsed.error || 'No se pudo parsear la imagen.');
        return;
      }

      const nextRows = (parsed.data?.products || []).map((item) => createDraftRow(item));
      if (!nextRows.length) {
        setError('La IA no pudo detectar filas de productos en la foto.');
        return;
      }

      setDraftRows(nextRows);
      setParserWarnings(Array.isArray(parsed.data?.warnings) ? parsed.data.warnings : []);
      setParserMeta({
        model: String(parsed.data?.model || ''),
        tokens: parsed.data?.usage?.total_tokens ?? null,
      });
      setPreviewModal(true);
      setInfo(`Se detectaron ${nextRows.length} fila(s). Revisa y confirma antes de importar.`);
    } finally {
      setProcessingPhoto(false);
    }
  };

  const updateDraftField = (localId, field, value) => {
    setDraftRows((prev) =>
      prev.map((row) => (row.local_id === localId ? { ...row, [field]: value } : row)),
    );
  };

  const removeDraftRow = (localId) => {
    setDraftRows((prev) => prev.filter((row) => row.local_id !== localId));
  };

  const addDraftRow = () => {
    setDraftRows((prev) => [...prev, createDraftRow({ category_name: defaultCategoryName })]);
  };

  const importDraftRows = async () => {
    setError('');
    setInfo('');
    if (!tenant?.tenant_id) {
      setError('Tenant invalido.');
      return;
    }
    if (!validDraftRows.length) {
      setError('Debes tener al menos una fila valida (nombre + precio > 0).');
      return;
    }
    if (offlineMode) {
      setError('No puedes importar productos en modo offline.');
      return;
    }

    setImportingRows(true);
    try {
      const result = await importProductsFromRows({
        tenantId: tenant.tenant_id,
        rows: validDraftRows,
        defaults: {
          unit_code: defaultUnitCode || 'UND',
          location_code: defaultLocationCode || '',
          category_name: defaultCategoryName || '',
          inventory_type: 'REVENTA',
        },
      });

      if (!result.success && !result.data) {
        setError(result.error || 'No se pudo importar las filas.');
        return;
      }

      const summary = result.data || {};
      const warningCount = Array.isArray(summary.warnings) ? summary.warnings.length : 0;
      const errorCount = Array.isArray(summary.errors) ? summary.errors.length : 0;

      setInfo(
        `Importacion completada: ${summary.processed || 0} ok, ${summary.failed || 0} error(es), ${warningCount} advertencia(s).`,
      );

      if (warningCount) {
        const first = summary.warnings.slice(0, 3).join(' | ');
        setError(`Advertencias: ${first}${warningCount > 3 ? ' ...' : ''}`);
      } else if (errorCount) {
        const first = summary.errors
          .slice(0, 3)
          .map((e) => `Fila ${e.row}: ${e.message}`)
          .join(' | ');
        setError(`Errores: ${first}${errorCount > 3 ? ' ...' : ''}`);
      }

      setPreviewModal(false);
      setDraftRows([]);
      await loadHistory();
    } finally {
      setImportingRows(false);
    }
  };

  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <Text style={[styles.title, isLightTheme && styles.titleLight]}>Carga Masiva</Text>
      <Text style={[styles.meta, isLightTheme && styles.metaLight]}>
        Historial de cargas XLSX + nuevo cargue rapido por foto de listado.
      </Text>

      <Pressable
        style={[styles.aiToggleBtn, isLightTheme && styles.aiToggleBtnLight]}
        onPress={() => setShowAiTools((prev) => !prev)}
      >
        <View style={styles.btnContentRow}>
          <Ionicons
            name={showAiTools ? 'sparkles' : 'sparkles-outline'}
            size={14}
            color={isLightTheme ? '#235ea9' : '#eff6ff'}
          />
          <Text style={[styles.aiToggleText, isLightTheme && styles.aiToggleTextLight]}>
            {showAiTools ? 'IA Ocultar' : 'IA'}
          </Text>
        </View>
      </Pressable>

      {showAiTools ? (
        <View style={[styles.photoCard, isLightTheme && styles.photoCardLight]}>
          <Text style={[styles.photoTitle, isLightTheme && styles.photoTitleLight]}>Cargar productos por foto</Text>
          <Text style={[styles.photoMeta, isLightTheme && styles.photoMetaLight]}>
            Toma foto de una lista escrita, corrige los datos y confirma importacion.
          </Text>

          <View style={[styles.exampleBox, isLightTheme && styles.exampleBoxLight]}>
            <Text style={[styles.exampleTitle, isLightTheme && styles.exampleTitleLight]}>
              Ejemplo de hoja para la foto:
            </Text>
            <Text style={[styles.exampleLine, isLightTheme && styles.exampleLineLight]}>
              Camiseta blanca talla M | 45000 | 28000 | 20
            </Text>
            <Text style={[styles.exampleLine, isLightTheme && styles.exampleLineLight]}>
              Camiseta blanca talla L | 45000 | 28000 | 15
            </Text>
            <Text style={[styles.exampleLine, isLightTheme && styles.exampleLineLight]}>
              Jean slim azul 32 | 99000 | 62000 | 8
            </Text>
            <Text style={[styles.exampleHint, isLightTheme && styles.exampleHintLight]}>
              Formato sugerido: Nombre | Precio venta | Costo | Stock
            </Text>
          </View>

          <View style={styles.photoActions}>
            <Pressable
              style={[styles.photoActionBtn, processingPhoto && styles.disabledBtn]}
              disabled={processingPhoto}
              onPress={() => pickAndParseImage('camera')}
            >
              <Ionicons name="camera-outline" size={16} color="#eff6ff" />
              <Text style={styles.photoActionText}>{processingPhoto ? 'Procesando...' : 'Tomar foto'}</Text>
            </Pressable>
            <Pressable
              style={[styles.photoActionBtnSecondary, processingPhoto && styles.disabledBtn]}
              disabled={processingPhoto}
              onPress={() => pickAndParseImage('library')}
            >
              <Ionicons name="images-outline" size={16} color="#dbeafe" />
              <Text style={styles.photoActionText}>Galeria</Text>
            </Pressable>
          </View>

          <View style={styles.defaultsGrid}>
            <TextInput
              style={[styles.input, isLightTheme && styles.inputLight]}
              value={defaultUnitCode}
              onChangeText={setDefaultUnitCode}
              placeholder="Unidad default (ej: UND)"
              placeholderTextColor="#64748b"
            />
            <TextInput
              style={[styles.input, isLightTheme && styles.inputLight]}
              value={defaultLocationCode}
              onChangeText={setDefaultLocationCode}
              placeholder="Ubicacion para stock inicial (opcional)"
              placeholderTextColor="#64748b"
            />
            <TextInput
              style={[styles.input, isLightTheme && styles.inputLight]}
              value={defaultCategoryName}
              onChangeText={setDefaultCategoryName}
              placeholder="Categoria default (opcional)"
              placeholderTextColor="#64748b"
            />
          </View>

          {draftRows.length ? (
            <Pressable style={styles.previewBtn} onPress={() => setPreviewModal(true)}>
              <Text style={styles.previewBtnText}>Revisar filas detectadas ({draftRows.length})</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {parserWarnings.length ? (
        <Text style={[styles.warnText, isLightTheme && styles.warnTextLight]}>
          IA/OCR: {parserWarnings.slice(0, 3).join(' | ')}
          {parserWarnings.length > 3 ? ' ...' : ''}
        </Text>
      ) : null}
      {parserMeta.model ? (
        <Text style={[styles.cacheText, isLightTheme && styles.cacheTextLight]}>
          Modelo: {parserMeta.model} {parserMeta.tokens != null ? `· tokens: ${parserMeta.tokens}` : ''}
        </Text>
      ) : null}

      <View style={styles.typeRow}>
        {TYPES.map((item) => {
          const active = selectedType === item.value;
          return (
            <Pressable
              key={item.value}
              style={[styles.typeBtn, isLightTheme && styles.typeBtnLight, active && styles.typeBtnActive]}
              onPress={() => setSelectedType(item.value)}
            >
              <Text style={[styles.typeBtnText, isLightTheme && styles.typeBtnTextLight, active && styles.typeBtnTextActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable style={styles.refreshBtn} onPress={loadHistory}>
        <Text style={styles.refreshBtnText}>{loading ? 'Cargando...' : 'Actualizar historial'}</Text>
      </Pressable>

      {info ? <Text style={[styles.successText, isLightTheme && styles.successTextLight]}>{info}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {cacheAt ? <Text style={[styles.cacheText, isLightTheme && styles.cacheTextLight]}>Cache: {new Date(cacheAt).toLocaleString()}</Text> : null}

      <ScrollView style={styles.list}>
        {rows.length === 0 ? <Text style={[styles.empty, isLightTheme && styles.emptyLight]}>Sin importaciones para mostrar.</Text> : null}
        {rows.map((row) => (
          <View key={row.import_id} style={[styles.card, isLightTheme && styles.cardLight]}>
            <Text style={[styles.cardTitle, isLightTheme && styles.cardTitleLight]}>{row.file_name || 'Archivo sin nombre'}</Text>
            <Text style={[styles.cardMeta, isLightTheme && styles.cardMetaLight]}>Estado: {row.status || '-'}</Text>
            <Text style={[styles.cardMeta, isLightTheme && styles.cardMetaLight]}>Procesados: {row.processed_count || 0}</Text>
            <Text style={[styles.cardMeta, isLightTheme && styles.cardMetaLight]}>Errores: {row.error_count || 0}</Text>
            <Text style={[styles.cardMeta, isLightTheme && styles.cardMetaLight]}>
              {row.created_at ? new Date(row.created_at).toLocaleString() : 'Sin fecha'}
            </Text>

            <Pressable
              style={[styles.detailBtn, Number(row.error_count || 0) === 0 && styles.disabledBtn]}
              disabled={Number(row.error_count || 0) === 0}
              onPress={() => openErrors(row.import_id)}
            >
              <Text style={styles.detailBtnText}>Ver errores</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>

      <Modal visible={errorsModal} transparent animationType="slide" onRequestClose={() => setErrorsModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBody, isLightTheme && styles.modalBodyLight]}>
            <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>Errores de importacion</Text>
            <ScrollView>
              {errors.length === 0 ? <Text style={[styles.empty, isLightTheme && styles.emptyLight]}>No hay errores para este archivo.</Text> : null}
              {errors.map((e) => (
                <View key={e.error_id} style={[styles.errorCard, isLightTheme && styles.errorCardLight]}>
                  <Text style={[styles.errorLine, isLightTheme && styles.errorLineLight]}>Fila: {e.row_number ?? '-'}</Text>
                  <Text style={[styles.errorLine, isLightTheme && styles.errorLineLight]}>Detalle: {e.detail || '-'}</Text>
                </View>
              ))}
            </ScrollView>
            <Pressable onPress={() => setErrorsModal(false)} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={previewModal} transparent animationType="slide" onRequestClose={() => setPreviewModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBody, isLightTheme && styles.modalBodyLight, { maxHeight: '92%' }]}>
            <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>
              Revisar carga por foto ({draftRows.length})
            </Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>
              Minimo por fila: nombre + precio.
            </Text>

            <View style={styles.previewHeaderActions}>
              <Pressable style={styles.tinyBtn} onPress={addDraftRow}>
                <Ionicons name="add-outline" size={14} color="#eff6ff" />
                <Text style={styles.tinyBtnText}>Agregar fila</Text>
              </Pressable>
              <Pressable
                style={[styles.tinyBtn, styles.tinyBtnPrimary, importingRows && styles.disabledBtn]}
                disabled={importingRows}
                onPress={importDraftRows}
              >
                <Ionicons name="cloud-upload-outline" size={14} color="#fff7ed" />
                <Text style={styles.tinyBtnText}>{importingRows ? 'Importando...' : `Importar (${validDraftRows.length})`}</Text>
              </Pressable>
            </View>

            <ScrollView>
              {draftRows.map((row) => (
                <View key={row.local_id} style={[styles.previewCard, isLightTheme && styles.previewCardLight]}>
                  <View style={styles.previewCardTop}>
                    <Text style={[styles.previewTitle, isLightTheme && styles.previewTitleLight]}>
                      {row.product_name || 'Fila sin nombre'}
                    </Text>
                    <Pressable onPress={() => removeDraftRow(row.local_id)}>
                      <Ionicons name="trash-outline" size={16} color={isLightTheme ? '#dc2626' : '#fca5a5'} />
                    </Pressable>
                  </View>
                  <Text style={[styles.previewConfidence, isLightTheme && styles.previewConfidenceLight]}>
                    Confianza IA: {Math.round(Number(row.confidence || 0) * 100)}%
                  </Text>

                  <TextInput
                    style={[styles.input, isLightTheme && styles.inputLight]}
                    value={row.product_name}
                    onChangeText={(v) => updateDraftField(row.local_id, 'product_name', v)}
                    placeholder="Nombre producto *"
                    placeholderTextColor="#64748b"
                  />
                  <TextInput
                    style={[styles.input, isLightTheme && styles.inputLight]}
                    value={row.variant_name}
                    onChangeText={(v) => updateDraftField(row.local_id, 'variant_name', v)}
                    placeholder="Variante"
                    placeholderTextColor="#64748b"
                  />
                  <TextInput
                    style={[styles.input, isLightTheme && styles.inputLight]}
                    value={row.category_name}
                    onChangeText={(v) => updateDraftField(row.local_id, 'category_name', v)}
                    placeholder="Categoria"
                    placeholderTextColor="#64748b"
                  />
                  <View style={styles.row2}>
                    <TextInput
                      style={[styles.input, styles.row2Input, isLightTheme && styles.inputLight]}
                      value={String(row.unit_price || '')}
                      onChangeText={(v) => updateDraftField(row.local_id, 'unit_price', v)}
                      placeholder="Precio *"
                      keyboardType="numeric"
                      placeholderTextColor="#64748b"
                    />
                    <TextInput
                      style={[styles.input, styles.row2Input, isLightTheme && styles.inputLight]}
                      value={String(row.unit_cost || '')}
                      onChangeText={(v) => updateDraftField(row.local_id, 'unit_cost', v)}
                      placeholder="Costo"
                      keyboardType="numeric"
                      placeholderTextColor="#64748b"
                    />
                  </View>
                  <TextInput
                    style={[styles.input, isLightTheme && styles.inputLight]}
                    value={String(row.initial_stock || '')}
                    onChangeText={(v) => updateDraftField(row.local_id, 'initial_stock', v)}
                    placeholder="Stock inicial"
                    keyboardType="numeric"
                    placeholderTextColor="#64748b"
                  />
                </View>
              ))}
            </ScrollView>

            <Pressable onPress={() => setPreviewModal(false)} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>Cerrar</Text>
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
  title: { color: '#f8fafc', fontSize: 20, fontWeight: '700' },
  titleLight: { color: '#0f172a' },
  meta: { color: '#94a3b8', marginTop: 6, marginBottom: 10 },
  metaLight: { color: '#475569' },
  photoCard: {
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    backgroundColor: '#111827',
    padding: 12,
    marginBottom: 10,
  },
  photoCardLight: { borderColor: '#dbe4ef', backgroundColor: '#ffffff' },
  aiToggleBtn: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    backgroundColor: '#111827',
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 10,
    alignSelf: 'flex-start',
  },
  aiToggleBtnLight: {
    borderColor: '#dbe4ef',
    backgroundColor: '#ffffff',
  },
  aiToggleText: {
    color: '#e2e8f0',
    fontWeight: '700',
    fontSize: 13,
  },
  aiToggleTextLight: {
    color: '#0f172a',
  },
  btnContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  photoTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '700' },
  photoTitleLight: { color: '#0f172a' },
  photoMeta: { color: '#94a3b8', fontSize: 12, marginTop: 4 },
  photoMetaLight: { color: '#64748b' },
  exampleBox: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    backgroundColor: '#0f172a',
    padding: 10,
    gap: 4,
  },
  exampleBoxLight: {
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
  },
  exampleTitle: {
    color: '#eff6ff',
    fontWeight: '700',
    fontSize: 12,
    marginBottom: 2,
  },
  exampleTitleLight: {
    color: '#235ea9',
  },
  exampleLine: {
    color: '#e2e8f0',
    fontSize: 12,
  },
  exampleLineLight: {
    color: '#334155',
  },
  exampleHint: {
    marginTop: 4,
    color: '#94a3b8',
    fontSize: 11,
  },
  exampleHintLight: {
    color: '#475569',
  },
  photoActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  photoActionBtn: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: '#0c4a6e',
    borderWidth: 1,
    borderColor: '#38bdf8',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    flexDirection: 'row',
    gap: 6,
  },
  photoActionBtnSecondary: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: '#1e3a8a',
    borderWidth: 1,
    borderColor: '#60a5fa',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    flexDirection: 'row',
    gap: 6,
  },
  photoActionText: { color: '#dbeafe', fontWeight: '700', fontSize: 12 },
  defaultsGrid: { marginTop: 10, gap: 8 },
  input: {
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    paddingHorizontal: 10,
    fontSize: 13,
  },
  inputLight: {
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    color: '#0f172a',
  },
  previewBtn: {
    marginTop: 10,
    borderRadius: 8,
    backgroundColor: '#14532d',
    borderWidth: 1,
    borderColor: '#22c55e',
    alignItems: 'center',
    paddingVertical: 9,
  },
  previewBtnText: { color: '#dcfce7', fontWeight: '700' },
  typeRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  typeBtn: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    paddingVertical: 8,
    alignItems: 'center',
  },
  typeBtnLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  typeBtnActive: { borderColor: '#235ea9', backgroundColor: '#235ea9' },
  typeBtnText: { color: '#cbd5e1', fontWeight: '700', fontSize: 12 },
  typeBtnTextLight: { color: '#334155' },
  typeBtnTextActive: { color: '#eff6ff' },
  refreshBtn: {
    backgroundColor: '#235ea9',
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 10,
    marginBottom: 10,
  },
  refreshBtnText: { color: '#dbeafe', fontWeight: '700' },
  successText: { color: '#86efac', marginBottom: 8, fontSize: 12 },
  successTextLight: { color: '#166534' },
  warnText: { color: '#fcd34d', marginBottom: 8, fontSize: 12 },
  warnTextLight: { color: '#92400e' },
  error: { color: '#f87171', marginBottom: 8 },
  cacheText: { color: '#64748b', fontSize: 12, marginBottom: 8 },
  cacheTextLight: { color: '#475569' },
  list: { flex: 1 },
  empty: { color: '#94a3b8', textAlign: 'center', marginTop: 12 },
  emptyLight: { color: '#64748b' },
  card: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  cardLight: { borderColor: '#dbe4ef', backgroundColor: '#ffffff' },
  cardTitle: { color: '#f8fafc', fontWeight: '700', fontSize: 14 },
  cardTitleLight: { color: '#0f172a' },
  cardMeta: { color: '#cbd5e1', marginTop: 3, fontSize: 13 },
  cardMetaLight: { color: '#475569' },
  detailBtn: {
    marginTop: 10,
    backgroundColor: '#334155',
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 8,
  },
  detailBtnText: { color: '#e2e8f0', fontWeight: '700' },
  disabledBtn: { opacity: 0.4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalBody: {
    maxHeight: '80%',
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    padding: 14,
  },
  modalBodyLight: { backgroundColor: '#f8fafc' },
  modalTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '700', marginBottom: 10 },
  modalTitleLight: { color: '#0f172a' },
  errorCard: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 10,
    backgroundColor: '#111827',
    marginBottom: 8,
  },
  errorCardLight: { borderColor: '#dbe4ef', backgroundColor: '#ffffff' },
  errorLine: { color: '#e2e8f0', fontSize: 13 },
  errorLineLight: { color: '#334155' },
  closeBtn: {
    marginTop: 12,
    alignSelf: 'flex-end',
    backgroundColor: '#235ea9',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  closeBtnText: { color: '#fff', fontWeight: '700' },
  previewHeaderActions: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  tinyBtn: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#38bdf8',
    backgroundColor: '#0c4a6e',
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  tinyBtnPrimary: {
    borderColor: '#f59e0b',
    backgroundColor: '#b45309',
  },
  tinyBtnText: { color: '#f8fafc', fontWeight: '700', fontSize: 12 },
  previewCard: {
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 10,
    backgroundColor: '#111827',
    padding: 10,
    marginBottom: 10,
    gap: 8,
  },
  previewCardLight: {
    borderColor: '#dbe4ef',
    backgroundColor: '#ffffff',
  },
  previewCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  previewTitle: { color: '#f8fafc', fontWeight: '700', fontSize: 13, flex: 1 },
  previewTitleLight: { color: '#0f172a' },
  previewConfidence: { color: '#94a3b8', fontSize: 11 },
  previewConfidenceLight: { color: '#64748b' },
  row2: { flexDirection: 'row', gap: 8 },
  row2Input: { flex: 1 },
});
