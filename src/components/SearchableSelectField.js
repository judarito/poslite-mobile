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

export default function SearchableSelectField({
  title,
  valueLabel,
  options = [],
  selectedKey = null,
  onSelect,
  placeholder = 'Seleccionar',
  searchPlaceholder = 'Buscar...',
  clearLabel = 'Sin seleccion',
  themeMode = 'dark',
  disabled = false,
}) {
  const isLightTheme = themeMode === 'light';
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const normalizedQuery = String(query || '').trim().toLowerCase();
  const filteredOptions = useMemo(() => {
    if (!normalizedQuery) return options;
    return options.filter((item) => String(item.searchText || item.label || '').toLowerCase().includes(normalizedQuery));
  }, [options, normalizedQuery]);

  const selectedOption = useMemo(
    () => options.find((item) => String(item.key) === String(selectedKey)) || null,
    [options, selectedKey],
  );

  const selectedLabel = selectedOption?.label || valueLabel || placeholder;

  const selectValue = (key) => {
    onSelect?.(key);
    setOpen(false);
    setQuery('');
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
          {selectedLabel}
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
            <Text style={[styles.title, isLightTheme && styles.titleLight]}>
              {title || 'Seleccionar'}
            </Text>

            <TextInput
              style={[styles.searchInput, isLightTheme && styles.searchInputLight]}
              value={query}
              onChangeText={setQuery}
              placeholder={searchPlaceholder}
              placeholderTextColor="#64748b"
              autoCapitalize="none"
            />

            <FlatList
              data={[{ key: '__clear__', label: clearLabel }, ...filteredOptions]}
              keyExtractor={(item) => String(item.key)}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => {
                const active =
                  item.key === '__clear__'
                    ? selectedKey === null || selectedKey === undefined || selectedKey === ''
                    : String(selectedKey) === String(item.key);
                return (
                  <Pressable
                    style={[styles.option, isLightTheme && styles.optionLight, active && styles.optionActive]}
                    onPress={() => selectValue(item.key === '__clear__' ? null : item.key)}
                  >
                    <Text style={[styles.optionText, isLightTheme && styles.optionTextLight, active && styles.optionTextActive]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <Text style={[styles.emptyText, isLightTheme && styles.emptyTextLight]}>Sin resultados</Text>
              }
            />

            <Pressable onPress={close} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>Cerrar</Text>
            </Pressable>
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
  closeBtn: {
    alignSelf: 'flex-end',
    backgroundColor: '#1d4ed8',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 4,
  },
  closeBtnText: { color: '#fff', fontWeight: '700' },
});
