import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

const OPTIONS = [
  {
    key: 'TenantConfig',
    title: 'Empresa',
    subtitle: 'Parametros generales del tenant',
    icon: 'business-outline',
    accent: '#4db7ff',
  },
  {
    key: 'AIInsights',
    title: 'Centro IA',
    subtitle: 'Analitica y consultas inteligentes',
    icon: 'sparkles-outline',
    accent: '#8f7cff',
  },
  {
    key: 'Locations',
    title: 'Sedes',
    subtitle: 'Gestion de sedes y direcciones',
    icon: 'location-outline',
    accent: '#57d65a',
  },
  {
    key: 'Taxes',
    title: 'Impuestos',
    subtitle: 'Tarifas y codigos tributarios',
    icon: 'pricetag-outline',
    accent: '#f7c843',
  },
  {
    key: 'TaxRules',
    title: 'Reglas de Impuesto',
    subtitle: 'Asignacion de impuesto por alcance',
    icon: 'document-text-outline',
    accent: '#8f7cff',
  },
  {
    key: 'PricingRules',
    title: 'Reglas de Precio',
    subtitle: 'Precios por sede/regla comercial',
    icon: 'trending-up-outline',
    accent: '#ffb347',
  },
  {
    key: 'Users',
    title: 'Usuarios',
    subtitle: 'Usuarios del tenant y roles',
    icon: 'people-outline',
    accent: '#4db7ff',
  },
  {
    key: 'RolesMenus',
    title: 'Roles y Menus',
    subtitle: 'Roles, permisos y asignacion de menus',
    icon: 'shield-checkmark-outline',
    accent: '#57d65a',
  },
];

export default function SetupScreen({ onOpenScreen, themeMode = 'dark' }) {
  const isLightTheme = themeMode === 'light';
  return (
    <ScrollView contentContainerStyle={[styles.container, isLightTheme && styles.containerLight]}>
      <Text style={[styles.title, isLightTheme && styles.titleLight]}>Configuracion</Text>
      <Text style={[styles.subtitle, isLightTheme && styles.subtitleLight]}>
        Selecciona el modulo que deseas administrar
      </Text>

      <View style={styles.gridWrap}>
        {OPTIONS.map((option) => (
          <Pressable
            key={option.key}
            style={[styles.card, isLightTheme && styles.cardLight]}
            onPress={() => onOpenScreen?.(option.key)}
          >
            <View
              style={[
                styles.iconBadge,
                {
                  backgroundColor: `${option.accent}20`,
                  borderColor: `${option.accent}66`,
                },
              ]}
            >
              <Ionicons name={option.icon} size={18} color={option.accent} />
            </View>
            <Text style={[styles.cardTitle, isLightTheme && styles.cardTitleLight]}>{option.title}</Text>
            <Text style={[styles.cardSubtitle, isLightTheme && styles.cardSubtitleLight]} numberOfLines={2}>
              {option.subtitle}
            </Text>
            <View style={styles.cardFooter}>
              <Text style={[styles.cardAction, isLightTheme && styles.cardActionLight]}>Abrir modulo</Text>
              <Ionicons
                name="chevron-forward"
                size={16}
                style={[styles.chevron, isLightTheme && styles.chevronLight]}
              />
            </View>
          </Pressable>
        ))}
      </View>

      <View style={[styles.helperCard, isLightTheme && styles.helperCardLight]}>
        <Text style={[styles.helperTitle, isLightTheme && styles.helperTitleLight]}>Flujo recomendado</Text>
        <Text style={[styles.helperLine, isLightTheme && styles.helperLineLight]}>1. Empresa y tema</Text>
        <Text style={[styles.helperLine, isLightTheme && styles.helperLineLight]}>2. Sedes e impuestos</Text>
        <Text style={[styles.helperLine, isLightTheme && styles.helperLineLight]}>3. Usuarios, roles y permisos</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    backgroundColor: '#060b16',
  },
  containerLight: {
    backgroundColor: '#edf2fb',
  },
  title: { color: '#f8fafc', fontWeight: '700', fontSize: 22 },
  titleLight: { color: '#0f172a' },
  subtitle: { color: '#94a3b8', marginTop: 4, marginBottom: 10, fontSize: 13 },
  subtitleLight: { color: '#475569' },
  gridWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  card: {
    borderWidth: 1,
    borderColor: '#223a5e',
    borderRadius: 14,
    backgroundColor: '#0f182b',
    padding: 12,
    minHeight: 148,
    width: '48%',
  },
  cardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  iconBadge: {
    width: 38,
    height: 38,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  cardTitle: { color: '#e2e8f0', fontWeight: '700', fontSize: 15 },
  cardTitleLight: { color: '#0f172a' },
  cardSubtitle: { color: '#94a3b8', marginTop: 4, fontSize: 12, lineHeight: 16 },
  cardSubtitleLight: { color: '#64748b' },
  cardFooter: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  cardAction: { color: '#8ec5ff', fontWeight: '700', fontSize: 11, textTransform: 'uppercase' },
  cardActionLight: { color: '#235ea9' },
  chevron: { color: '#60a5fa' },
  chevronLight: { color: '#235ea9' },
  helperCard: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#223a5e',
    borderRadius: 14,
    backgroundColor: '#0f182b',
    padding: 12,
  },
  helperCardLight: {
    borderColor: '#d5e2f4',
    backgroundColor: '#ffffff',
  },
  helperTitle: { color: '#e2e8f0', fontSize: 14, fontWeight: '800', marginBottom: 6 },
  helperTitleLight: { color: '#0f172a' },
  helperLine: { color: '#9fb7dc', fontSize: 13, marginTop: 2 },
  helperLineLight: { color: '#47638b' },
});
