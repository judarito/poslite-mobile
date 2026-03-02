import { StyleSheet, Text, View } from 'react-native';
import { useThemeMode } from '../lib/themeMode';

export default function SetupPlaceholderScreen({ title, message }) {
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';
  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={[styles.card, isLightTheme && styles.cardLight]}>
        <Text style={[styles.title, isLightTheme && styles.titleLight]}>{title || 'Configuracion'}</Text>
        <Text style={[styles.message, isLightTheme && styles.messageLight]}>
          {message || 'Este modulo se implementara en la siguiente iteracion siguiendo la logica de la web.'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0f14', padding: 12 },
  containerLight: { backgroundColor: '#f8fafc' },
  card: {
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    backgroundColor: '#111827',
    padding: 12,
  },
  cardLight: { borderColor: '#dbe4ef', backgroundColor: '#ffffff' },
  title: { color: '#f8fafc', fontWeight: '700', fontSize: 18 },
  titleLight: { color: '#0f172a' },
  message: { color: '#94a3b8', marginTop: 6, fontSize: 13, lineHeight: 18 },
  messageLight: { color: '#475569' },
});
