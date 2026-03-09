import { useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

function normalizeKeys(values = []) {
  return Array.from(new Set((values || []).map((value) => String(value))));
}

export default function MultiSelectField({
  title,
  options = [],
  selectedKeys = [],
  onChange,
  placeholder = 'Seleccionar',
  searchPlaceholder = 'Buscar...',
  clearLabel = 'Limpiar seleccion',
  themeMode = 'dark',
  disabled = false,
  maxPreview = 2,
}) {
  const isLightTheme = themeMode === 'light';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const normalizedSelectedKeys = useMemo(() => normalizeKeys(selectedKeys), [selectedKeys]);

  const normalizedQuery = String(query || '').trim().toLowerCase();
  const filteredOptions = useMemo(() => {
    if (!normalizedQuery) return options;
    return options.filter((item) =>
      String(item.searchText || item.label || '').toLowerCase().includes(normalizedQuery),
    );
  }, [options, normalizedQuery]);

  const selectedLabels = useMemo(() => {
    const keySet = new Set(normalizedSelectedKeys);
    return options
      .filter((item) => keySet.has(String(item.key)))
      .map((item) => item.label);
  }, [options, normalizedSelectedKeys]);

  const previewLabel = useMemo(() => {
    if (!selectedLabels.length) return placeholder;
    if (selectedLabels.length <= maxPreview) return selectedLabels.join(', ');
    return `${selectedLabels.slice(0, maxPreview).join(', ')} +${selectedLabels.length - maxPreview}`;
  }, [maxPreview, placeholder, selectedLabels]);

  const toggleKey = (key) => {
    const nextKey = String(key);
    const selectedSet = new Set(normalizedSelectedKeys);
    if (selectedSet.has(nextKey)) {
      selectedSet.delete(nextKey);
    } else {
      selectedSet.add(nextKey);
    }
    onChange?.(Array.from(selectedSet));
  };

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  return (
    <View>
      {title ? <Text style={[styles.label, isLightTheme && styles.labelLight]}>{title}</Text> : null}

      <Pressable
        style={[styles.trigger, isLightTheme && styles.triggerLight, disabled && styles.triggerDisabled]}
        onPress={() => !disabled && setOpen(true)}
      >
        <Text style={[styles.triggerText, isLightTheme && styles.triggerTextLight]} numberOfLines={1}>
          {previewLabel}
        </Text>
        <Text style={[styles.chevron, isLightTheme && styles.chevronLight]}>▼</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <KeyboardAvoidingView
          style={styles.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 20 : 0}
        >
          <View style={[styles.sheet, isLightTheme && styles.sheetLight]}>
            <Text style={[styles.title, isLightTheme && styles.titleLight]}>{title || 'Seleccionar'}</Text>

            <TextInput
              style={[styles.searchInput, isLightTheme && styles.searchInputLight]}
              value={query}
              onChangeText={setQuery}
              placeholder={searchPlaceholder}
              placeholderTextColor="#64748b"
              autoCapitalize="none"
            />

            <FlatList
              data={filteredOptions}
              keyExtractor={(item) => String(item.key)}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => {
                const active = normalizedSelectedKeys.includes(String(item.key));
                return (
                  <Pressable
                    style={[styles.option, isLightTheme && styles.optionLight, active && styles.optionActive]}
                    onPress={() => toggleKey(item.key)}
                  >
                    <Text style={[styles.optionText, isLightTheme && styles.optionTextLight, active && styles.optionTextActive]}>
                      {active ? '✓ ' : ''}
                      {item.label}
                    </Text>
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <Text style={[styles.emptyText, isLightTheme && styles.emptyTextLight]}>Sin resultados</Text>
              }
            />

            <View style={styles.actionsRow}>
              <Pressable style={[styles.clearBtn, isLightTheme && styles.clearBtnLight]} onPress={() => onChange?.([])}>
                <Text style={[styles.clearBtnText, isLightTheme && styles.clearBtnTextLight]}>{clearLabel}</Text>
              </Pressable>
              <Pressable style={styles.closeBtn} onPress={close}>
                <Text style={styles.closeBtnText}>Cerrar</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    color: '#93c5fd',
    marginTop: 12,
    marginBottom: 6,
    fontWeight: '700',
    fontSize: 13,
    textTransform: 'uppercase',
  },
  labelLight: { color: '#1d4ed8' },
  trigger: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    backgroundColor: '#111827',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  triggerLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  triggerDisabled: { opacity: 0.5 },
  triggerText: { color: '#e2e8f0', fontWeight: '600', flex: 1, marginRight: 8 },
  triggerTextLight: { color: '#334155' },
  chevron: { color: '#93c5fd', fontSize: 12 },
  chevronLight: { color: '#1d4ed8' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    height: '78%',
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    padding: 14,
    gap: 10,
  },
  sheetLight: { backgroundColor: '#f8fafc' },
  title: { color: '#f8fafc', fontSize: 17, fontWeight: '700' },
  titleLight: { color: '#0f172a' },
  searchInput: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    color: '#f8fafc',
    paddingHorizontal: 10,
  },
  searchInputLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff', color: '#0f172a' },
  list: { flex: 1 },
  listContent: { paddingBottom: 8 },
  option: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: '#111827',
    marginBottom: 8,
  },
  optionLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  optionActive: { borderColor: '#0ea5e9', backgroundColor: '#0b2942' },
  optionText: { color: '#cbd5e1', fontWeight: '600' },
  optionTextLight: { color: '#334155' },
  optionTextActive: { color: '#bae6fd' },
  emptyText: { color: '#93a4b8', textAlign: 'center', paddingVertical: 12 },
  emptyTextLight: { color: '#64748b' },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  clearBtn: {
    flex: 1,
    backgroundColor: '#1e293b',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  clearBtnLight: { backgroundColor: '#e2e8f0' },
  clearBtnText: { color: '#e2e8f0', fontWeight: '700' },
  clearBtnTextLight: { color: '#334155' },
  closeBtn: {
    flex: 1,
    backgroundColor: '#1d4ed8',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  closeBtnText: { color: '#fff', fontWeight: '700' },
});
