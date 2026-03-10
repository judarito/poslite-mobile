import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { useThemeMode } from '../lib/themeMode';

export default function SetupPlaceholderScreen({ title, message }) {
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';
  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={[styles.card, isLightTheme && styles.cardLight]}>
        <View style={[styles.iconBadge, isLightTheme && styles.iconBadgeLight]}>
          <Ionicons name="construct-outline" size={18} color={isLightTheme ? '#235ea9' : '#8ec5ff'} />
        </View>
        <Text style={[styles.title, isLightTheme && styles.titleLight]}>{title || 'Configuracion'}</Text>
        <Text style={[styles.message, isLightTheme && styles.messageLight]}>
          {message || 'Este modulo se implementara en la siguiente iteracion siguiendo la logica de la web.'}
        </Text>
        <Text style={[styles.hint, isLightTheme && styles.hintLight]}>
          Sigue disponible desde web mientras completamos la experiencia mobile.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#060b16', padding: 12 },
  containerLight: { backgroundColor: '#edf2fb' },
  card: {
    borderWidth: 1,
    borderColor: '#223a5e',
    borderRadius: 14,
    backgroundColor: '#0f182b',
    padding: 12,
  },
  cardLight: { borderColor: '#d5e2f4', backgroundColor: '#ffffff' },
  iconBadge: {
    width: 38,
    height: 38,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#365680',
    backgroundColor: '#16253f',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  iconBadgeLight: {
    borderColor: '#cfddf0',
    backgroundColor: '#f7fbff',
  },
  title: { color: '#f8fafc', fontWeight: '700', fontSize: 18 },
  titleLight: { color: '#0f172a' },
  message: { color: '#94a3b8', marginTop: 6, fontSize: 13, lineHeight: 18 },
  messageLight: { color: '#475569' },
  hint: {
    marginTop: 10,
    color: '#8ec5ff',
    fontSize: 12,
    fontWeight: '600',
  },
  hintLight: {
    color: '#235ea9',
  },
});
