import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { getAboutSummary } from '../services/setup.service';

export default function AboutScreen({ tenant, userProfile, offlineMode }) {
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
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Acerca de POSLite</Text>
      <Text style={styles.subtitle}>Sistema de Punto de Venta</Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Sistema</Text>
        <Text style={styles.line}>Version: 1.0.0</Text>
        <Text style={styles.line}>Entorno: Mobile</Text>
        <Text style={styles.line}>Actualizacion: Marzo 2026</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Negocio</Text>
        <Text style={styles.line}>Empresa: {tenant?.tenant_name || '-'}</Text>
        <Text style={styles.line}>Usuario: {userProfile?.full_name || '-'}</Text>
        <Text style={styles.line}>Moneda: {tenant?.currency_code || 'COP'}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Estadisticas</Text>
        <Text style={styles.line}>Productos: {stats.products}</Text>
        <Text style={styles.line}>Ventas: {stats.sales}</Text>
        <Text style={styles.line}>Clientes: {stats.customers}</Text>
        <Text style={styles.line}>Sedes: {stats.locations}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Capacidades</Text>
        <Text style={styles.line}>- Punto de venta e inventario multi-sede</Text>
        <Text style={styles.line}>- Caja, reportes y configuracion por tenant</Text>
        <Text style={styles.line}>- Modo offline con sincronizacion diferida</Text>
      </View>

      {offlineMode ? <Text style={styles.meta}>Modo offline: estadisticas en tiempo real no disponibles.</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#0b0f14', padding: 12 },
  title: { color: '#f8fafc', fontWeight: '700', fontSize: 22 },
  subtitle: { color: '#94a3b8', marginTop: 2, marginBottom: 8 },
  card: {
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    backgroundColor: '#111827',
    padding: 12,
    marginBottom: 8,
  },
  sectionTitle: { color: '#e2e8f0', fontWeight: '700', marginBottom: 4 },
  line: { color: '#cbd5e1', marginTop: 2, fontSize: 13 },
  meta: { color: '#94a3b8', marginTop: 8, fontSize: 12 },
  error: { color: '#f87171', marginTop: 8, fontSize: 12 },
});
