import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useThemeMode } from '../lib/themeMode';
import { getAboutSummary } from '../services/setup.service';

export default function AboutScreen({ tenant, userProfile, offlineMode }) {
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';
  const [stats, setStats] = useState({
    products: '...',
    sales: '...',
    customers: '...',
    locations: '...',
  });
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      if (!tenant?.tenant_id || offlineMode) return;
      const result = await getAboutSummary(tenant.tenant_id);
      if (!result.success) {
        setError(result.error || 'No fue posible cargar estadisticas');
        return;
      }
      setStats(result.data);
    };
    load();
  }, [tenant?.tenant_id, offlineMode]);

  return (
    <ScrollView contentContainerStyle={[styles.container, isLightTheme && styles.containerLight]}>
      <Text style={[styles.title, isLightTheme && styles.titleLight]}>Acerca de POSLite</Text>
      <Text style={[styles.subtitle, isLightTheme && styles.subtitleLight]}>Sistema de Punto de Venta</Text>

      <View style={[styles.card, isLightTheme && styles.cardLight]}>
        <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Sistema</Text>
        <Text style={[styles.line, isLightTheme && styles.lineLight]}>Version: 1.0.0</Text>
        <Text style={[styles.line, isLightTheme && styles.lineLight]}>Entorno: Mobile</Text>
        <Text style={[styles.line, isLightTheme && styles.lineLight]}>Actualizacion: Marzo 2026</Text>
      </View>

      <View style={[styles.card, isLightTheme && styles.cardLight]}>
        <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Negocio</Text>
        <Text style={[styles.line, isLightTheme && styles.lineLight]}>Empresa: {tenant?.tenant_name || '-'}</Text>
        <Text style={[styles.line, isLightTheme && styles.lineLight]}>Usuario: {userProfile?.full_name || '-'}</Text>
        <Text style={[styles.line, isLightTheme && styles.lineLight]}>Moneda: {tenant?.currency_code || 'COP'}</Text>
      </View>

      <View style={[styles.card, isLightTheme && styles.cardLight]}>
        <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Estadisticas</Text>
        <Text style={[styles.line, isLightTheme && styles.lineLight]}>Productos: {stats.products}</Text>
        <Text style={[styles.line, isLightTheme && styles.lineLight]}>Ventas: {stats.sales}</Text>
        <Text style={[styles.line, isLightTheme && styles.lineLight]}>Clientes: {stats.customers}</Text>
        <Text style={[styles.line, isLightTheme && styles.lineLight]}>Sedes: {stats.locations}</Text>
      </View>

      <View style={[styles.card, isLightTheme && styles.cardLight]}>
        <Text style={[styles.sectionTitle, isLightTheme && styles.sectionTitleLight]}>Capacidades</Text>
        <Text style={[styles.line, isLightTheme && styles.lineLight]}>- Punto de venta e inventario multi-sede</Text>
        <Text style={[styles.line, isLightTheme && styles.lineLight]}>- Caja, reportes y configuracion por tenant</Text>
        <Text style={[styles.line, isLightTheme && styles.lineLight]}>- Modo offline con sincronizacion diferida</Text>
      </View>

      {offlineMode ? <Text style={[styles.meta, isLightTheme && styles.metaLight]}>Modo offline: estadisticas en tiempo real no disponibles.</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#0b0f14', padding: 12 },
  containerLight: { backgroundColor: '#f8fafc' },
  title: { color: '#f8fafc', fontWeight: '700', fontSize: 22 },
  titleLight: { color: '#0f172a' },
  subtitle: { color: '#94a3b8', marginTop: 2, marginBottom: 8 },
  subtitleLight: { color: '#475569' },
  card: {
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    backgroundColor: '#111827',
    padding: 12,
    marginBottom: 8,
  },
  cardLight: { borderColor: '#dbe4ef', backgroundColor: '#ffffff' },
  sectionTitle: { color: '#e2e8f0', fontWeight: '700', marginBottom: 4 },
  sectionTitleLight: { color: '#0f172a' },
  line: { color: '#cbd5e1', marginTop: 2, fontSize: 13 },
  lineLight: { color: '#334155' },
  meta: { color: '#94a3b8', marginTop: 8, fontSize: 12 },
  metaLight: { color: '#475569' },
  error: { color: '#f87171', marginTop: 8, fontSize: 12 },
});
