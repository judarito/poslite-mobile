import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import PaginatedList from '../components/PaginatedList';
import { usePaginatedList } from '../hooks/usePaginatedList';
import { useThemeMode } from '../lib/themeMode';
import {
  createThirdParty,
  listThirdParties,
  removeThirdParty,
  updateThirdParty,
} from '../services/thirdParties.service';

const TYPE_FILTERS = ['', 'customer', 'supplier'];

const DOCUMENT_TYPES = [
  'CC',
  'NIT',
  'CE',
  'TI',
  'PASSPORT',
  'PEP',
  'NUI',
  'RUT',
];

const TAX_REGIME_OPTIONS = [
  { value: '48', label: 'Responsable IVA (48)' },
  { value: '49', label: 'No Responsable IVA (49)' },
  { value: 'O-13', label: 'Gran Contribuyente (O-13)' },
  { value: 'ZZ', label: 'Régimen Simple (ZZ)' },
];

const EMPTY_FORM = {
  third_party_id: null,
  type: 'both',
  legal_name: '',
  trade_name: '',
  document_type: 'CC',
  document_number: '',
  dv: '',
  phone: '',
  email: '',
  fiscal_email: '',
  department: '',
  city: '',
  city_code: '',
  address_text: '',
  tax_regime: '',
  ciiu_code: '',
  is_responsible_for_iva: false,
  obligated_accounting: false,
  electronic_invoicing_enabled: false,
  max_credit_amount: '0',
  default_payment_terms: '0',
  default_currency: 'COP',
  is_active: true,
};

function boolText(value, yes, no) {
  return value ? yes : no;
}

function typeHelpText(type) {
  if (type === 'customer') {
    return 'Aparece en POS y reportes de ventas.';
  }
  if (type === 'supplier') {
    return 'Aparece en compras y reportes de proveedor.';
  }
  return 'Se usa como cliente y proveedor con la misma identificacion fiscal.';
}

export default function ThirdPartiesScreen({ tenant, offlineMode, pageSize = 20 }) {
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const {
    items: rows,
    page,
    totalPages,
    loading,
    error,
    cacheInfo,
    filters,
    setError,
    updateFilters,
    changePage,
    loadPage,
  } = usePaginatedList({
    tenantId: tenant?.tenant_id,
    pageSize,
    offlineMode,
    cacheNamespace: 'third-parties',
    initialFilters: { type: '', search: '' },
    fetchPage: async ({ page: nextPage, pageSize: nextPageSize, filters: nextFilters }) => {
      const offset = (nextPage - 1) * nextPageSize;
      return listThirdParties({
        search: nextFilters?.search || '',
        type: nextFilters?.type || null,
        limit: nextPageSize,
        offset,
      });
    },
  });

  const openCreate = () => {
    setForm({ ...EMPTY_FORM });
    setModalOpen(true);
  };

  const openEdit = (item) => {
    setForm({
      third_party_id: item.third_party_id,
      type: item.type || 'both',
      legal_name: item.legal_name || '',
      trade_name: item.trade_name || '',
      document_type: item.document_type || 'CC',
      document_number: item.document_number || '',
      dv: item.dv || '',
      phone: item.phone || '',
      email: item.email || '',
      fiscal_email: item.fiscal_email || '',
      department: item.department || '',
      city: item.city || '',
      city_code: item.city_code || '',
      address_text:
        typeof item.address === 'string'
          ? item.address
          : item.address?.street || item.address?.text || '',
      tax_regime: item.tax_regime || '',
      ciiu_code: item.ciiu_code || '',
      is_responsible_for_iva: item.is_responsible_for_iva === true,
      obligated_accounting: item.obligated_accounting === true,
      electronic_invoicing_enabled: item.electronic_invoicing_enabled === true,
      max_credit_amount: String(item.max_credit_amount || 0),
      default_payment_terms: String(item.default_payment_terms || 0),
      default_currency: item.default_currency || 'COP',
      is_active: item.is_active !== false,
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (offlineMode) {
      setError('Terceros no permite escritura en modo offline.');
      return;
    }
    if (!tenant?.tenant_id) return;

    const legalName = (form.legal_name || '').trim();
    const docNumber = (form.document_number || '').trim();
    if (!legalName || !docNumber) {
      setError('Razon social/nombre y documento son obligatorios.');
      return;
    }

    setSaving(true);
    setError('');

    const payload = {
      tenant_id: tenant.tenant_id,
      third_party_id: form.third_party_id || undefined,
      type: form.type || 'both',
      legal_name: legalName,
      trade_name: (form.trade_name || '').trim() || null,
      document_type: (form.document_type || 'CC').trim(),
      document_number: docNumber,
      dv: (form.dv || '').trim() || null,
      phone: (form.phone || '').trim() || null,
      email: (form.email || '').trim() || null,
      fiscal_email: (form.fiscal_email || '').trim() || null,
      department: (form.department || '').trim() || null,
      city: (form.city || '').trim() || null,
      city_code: (form.city_code || '').trim() || null,
      address: (form.address_text || '').trim() || null,
      tax_regime: (form.tax_regime || '').trim() || null,
      ciiu_code: (form.ciiu_code || '').trim() || null,
      is_responsible_for_iva: form.is_responsible_for_iva === true,
      obligated_accounting: form.obligated_accounting === true,
      electronic_invoicing_enabled: form.electronic_invoicing_enabled === true,
      max_credit_amount: Number(form.max_credit_amount || 0),
      default_payment_terms: Number(form.default_payment_terms || 0),
      default_currency: (form.default_currency || 'COP').trim() || 'COP',
      country_code: 'CO',
      is_active: form.is_active !== false,
    };

    const result = form.third_party_id
      ? await updateThirdParty(form.third_party_id, payload)
      : await createThirdParty(payload);

    if (!result.success) {
      setError(result.error || 'No fue posible guardar tercero');
      setSaving(false);
      return;
    }

    setModalOpen(false);
    setForm({ ...EMPTY_FORM });
    await loadPage(page, filters);
    setSaving(false);
  };

  const remove = (item) => {
    Alert.alert(
      'Eliminar tercero',
      `Se eliminara ${item.legal_name}. Esta accion no se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            if (offlineMode) {
              setError('No puedes eliminar terceros en modo offline.');
              return;
            }
            const result = await removeThirdParty(item.third_party_id, tenant?.tenant_id);
            if (!result.success) {
              setError(result.error || 'No fue posible eliminar');
              return;
            }
            await loadPage(page, filters);
          },
        },
      ],
    );
  };

  const renderChip = (label, active = true, color = '#334155') => (
    <View style={[styles.badge, { borderColor: color, opacity: active ? 1 : 0.65 }]}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );

  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={styles.toolbar}>
        <TextInput
          style={[styles.searchInput, isLightTheme && styles.searchInputLight]}
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={() => updateFilters({ search })}
          placeholder="Buscar por nombre o documento"
          placeholderTextColor="#64748b"
        />
        <Pressable style={styles.searchBtn} onPress={() => updateFilters({ search })}>
          <Text style={styles.searchBtnText}>Buscar</Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll}>
        {TYPE_FILTERS.map((value) => {
          const active = (filters?.type || '') === value;
          const label = value ? value.toUpperCase() : 'TODOS';
          return (
            <Pressable
              key={label}
              style={[styles.filterChip, isLightTheme && styles.filterChipLight, active && styles.filterChipActive]}
              onPress={() => updateFilters({ type: value })}
            >
              <Text style={[styles.filterChipText, isLightTheme && styles.filterChipTextLight, active && styles.filterChipTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <PaginatedList
        themeMode={themeMode}
        title="Terceros"
        loading={loading}
        error={error}
        items={rows}
        emptyText="No hay terceros."
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
          <View key={item.third_party_id} style={[styles.card, isLightTheme && styles.cardLight]}>
            <Text style={[styles.name, isLightTheme && styles.nameLight]}>{item.legal_name}</Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>
              {[item.document_type, item.document_number ? `${item.document_number}${item.dv ? `-${item.dv}` : ''}` : null]
                .filter(Boolean)
                .join(' ')}
            </Text>
            <Text style={[styles.meta, isLightTheme && styles.metaLight]}>
              {[item.phone, item.email].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
            </Text>

            <View style={styles.badgesRow}>
              {renderChip(item.is_active ? 'Activo' : 'Inactivo', true, item.is_active ? '#16a34a' : '#ef4444')}
              {item.type === 'customer' || item.type === 'both' ? renderChip('Cliente', true, '#0ea5e9') : null}
              {item.type === 'supplier' || item.type === 'both' ? renderChip('Proveedor', true, '#f97316') : null}
              {Number(item.max_credit_amount || 0) > 0
                ? renderChip(`Cupo ${Number(item.max_credit_amount).toLocaleString('es-CO')}`, true, '#f59e0b')
                : null}
            </View>

            <View style={styles.inlineActions}>
              <Pressable style={styles.secondaryBtn} onPress={() => openEdit(item)}>
                <Text style={styles.secondaryBtnText}>Editar</Text>
              </Pressable>
              <Pressable style={styles.dangerBtn} onPress={() => remove(item)}>
                <Text style={styles.dangerBtnText}>Eliminar</Text>
              </Pressable>
            </View>
          </View>
        )}
      />

      <Pressable style={styles.fab} onPress={openCreate}>
        <Text style={styles.fabText}>+ Nuevo</Text>
      </Pressable>

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            style={styles.modalAvoider}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={[styles.modalBody, isLightTheme && styles.modalBodyLight]}>
              <ScrollView
                style={styles.modalScroll}
                contentContainerStyle={styles.modalScrollContent}
                keyboardShouldPersistTaps="handled"
              >
                <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>{form.third_party_id ? 'Editar tercero' : 'Nuevo tercero'}</Text>

              <Text style={[styles.groupTitle, isLightTheme && styles.groupTitleLight]}>Tipo de tercero</Text>
              <View style={styles.toggleRow}>
                {['customer', 'supplier', 'both'].map((type) => (
                  <Pressable
                    key={type}
                    style={[styles.toggleBtn, isLightTheme && styles.toggleBtnLight, form.type === type && styles.toggleBtnActive]}
                    onPress={() => setForm((prev) => ({ ...prev, type }))}
                  >
                    <Text style={[styles.toggleBtnText, isLightTheme && styles.toggleBtnTextLight, form.type === type && styles.toggleBtnTextActive]}>
                      {type === 'customer' ? 'Cliente' : type === 'supplier' ? 'Proveedor' : 'Ambos'}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={[styles.typeHint, isLightTheme && styles.typeHintLight]}>{typeHelpText(form.type)}</Text>

              <Text style={[styles.groupTitle, isLightTheme && styles.groupTitleLight]}>Identificacion</Text>
              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={form.legal_name}
                onChangeText={(v) => setForm((prev) => ({ ...prev, legal_name: v }))}
                placeholder="Razon social / Nombre completo *"
                placeholderTextColor="#64748b"
              />
              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={form.trade_name}
                onChangeText={(v) => setForm((prev) => ({ ...prev, trade_name: v }))}
                placeholder="Nombre comercial"
                placeholderTextColor="#64748b"
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                <View style={styles.methodChipsRow}>
                  {DOCUMENT_TYPES.map((docType) => {
                    const active = form.document_type === docType;
                    return (
                      <Pressable
                        key={docType}
                        style={[styles.methodChip, isLightTheme && styles.methodChipLight, active && styles.methodChipActive]}
                        onPress={() => setForm((prev) => ({ ...prev, document_type: docType }))}
                      >
                        <Text style={[styles.methodChipText, isLightTheme && styles.methodChipTextLight, active && styles.methodChipTextActive]}>{docType}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
              <View style={styles.rowTwo}>
                <TextInput
                  style={[styles.input, isLightTheme && styles.inputLight, styles.flexInput]}
                  value={form.document_number}
                  onChangeText={(v) => setForm((prev) => ({ ...prev, document_number: v }))}
                  placeholder="Numero documento *"
                  placeholderTextColor="#64748b"
                />
                <TextInput
                  style={[styles.input, isLightTheme && styles.inputLight, styles.shortInput]}
                  value={form.dv}
                  onChangeText={(v) => setForm((prev) => ({ ...prev, dv: v }))}
                  placeholder="DV"
                  placeholderTextColor="#64748b"
                />
              </View>

              <Text style={[styles.groupTitle, isLightTheme && styles.groupTitleLight]}>Contacto</Text>
              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={form.phone}
                onChangeText={(v) => setForm((prev) => ({ ...prev, phone: v }))}
                placeholder="Telefono"
                placeholderTextColor="#64748b"
              />
              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={form.email}
                onChangeText={(v) => setForm((prev) => ({ ...prev, email: v }))}
                placeholder="Correo electronico"
                placeholderTextColor="#64748b"
                autoCapitalize="none"
              />
              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={form.fiscal_email}
                onChangeText={(v) => setForm((prev) => ({ ...prev, fiscal_email: v }))}
                placeholder="Correo fiscal / facturacion"
                placeholderTextColor="#64748b"
                autoCapitalize="none"
              />

              <Text style={[styles.groupTitle, isLightTheme && styles.groupTitleLight]}>Ubicacion</Text>
              <View style={styles.rowTwo}>
                <TextInput
                  style={[styles.input, isLightTheme && styles.inputLight, styles.flexInput]}
                  value={form.department}
                  onChangeText={(v) => setForm((prev) => ({ ...prev, department: v }))}
                  placeholder="Departamento"
                  placeholderTextColor="#64748b"
                />
                <TextInput
                  style={[styles.input, isLightTheme && styles.inputLight, styles.flexInput]}
                  value={form.city}
                  onChangeText={(v) => setForm((prev) => ({ ...prev, city: v }))}
                  placeholder="Ciudad / Municipio"
                  placeholderTextColor="#64748b"
                />
              </View>
              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={form.city_code}
                onChangeText={(v) => setForm((prev) => ({ ...prev, city_code: v }))}
                placeholder="Codigo DANE municipio"
                placeholderTextColor="#64748b"
              />
              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight, { minHeight: 70 }]}
                value={form.address_text}
                onChangeText={(v) => setForm((prev) => ({ ...prev, address_text: v }))}
                placeholder="Direccion"
                placeholderTextColor="#64748b"
                multiline
              />

              <Text style={[styles.groupTitle, isLightTheme && styles.groupTitleLight]}>Condiciones comerciales</Text>
              <View style={styles.rowTwo}>
                <TextInput
                  style={[styles.input, isLightTheme && styles.inputLight, styles.flexInput]}
                  value={form.max_credit_amount}
                  onChangeText={(v) => setForm((prev) => ({ ...prev, max_credit_amount: v }))}
                  placeholder="Cupo de credito"
                  placeholderTextColor="#64748b"
                  keyboardType="numeric"
                />
                <TextInput
                  style={[styles.input, isLightTheme && styles.inputLight, styles.flexInput]}
                  value={form.default_payment_terms}
                  onChangeText={(v) => setForm((prev) => ({ ...prev, default_payment_terms: v }))}
                  placeholder="Dias de pago"
                  placeholderTextColor="#64748b"
                  keyboardType="numeric"
                />
              </View>
              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={form.default_currency}
                onChangeText={(v) => setForm((prev) => ({ ...prev, default_currency: v }))}
                placeholder="Moneda (COP)"
                placeholderTextColor="#64748b"
              />

              <Text style={[styles.groupTitle, isLightTheme && styles.groupTitleLight]}>Informacion fiscal (FE)</Text>
              <View style={styles.taxRegimeList}>
                {TAX_REGIME_OPTIONS.map((option) => {
                  const active = form.tax_regime === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      style={[styles.taxRegimeItem, isLightTheme && styles.taxRegimeItemLight, active && styles.taxRegimeItemActive]}
                      onPress={() => setForm((prev) => ({ ...prev, tax_regime: option.value }))}
                    >
                      <Text style={[styles.taxRegimeText, isLightTheme && styles.taxRegimeTextLight, active && styles.taxRegimeTextActive]}>{option.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <TextInput
                style={[styles.input, isLightTheme && styles.inputLight]}
                value={form.ciiu_code}
                onChangeText={(v) => setForm((prev) => ({ ...prev, ciiu_code: v }))}
                placeholder="Codigo CIIU"
                placeholderTextColor="#64748b"
              />

              <View style={styles.switchRowWrap}>
                <Pressable
                  style={[styles.switchCard, isLightTheme && styles.switchCardLight, form.is_responsible_for_iva && styles.switchCardActive]}
                  onPress={() =>
                    setForm((prev) => ({ ...prev, is_responsible_for_iva: !prev.is_responsible_for_iva }))
                  }
                >
                  <Text style={[styles.switchTitle, isLightTheme && styles.switchTitleLight]}>Responsable de IVA</Text>
                  <Text style={[styles.switchDesc, isLightTheme && styles.switchDescLight]}>{boolText(form.is_responsible_for_iva, 'Si', 'No')}</Text>
                </Pressable>

                <Pressable
                  style={[styles.switchCard, isLightTheme && styles.switchCardLight, form.obligated_accounting && styles.switchCardActive]}
                  onPress={() =>
                    setForm((prev) => ({ ...prev, obligated_accounting: !prev.obligated_accounting }))
                  }
                >
                  <Text style={[styles.switchTitle, isLightTheme && styles.switchTitleLight]}>Obligado contabilidad</Text>
                  <Text style={[styles.switchDesc, isLightTheme && styles.switchDescLight]}>{boolText(form.obligated_accounting, 'Si', 'No')}</Text>
                </Pressable>

                <Pressable
                  style={[
                    styles.switchCard,
                    isLightTheme && styles.switchCardLight,
                    form.electronic_invoicing_enabled && styles.switchCardActive,
                  ]}
                  onPress={() =>
                    setForm((prev) => ({
                      ...prev,
                      electronic_invoicing_enabled: !prev.electronic_invoicing_enabled,
                    }))
                  }
                >
                  <Text style={[styles.switchTitle, isLightTheme && styles.switchTitleLight]}>Acepta FE</Text>
                  <Text style={[styles.switchDesc, isLightTheme && styles.switchDescLight]}>
                    {boolText(form.electronic_invoicing_enabled, 'Si', 'No')}
                  </Text>
                </Pressable>

                <Pressable
                  style={[styles.switchCard, isLightTheme && styles.switchCardLight, form.is_active && styles.switchCardActive]}
                  onPress={() => setForm((prev) => ({ ...prev, is_active: !prev.is_active }))}
                >
                  <Text style={[styles.switchTitle, isLightTheme && styles.switchTitleLight]}>Activo</Text>
                  <Text style={[styles.switchDesc, isLightTheme && styles.switchDescLight]}>{boolText(form.is_active, 'Si', 'No')}</Text>
                </Pressable>
              </View>

                <Pressable style={styles.primaryBtn} onPress={save} disabled={saving}>
                  <Text style={styles.primaryBtnText}>{saving ? 'Guardando...' : 'Guardar'}</Text>
                </Pressable>
              </ScrollView>

              <Pressable onPress={() => setModalOpen(false)} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>Cerrar</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0f14', padding: 12 },
  containerLight: { backgroundColor: '#f8fafc' },
  toolbar: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  searchInput: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    color: '#f8fafc',
    paddingHorizontal: 10,
  },
  searchInputLight: {
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    color: '#0f172a',
  },
  searchBtn: {
    backgroundColor: '#1e40af',
    borderRadius: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBtnText: { color: '#dbeafe', fontWeight: '700' },
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
  filterChipActive: { backgroundColor: '#f59e0b', borderColor: '#f59e0b' },
  filterChipText: { color: '#cbd5e1', fontSize: 12, fontWeight: '600' },
  filterChipTextLight: { color: '#334155' },
  filterChipTextActive: { color: '#451a03' },
  card: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  cardLight: { borderColor: '#dbe4ef', backgroundColor: '#ffffff' },
  name: { color: '#f8fafc', fontWeight: '700', fontSize: 15 },
  nameLight: { color: '#0f172a' },
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
  badgeText: { color: '#e2e8f0', fontSize: 11, fontWeight: '700' },
  inlineActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  secondaryBtn: {
    flex: 1,
    backgroundColor: '#1e40af',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  secondaryBtnText: { color: '#dbeafe', fontWeight: '700' },
  dangerBtn: {
    flex: 1,
    backgroundColor: '#7f1d1d',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
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
  modalAvoider: { width: '100%' },
  modalBody: {
    height: '90%',
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    padding: 14,
  },
  modalBodyLight: { backgroundColor: '#f8fafc' },
  modalScroll: { flex: 1 },
  modalScrollContent: { paddingBottom: 20 },
  modalTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  modalTitleLight: { color: '#0f172a' },
  groupTitle: {
    color: '#93c5fd',
    marginTop: 10,
    marginBottom: 4,
    fontWeight: '700',
    fontSize: 13,
    textTransform: 'uppercase',
  },
  groupTitleLight: { color: '#1d4ed8' },
  rowTwo: { flexDirection: 'row', gap: 8 },
  flexInput: { flex: 1 },
  shortInput: { width: 90 },
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
  toggleRow: { flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 2 },
  typeHint: { color: '#94a3b8', fontSize: 12, marginTop: 8 },
  typeHintLight: { color: '#475569' },
  toggleBtn: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: '#111827',
  },
  toggleBtnLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  toggleBtnActive: { borderColor: '#2563eb', backgroundColor: '#172554' },
  toggleBtnText: { color: '#cbd5e1', fontSize: 12, fontWeight: '700' },
  toggleBtnTextLight: { color: '#334155' },
  toggleBtnTextActive: { color: '#bfdbfe' },
  methodChipsRow: { flexDirection: 'row', gap: 6 },
  methodChip: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#0b1220',
  },
  methodChipLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  methodChipActive: { backgroundColor: '#0ea5e9', borderColor: '#0ea5e9' },
  methodChipText: { color: '#cbd5e1', fontSize: 12, fontWeight: '600' },
  methodChipTextLight: { color: '#334155' },
  methodChipTextActive: { color: '#082f49' },
  taxRegimeList: { marginTop: 8, gap: 8 },
  taxRegimeItem: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#0b1220',
  },
  taxRegimeItemLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  taxRegimeItemActive: { borderColor: '#0ea5e9', backgroundColor: '#0b2942' },
  taxRegimeText: { color: '#cbd5e1', fontSize: 13, fontWeight: '600' },
  taxRegimeTextLight: { color: '#334155' },
  taxRegimeTextActive: { color: '#bae6fd' },
  switchRowWrap: { gap: 8, marginTop: 8 },
  switchCard: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#111827',
  },
  switchCardLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  switchCardActive: { borderColor: '#0ea5e9', backgroundColor: '#0f1f35' },
  switchTitle: { color: '#e2e8f0', fontSize: 13, fontWeight: '700' },
  switchTitleLight: { color: '#0f172a' },
  switchDesc: { color: '#93c5fd', fontSize: 12, marginTop: 4 },
  switchDescLight: { color: '#1d4ed8' },
  primaryBtn: {
    marginTop: 14,
    backgroundColor: '#d97706',
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
  },
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
});
