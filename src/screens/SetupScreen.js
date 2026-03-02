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

export default function SetupScreen({ onOpenScreen, themeMode = 'dark' }) {
  const isLightTheme = themeMode === 'light';
  return (
    <ScrollView contentContainerStyle={[styles.container, isLightTheme && styles.containerLight]}>
      <Text style={[styles.title, isLightTheme && styles.titleLight]}>Configuracion</Text>
      <Text style={[styles.subtitle, isLightTheme && styles.subtitleLight]}>
        Selecciona el modulo que deseas administrar
      </Text>

      {OPTIONS.map((option) => (
        <Pressable
          key={option.key}
          style={[styles.card, isLightTheme && styles.cardLight]}
          onPress={() => onOpenScreen?.(option.key)}
        >
          <View>
            <Text style={[styles.cardTitle, isLightTheme && styles.cardTitleLight]}>{option.title}</Text>
            <Text style={[styles.cardSubtitle, isLightTheme && styles.cardSubtitleLight]}>
              {option.subtitle}
            </Text>
          </View>
          <Text style={[styles.chevron, isLightTheme && styles.chevronLight]}>›</Text>
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
  containerLight: {
    backgroundColor: '#f8fafc',
  },
  title: { color: '#f8fafc', fontWeight: '700', fontSize: 22 },
  titleLight: { color: '#0f172a' },
  subtitle: { color: '#94a3b8', marginTop: 4, marginBottom: 10, fontSize: 13 },
  subtitleLight: { color: '#475569' },
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
  cardLight: {
    borderColor: '#dbe4ef',
    backgroundColor: '#ffffff',
  },
  cardTitle: { color: '#e2e8f0', fontWeight: '700', fontSize: 15 },
  cardTitleLight: { color: '#0f172a' },
  cardSubtitle: { color: '#94a3b8', marginTop: 2, fontSize: 12 },
  cardSubtitleLight: { color: '#64748b' },
  chevron: { color: '#60a5fa', fontWeight: '700', fontSize: 24, lineHeight: 24 },
  chevronLight: { color: '#2563eb' },
});
