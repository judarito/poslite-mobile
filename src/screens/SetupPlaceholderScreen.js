import { StyleSheet, Text, View } from 'react-native';

export default function SetupPlaceholderScreen({ title, message }) {
  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>{title || 'Configuracion'}</Text>
        <Text style={styles.message}>
          {message || 'Este modulo se implementara en la siguiente iteracion siguiendo la logica de la web.'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0f14', padding: 12 },
  card: {
    borderWidth: 1,
    borderColor: '#1f2937',
    borderRadius: 12,
    backgroundColor: '#111827',
    padding: 12,
  },
  title: { color: '#f8fafc', fontWeight: '700', fontSize: 18 },
  message: { color: '#94a3b8', marginTop: 6, fontSize: 13, lineHeight: 18 },
});
