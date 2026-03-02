import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export default function PaginatedList({
  title,
  loading,
  error,
  items,
  emptyText = 'Sin datos',
  page,
  totalPages,
  onPrev,
  onNext,
  renderItem,
  headerRight = null,
  footerMeta = null,
}) {
  return (
    <View style={styles.container}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{title}</Text>
        {headerRight}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <ActivityIndicator color="#38bdf8" style={{ marginTop: 24 }} />
      ) : (
        <ScrollView style={styles.list}>
          {items.length === 0 ? <Text style={styles.empty}>{emptyText}</Text> : null}
          {items.map(renderItem)}
        </ScrollView>
      )}

      {footerMeta ? <Text style={styles.meta}>{footerMeta}</Text> : null}

      <View style={styles.pagination}>
        <Pressable style={[styles.pageBtn, page <= 1 && styles.disabled]} onPress={onPrev} disabled={page <= 1}>
          <Text style={styles.pageBtnText}>Anterior</Text>
        </Pressable>
        <Text style={styles.pageText}>
          {page}/{totalPages}
        </Text>
        <Pressable style={[styles.pageBtn, page >= totalPages && styles.disabled]} onPress={onNext} disabled={page >= totalPages}>
          <Text style={styles.pageBtnText}>Siguiente</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { color: '#f8fafc', fontSize: 20, fontWeight: '700' },
  list: { flex: 1 },
  error: { color: '#f87171', marginBottom: 8 },
  empty: { color: '#94a3b8', marginTop: 14, textAlign: 'center' },
  meta: { color: '#64748b', fontSize: 12, marginTop: 6 },
  pagination: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8 },
  pageBtn: { backgroundColor: '#1e293b', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  disabled: { opacity: 0.35 },
  pageBtnText: { color: '#e2e8f0', fontWeight: '700' },
  pageText: { color: '#94a3b8' },
});
