import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { getTenantConfig, saveTenantConfig } from '../services/setup.service';

const TABS = [
  { key: 'general', label: 'General' },
  { key: 'ui', label: 'Interfaz' },
  { key: 'ai', label: 'IA' },
  { key: 'inventory', label: 'Inventario' },
  { key: 'sales', label: 'Ventas' },
  { key: 'invoicing', label: 'Facturacion' },
  { key: 'notifications', label: 'Notificaciones' },
];

export default function TenantConfigScreen({ tenant, offlineMode, themeMode = 'dark', onLocalThemeChange }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState('general');
  const [tenantForm, setTenantForm] = useState({});
  const [settingsForm, setSettingsForm] = useState({});

  const load = async () => {
    if (!tenant?.tenant_id) return;
    setLoading(true);
    setError('');
    const result = await getTenantConfig(tenant.tenant_id, { offlineMode });
    if (!result.success) {
      setError(result.error || 'No fue posible cargar configuracion');
      setLoading(false);
      return;
    }

    setTenantForm(result.data?.tenant || {});
    setSettingsForm(result.data?.settings || {});
    setSource(result.source || '');
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [tenant?.tenant_id, offlineMode]);

  const setTenantField = (key, value) => {
    setTenantForm((prev) => ({ ...prev, [key]: value }));
  };
  const setSettingsField = (key, value) => {
    setSettingsForm((prev) => ({ ...prev, [key]: value }));
  };

  const onSave = async () => {
    if (offlineMode) {
      setError('No puedes guardar configuracion en modo offline.');
      return;
    }
    if (!String(tenantForm.name || '').trim()) {
      setError('El nombre de la empresa es obligatorio.');
      return;
    }

    setSaving(true);
    setError('');
    const result = await saveTenantConfig(tenant?.tenant_id, {
      tenant: {
        ...tenantForm,
        name: String(tenantForm.name || '').trim(),
      },
      settings: {
        ...settingsForm,
        default_page_size: Number(settingsForm.default_page_size || 20),
        session_timeout_minutes: Number(settingsForm.session_timeout_minutes || 60),
        ai_forecast_days_back: Number(settingsForm.ai_forecast_days_back || 90),
        ai_purchase_suggestion_days: Number(settingsForm.ai_purchase_suggestion_days || 14),
        expiry_alert_days: Number(settingsForm.expiry_alert_days || 30),
        max_discount_without_auth: Number(settingsForm.max_discount_without_auth || 5),
        rounding_multiple: Number(settingsForm.rounding_multiple || 100),
        cash_session_max_hours: Number(settingsForm.cash_session_max_hours || 24),
        next_invoice_number: Number(settingsForm.next_invoice_number || 1),
        thermal_paper_width: Number(settingsForm.thermal_paper_width || 80),
      },
    });

    if (!result.success) {
      setError(result.error || 'No fue posible guardar configuracion.');
      setSaving(false);
      return;
    }

    if (onLocalThemeChange) {
      await onLocalThemeChange(settingsForm.theme || 'dark');
    }
    setSaving(false);
    await load();
  };

  const yesNoButton = (value, onChange) => (
    <View style={styles.segmentRow}>
      <Pressable
        style={[styles.segmentBtn, value === true && styles.segmentBtnActive]}
        onPress={() => onChange(true)}
      >
        <Text style={[styles.segmentText, value === true && styles.segmentTextActive]}>Si</Text>
      </Pressable>
      <Pressable
        style={[styles.segmentBtn, value === false && styles.segmentBtnActive]}
        onPress={() => onChange(false)}
      >
        <Text style={[styles.segmentText, value === false && styles.segmentTextActive]}>No</Text>
      </Pressable>
    </View>
  );

  return (
    <View style={styles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersScroll}>
        <View style={styles.chipsRow}>
          {TABS.map((entry) => {
            const active = tab === entry.key;
            return (
              <Pressable
                key={entry.key}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => setTab(entry.key)}
              >
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{entry.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <ScrollView>
        {tab === 'general' ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Informacion General</Text>
            <TextInput style={styles.input} value={tenantForm.name || ''} onChangeText={(v) => setTenantField('name', v)} placeholder="Nombre empresa" placeholderTextColor="#64748b" />
            <TextInput style={styles.input} value={tenantForm.tax_id || ''} onChangeText={(v) => setTenantField('tax_id', v)} placeholder="NIT / Tax ID" placeholderTextColor="#64748b" />
            <TextInput style={styles.input} value={tenantForm.currency_code || ''} onChangeText={(v) => setTenantField('currency_code', v)} placeholder="Moneda (COP, USD...)" placeholderTextColor="#64748b" />
            <TextInput style={styles.input} value={settingsForm.business_name || ''} onChangeText={(v) => setSettingsField('business_name', v)} placeholder="Nombre comercial" placeholderTextColor="#64748b" />
            <TextInput style={styles.input} value={settingsForm.business_phone || ''} onChangeText={(v) => setSettingsField('business_phone', v)} placeholder="Telefono" placeholderTextColor="#64748b" />
            <TextInput style={styles.input} value={settingsForm.business_address || ''} onChangeText={(v) => setSettingsField('business_address', v)} placeholder="Direccion" placeholderTextColor="#64748b" />
            <TextInput style={styles.input} value={settingsForm.logo_url || ''} onChangeText={(v) => setSettingsField('logo_url', v)} placeholder="URL Logo" placeholderTextColor="#64748b" />
            <TextInput style={[styles.input, styles.inputMulti]} value={settingsForm.receipt_footer || ''} onChangeText={(v) => setSettingsField('receipt_footer', v)} placeholder="Pie de recibo" placeholderTextColor="#64748b" multiline />
            <Text style={styles.inlineLabel}>Impuesto incluido por defecto</Text>
            {yesNoButton(Boolean(settingsForm.default_tax_included), (v) => setSettingsField('default_tax_included', v))}
          </View>
        ) : null}

        {tab === 'ui' ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Interfaz</Text>
            <TextInput style={styles.input} value={String(settingsForm.default_page_size ?? '')} onChangeText={(v) => setSettingsField('default_page_size', v)} placeholder="Registros por pagina" keyboardType="numeric" placeholderTextColor="#64748b" />
            <TextInput style={styles.input} value={settingsForm.theme || ''} onChangeText={(v) => setSettingsField('theme', v)} placeholder="Tema (light/dark/auto)" placeholderTextColor="#64748b" />
            <Text style={styles.inlineLabel}>Tema activo cache/local</Text>
            <View style={styles.segmentRow}>
              <Pressable
                style={[styles.segmentBtn, (themeMode === 'light') && styles.segmentBtnActive]}
                onPress={async () => {
                  setSettingsField('theme', 'light');
                  if (onLocalThemeChange) await onLocalThemeChange('light');
                }}
              >
                <Text style={[styles.segmentText, (themeMode === 'light') && styles.segmentTextActive]}>Claro</Text>
              </Pressable>
              <Pressable
                style={[styles.segmentBtn, (themeMode !== 'light') && styles.segmentBtnActive]}
                onPress={async () => {
                  setSettingsField('theme', 'dark');
                  if (onLocalThemeChange) await onLocalThemeChange('dark');
                }}
              >
                <Text style={[styles.segmentText, (themeMode !== 'light') && styles.segmentTextActive]}>Oscuro</Text>
              </Pressable>
            </View>
            <TextInput style={styles.input} value={settingsForm.date_format || ''} onChangeText={(v) => setSettingsField('date_format', v)} placeholder="Formato fecha" placeholderTextColor="#64748b" />
            <TextInput style={styles.input} value={settingsForm.locale || ''} onChangeText={(v) => setSettingsField('locale', v)} placeholder="Locale (es-CO)" placeholderTextColor="#64748b" />
            <TextInput style={styles.input} value={String(settingsForm.session_timeout_minutes ?? '')} onChangeText={(v) => setSettingsField('session_timeout_minutes', v)} placeholder="Timeout sesion minutos" keyboardType="numeric" placeholderTextColor="#64748b" />
          </View>
        ) : null}

        {tab === 'ai' ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Inteligencia IA</Text>
            <TextInput style={styles.input} value={String(settingsForm.ai_forecast_days_back ?? '')} onChangeText={(v) => setSettingsField('ai_forecast_days_back', v)} placeholder="Dias historial pronostico" keyboardType="numeric" placeholderTextColor="#64748b" />
            <TextInput style={styles.input} value={String(settingsForm.ai_purchase_suggestion_days ?? '')} onChangeText={(v) => setSettingsField('ai_purchase_suggestion_days', v)} placeholder="Dias sugerencia compras" keyboardType="numeric" placeholderTextColor="#64748b" />
            <Text style={styles.inlineLabel}>Asesor compras IA</Text>
            {yesNoButton(Boolean(settingsForm.ai_purchase_advisor_enabled), (v) => setSettingsField('ai_purchase_advisor_enabled', v))}
            <Text style={styles.inlineLabel}>Pronostico ventas IA</Text>
            {yesNoButton(Boolean(settingsForm.ai_sales_forecast_enabled), (v) => setSettingsField('ai_sales_forecast_enabled', v))}
          </View>
        ) : null}

        {tab === 'inventory' ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Inventario</Text>
            <TextInput style={styles.input} value={String(settingsForm.expiry_alert_days ?? '')} onChangeText={(v) => setSettingsField('expiry_alert_days', v)} placeholder="Dias alerta vencimiento" keyboardType="numeric" placeholderTextColor="#64748b" />
            <Text style={styles.inlineLabel}>Reservar stock en plan separe</Text>
            {yesNoButton(Boolean(settingsForm.reserve_stock_on_layaway), (v) => setSettingsField('reserve_stock_on_layaway', v))}
          </View>
        ) : null}

        {tab === 'sales' ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Ventas y Precios</Text>
            <TextInput style={styles.input} value={String(settingsForm.max_discount_without_auth ?? '')} onChangeText={(v) => setSettingsField('max_discount_without_auth', v)} placeholder="Descuento maximo cajero %" keyboardType="numeric" placeholderTextColor="#64748b" />
            <TextInput style={styles.input} value={settingsForm.rounding_method || ''} onChangeText={(v) => setSettingsField('rounding_method', v)} placeholder="Redondeo (normal/up/down/none)" placeholderTextColor="#64748b" />
            <TextInput style={styles.input} value={String(settingsForm.rounding_multiple ?? '')} onChangeText={(v) => setSettingsField('rounding_multiple', v)} placeholder="Multiplo redondeo" keyboardType="numeric" placeholderTextColor="#64748b" />
            <TextInput style={styles.input} value={String(settingsForm.cash_session_max_hours ?? '')} onChangeText={(v) => setSettingsField('cash_session_max_hours', v)} placeholder="Max horas sesion caja" keyboardType="numeric" placeholderTextColor="#64748b" />
          </View>
        ) : null}

        {tab === 'invoicing' ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Facturacion</Text>
            <TextInput style={styles.input} value={settingsForm.invoice_prefix || ''} onChangeText={(v) => setSettingsField('invoice_prefix', v)} placeholder="Prefijo factura" placeholderTextColor="#64748b" />
            <TextInput style={styles.input} value={String(settingsForm.next_invoice_number ?? '')} onChangeText={(v) => setSettingsField('next_invoice_number', v)} placeholder="Siguiente consecutivo" keyboardType="numeric" placeholderTextColor="#64748b" />
            <TextInput style={styles.input} value={settingsForm.print_format || ''} onChangeText={(v) => setSettingsField('print_format', v)} placeholder="Formato impresion (thermal/letter)" placeholderTextColor="#64748b" />
            <TextInput style={styles.input} value={String(settingsForm.thermal_paper_width ?? '')} onChangeText={(v) => setSettingsField('thermal_paper_width', v)} placeholder="Ancho papel termico" keyboardType="numeric" placeholderTextColor="#64748b" />
            <Text style={styles.inlineLabel}>Facturacion electronica habilitada</Text>
            {yesNoButton(Boolean(settingsForm.electronic_invoicing_enabled), (v) => setSettingsField('electronic_invoicing_enabled', v))}

            <Text style={styles.sectionTitle}>Datos Fiscales Emisor</Text>
            <TextInput style={styles.input} value={tenantForm.dv || ''} onChangeText={(v) => setTenantField('dv', v)} placeholder="DV" placeholderTextColor="#64748b" />
            <TextInput style={styles.input} value={tenantForm.trade_name || ''} onChangeText={(v) => setTenantField('trade_name', v)} placeholder="Nombre comercial" placeholderTextColor="#64748b" />
            <TextInput style={styles.input} value={tenantForm.tax_regime || ''} onChangeText={(v) => setTenantField('tax_regime', v)} placeholder="Regimen DIAN (48,49,O-13,ZZ)" placeholderTextColor="#64748b" />
            <TextInput style={styles.input} value={tenantForm.ciiu_code || ''} onChangeText={(v) => setTenantField('ciiu_code', v)} placeholder="Codigo CIIU" placeholderTextColor="#64748b" />
            <TextInput style={styles.input} value={tenantForm.fiscal_email || ''} onChangeText={(v) => setTenantField('fiscal_email', v)} placeholder="Email fiscal" placeholderTextColor="#64748b" />
            <TextInput style={styles.input} value={tenantForm.fiscal_phone || ''} onChangeText={(v) => setTenantField('fiscal_phone', v)} placeholder="Telefono fiscal" placeholderTextColor="#64748b" />
            <Text style={styles.inlineLabel}>Responsable IVA</Text>
            {yesNoButton(Boolean(tenantForm.is_responsible_for_iva), (v) => setTenantField('is_responsible_for_iva', v))}
            <Text style={styles.inlineLabel}>Obligado a contabilidad</Text>
            {yesNoButton(Boolean(tenantForm.obligated_accounting), (v) => setTenantField('obligated_accounting', v))}
            <TextInput style={styles.input} value={tenantForm.address || ''} onChangeText={(v) => setTenantField('address', v)} placeholder="Direccion fiscal" placeholderTextColor="#64748b" />
            <TextInput style={styles.input} value={tenantForm.city || ''} onChangeText={(v) => setTenantField('city', v)} placeholder="Ciudad" placeholderTextColor="#64748b" />
            <TextInput style={styles.input} value={tenantForm.department || ''} onChangeText={(v) => setTenantField('department', v)} placeholder="Departamento" placeholderTextColor="#64748b" />
            <TextInput style={styles.input} value={tenantForm.country_code || ''} onChangeText={(v) => setTenantField('country_code', v)} placeholder="Pais (CO)" placeholderTextColor="#64748b" />
            <TextInput style={styles.input} value={tenantForm.postal_code || ''} onChangeText={(v) => setTenantField('postal_code', v)} placeholder="Codigo postal" placeholderTextColor="#64748b" />
            <TextInput style={styles.input} value={tenantForm.city_code || ''} onChangeText={(v) => setTenantField('city_code', v)} placeholder="Codigo DANE ciudad" placeholderTextColor="#64748b" />
          </View>
        ) : null}

        {tab === 'notifications' ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Notificaciones</Text>
            <Text style={styles.inlineLabel}>Alertas por email</Text>
            {yesNoButton(Boolean(settingsForm.email_alerts_enabled), (v) => setSettingsField('email_alerts_enabled', v))}
            <TextInput style={styles.input} value={settingsForm.alert_email || ''} onChangeText={(v) => setSettingsField('alert_email', v)} placeholder="Email alertas" placeholderTextColor="#64748b" />
            <Text style={styles.inlineLabel}>Notificar stock bajo</Text>
            {yesNoButton(Boolean(settingsForm.notify_low_stock), (v) => setSettingsField('notify_low_stock', v))}
            <Text style={styles.inlineLabel}>Notificar productos por vencer</Text>
            {yesNoButton(Boolean(settingsForm.notify_expiring_products), (v) => setSettingsField('notify_expiring_products', v))}
          </View>
        ) : null}
      </ScrollView>

      {source ? <Text style={styles.meta}>Origen: {source}</Text> : null}
      {loading ? <Text style={styles.meta}>Cargando...</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={styles.primaryBtn} onPress={onSave} disabled={saving || loading}>
        <Text style={styles.primaryBtnText}>{saving ? 'Guardando...' : 'Guardar configuracion'}</Text>
      </Pressable>
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
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    backgroundColor: '#111827',
    padding: 12,
    marginBottom: 8,
  },
  sectionTitle: { color: '#f8fafc', fontSize: 15, fontWeight: '700', marginBottom: 6, marginTop: 4 },
  inlineLabel: { color: '#cbd5e1', fontSize: 12, marginTop: 8, marginBottom: 4 },
  input: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 10,
    color: '#f8fafc',
    marginTop: 8,
    backgroundColor: '#0f172a',
  },
  inputMulti: { minHeight: 84, textAlignVertical: 'top', paddingTop: 10 },
  segmentRow: { flexDirection: 'row', gap: 8 },
  segmentBtn: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    paddingVertical: 8,
    alignItems: 'center',
  },
  segmentBtnActive: { borderColor: '#0ea5e9', backgroundColor: '#0b2942' },
  segmentText: { color: '#cbd5e1', fontWeight: '700', fontSize: 12 },
  segmentTextActive: { color: '#bae6fd' },
  meta: { color: '#94a3b8', marginTop: 8, fontSize: 12 },
  error: { color: '#f87171', marginTop: 8, fontSize: 13 },
  primaryBtn: {
    marginTop: 10,
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700' },
});
