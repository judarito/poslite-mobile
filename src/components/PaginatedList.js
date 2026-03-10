import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useThemeMode } from '../lib/themeMode';
import { COMPONENT_THEME_COLORS } from '../theme/colors';

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
  themeMode,
}) {
  const contextThemeMode = useThemeMode();
  const resolvedThemeMode = themeMode || contextThemeMode || 'dark';
  const isLightTheme = resolvedThemeMode === 'light';
  return (
    <View style={[styles.container, isLightTheme && styles.containerLight]}>
      <View style={[styles.surface, isLightTheme && styles.surfaceLight]}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, isLightTheme && styles.titleLight]}>{title}</Text>
          {headerRight}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {loading ? (
          <ActivityIndicator color={COMPONENT_THEME_COLORS.paginatedList.dark.loadingIndicator} style={{ marginTop: 24 }} />
        ) : (
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {items.length === 0 ? <Text style={[styles.empty, isLightTheme && styles.emptyLight]}>{emptyText}</Text> : null}
            {items.map(renderItem)}
          </ScrollView>
        )}

        {footerMeta ? <Text style={[styles.meta, isLightTheme && styles.metaLight]}>{footerMeta}</Text> : null}

        <View style={styles.pagination}>
          <Pressable style={[styles.pageBtn, isLightTheme && styles.pageBtnLight, page <= 1 && styles.disabled]} onPress={onPrev} disabled={page <= 1}>
            <Text style={[styles.pageBtnText, isLightTheme && styles.pageBtnTextLight]}>Anterior</Text>
          </Pressable>
          <Text style={[styles.pageText, isLightTheme && styles.pageTextLight]}>
            {page}/{totalPages}
          </Text>
          <Pressable style={[styles.pageBtn, isLightTheme && styles.pageBtnLight, page >= totalPages && styles.disabled]} onPress={onNext} disabled={page >= totalPages}>
            <Text style={[styles.pageBtnText, isLightTheme && styles.pageBtnTextLight]}>Siguiente</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  containerLight: { backgroundColor: COMPONENT_THEME_COLORS.paginatedList.light.containerBackground },
  surface: {
    flex: 1,
    borderWidth: 1,
    borderColor: COMPONENT_THEME_COLORS.paginatedList.dark.surfaceBorder,
    backgroundColor: COMPONENT_THEME_COLORS.paginatedList.dark.surfaceBackground,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 8,
  },
  surfaceLight: {
    borderColor: COMPONENT_THEME_COLORS.paginatedList.light.surfaceBorder,
    backgroundColor: COMPONENT_THEME_COLORS.paginatedList.light.surfaceBackground,
  },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 8 },
  title: { color: COMPONENT_THEME_COLORS.paginatedList.dark.title, fontSize: 20, fontWeight: '800' },
  titleLight: { color: COMPONENT_THEME_COLORS.paginatedList.light.title },
  list: { flex: 1 },
  listContent: { paddingBottom: 6 },
  error: { color: COMPONENT_THEME_COLORS.paginatedList.dark.error, marginBottom: 8 },
  empty: { color: COMPONENT_THEME_COLORS.paginatedList.dark.empty, marginTop: 14, textAlign: 'center', paddingVertical: 12 },
  emptyLight: { color: COMPONENT_THEME_COLORS.paginatedList.light.empty },
  meta: { color: COMPONENT_THEME_COLORS.paginatedList.dark.meta, fontSize: 12, marginTop: 6 },
  metaLight: { color: COMPONENT_THEME_COLORS.paginatedList.light.meta },
  pagination: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10 },
  pageBtn: {
    minWidth: 98,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COMPONENT_THEME_COLORS.paginatedList.dark.pageBtnBorder,
    backgroundColor: COMPONENT_THEME_COLORS.paginatedList.dark.pageBtnBackground,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pageBtnLight: {
    borderColor: COMPONENT_THEME_COLORS.paginatedList.light.pageBtnBorder,
    backgroundColor: COMPONENT_THEME_COLORS.paginatedList.light.pageBtnBackground,
  },
  disabled: { opacity: 0.35 },
  pageBtnText: { color: COMPONENT_THEME_COLORS.paginatedList.dark.pageBtnText, fontWeight: '700', fontSize: 12 },
  pageBtnTextLight: { color: COMPONENT_THEME_COLORS.paginatedList.light.pageBtnText },
  pageText: { color: COMPONENT_THEME_COLORS.paginatedList.dark.pageText, fontWeight: '700' },
  pageTextLight: { color: COMPONENT_THEME_COLORS.paginatedList.light.pageText },
});
