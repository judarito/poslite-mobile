import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

const OPTIONS = [
  { key: 'TenantConfig', title: 'Empresa', subtitle: 'Parametros generales del tenant' },
  { key: 'Locations', title: 'Sedes', subtitle: 'Gestion de sedes y direcciones' },
  { key: 'Taxes', title: 'Impuestos', subtitle: 'Tarifas y codigos tributarios' },
  { key: 'TaxRules', title: 'Reglas de Impuesto', subtitle: 'Asignacion de impuesto por alcance' },
  { key: 'PricingRules', title: 'Reglas de Precio', subtitle: 'Precios por sede/regla comercial' },
  { key: 'Users', title: 'Usuarios', subtitle: 'Usuarios del tenant y roles' },
  { key: 'RolesMenus', title: 'Roles y Menus', subtitle: 'Gestion centralizada por superadmin' },
];

export default function SetupScreen({ onOpenScreen }) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Configuracion</Text>
      <Text style={styles.subtitle}>Selecciona el modulo que deseas administrar</Text>

      {OPTIONS.map((option) => (
        <Pressable
          key={option.key}
          style={styles.card}
          onPress={() => onOpenScreen?.(option.key)}
        >
          <View>
            <Text style={styles.cardTitle}>{option.title}</Text>
            <Text style={styles.cardSubtitle}>{option.subtitle}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    backgroundColor: '#0b0f14',
  },
  title: { color: '#f8fafc', fontWeight: '700', fontSize: 22 },
  subtitle: { color: '#94a3b8', marginTop: 4, marginBottom: 10, fontSize: 13 },
  card: {
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    backgroundColor: '#111827',
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: { color: '#e2e8f0', fontWeight: '700', fontSize: 15 },
  cardSubtitle: { color: '#94a3b8', marginTop: 2, fontSize: 12 },
  chevron: { color: '#60a5fa', fontWeight: '700', fontSize: 24, lineHeight: 24 },
});
