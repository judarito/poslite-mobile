import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getSimpleCache, saveSimpleCache } from '../services/offlineCache.service';
import { listBulkImportErrors, listBulkImports } from '../services/bulkImports.service';

const TYPES = [
  { value: 'product_variants', label: 'Productos/variantes' },
  { value: 'third_parties', label: 'Terceros' },
];

function cacheKey(tenantId, type) {
  return `bulk-imports:${tenantId || 'na'}:${type || 'all'}`;
}

export default function BulkImportsScreen({ tenant, offlineMode }) {
  const [selectedType, setSelectedType] = useState('product_variants');
  const [rows, setRows] = useState([]);
  const [errors, setErrors] = useState([]);
  const [errorsModal, setErrorsModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cacheAt, setCacheAt] = useState('');

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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Carga Masiva</Text>
      <Text style={styles.meta}>
        En mobile se habilita historial y seguimiento. La carga de archivo XLSX se mantiene en web.
      </Text>

      <View style={styles.typeRow}>
        {TYPES.map((item) => {
          const active = selectedType === item.value;
          return (
            <Pressable
              key={item.value}
              style={[styles.typeBtn, active && styles.typeBtnActive]}
              onPress={() => setSelectedType(item.value)}
            >
              <Text style={[styles.typeBtnText, active && styles.typeBtnTextActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable style={styles.refreshBtn} onPress={loadHistory}>
        <Text style={styles.refreshBtnText}>{loading ? 'Cargando...' : 'Actualizar historial'}</Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {cacheAt ? <Text style={styles.cacheText}>Cache: {new Date(cacheAt).toLocaleString()}</Text> : null}

      <ScrollView style={styles.list}>
        {rows.length === 0 ? <Text style={styles.empty}>Sin importaciones para mostrar.</Text> : null}
        {rows.map((row) => (
          <View key={row.import_id} style={styles.card}>
            <Text style={styles.cardTitle}>{row.file_name || 'Archivo sin nombre'}</Text>
            <Text style={styles.cardMeta}>Estado: {row.status || '-'}</Text>
            <Text style={styles.cardMeta}>Procesados: {row.processed_count || 0}</Text>
            <Text style={styles.cardMeta}>Errores: {row.error_count || 0}</Text>
            <Text style={styles.cardMeta}>
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
          <View style={styles.modalBody}>
            <Text style={styles.modalTitle}>Errores de importacion</Text>
            <ScrollView>
              {errors.length === 0 ? <Text style={styles.empty}>No hay errores para este archivo.</Text> : null}
              {errors.map((e) => (
                <View key={e.error_id} style={styles.errorCard}>
                  <Text style={styles.errorLine}>Fila: {e.row_number ?? '-'}</Text>
                  <Text style={styles.errorLine}>Detalle: {e.detail || '-'}</Text>
                </View>
              ))}
            </ScrollView>
            <Pressable onPress={() => setErrorsModal(false)} style={styles.closeBtn}>
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
  title: { color: '#f8fafc', fontSize: 20, fontWeight: '700' },
  meta: { color: '#94a3b8', marginTop: 6, marginBottom: 10 },
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
  typeBtnActive: { borderColor: '#0ea5e9', backgroundColor: '#0b2942' },
  typeBtnText: { color: '#cbd5e1', fontWeight: '700', fontSize: 12 },
  typeBtnTextActive: { color: '#bae6fd' },
  refreshBtn: {
    backgroundColor: '#1e40af',
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 10,
    marginBottom: 10,
  },
  refreshBtnText: { color: '#dbeafe', fontWeight: '700' },
  error: { color: '#f87171', marginBottom: 8 },
  cacheText: { color: '#64748b', fontSize: 12, marginBottom: 8 },
  list: { flex: 1 },
  empty: { color: '#94a3b8', textAlign: 'center', marginTop: 12 },
  card: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  cardTitle: { color: '#f8fafc', fontWeight: '700', fontSize: 14 },
  cardMeta: { color: '#cbd5e1', marginTop: 3, fontSize: 13 },
  detailBtn: {
    marginTop: 10,
    backgroundColor: '#334155',
    borderRadius: 8,
    alignItems: 'center',
    paddingVertical: 8,
  },
  detailBtnText: { color: '#e2e8f0', fontWeight: '700' },
  disabledBtn: { opacity: 0.35 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalBody: {
    maxHeight: '80%',
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    padding: 14,
  },
  modalTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '700', marginBottom: 10 },
  errorCard: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 10,
    backgroundColor: '#111827',
    marginBottom: 8,
  },
  errorLine: { color: '#e2e8f0', fontSize: 13 },
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
