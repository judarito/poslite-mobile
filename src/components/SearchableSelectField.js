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
import { COMPONENT_THEME_COLORS } from '../theme/colors';

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
  allowClear = true,
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
              placeholderTextColor={COMPONENT_THEME_COLORS.shared.placeholderText}
              autoCapitalize="none"
            />

            <FlatList
              data={allowClear ? [{ key: '__clear__', label: clearLabel }, ...filteredOptions] : filteredOptions}
              keyExtractor={(item) => String(item.key)}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => {
                const active =
                  allowClear && item.key === '__clear__'
                    ? selectedKey === null || selectedKey === undefined || selectedKey === ''
                    : String(selectedKey) === String(item.key);
                return (
                  <Pressable
                    style={[styles.option, isLightTheme && styles.optionLight, active && styles.optionActive]}
                    onPress={() => selectValue(allowClear && item.key === '__clear__' ? null : item.key)}
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
    color: COMPONENT_THEME_COLORS.selectableField.dark.label,
    marginTop: 12,
    marginBottom: 6,
    fontWeight: '700',
    fontSize: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  labelLight: { color: COMPONENT_THEME_COLORS.selectableField.light.label },
  trigger: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: COMPONENT_THEME_COLORS.selectableField.dark.triggerBorder,
    borderRadius: 10,
    backgroundColor: COMPONENT_THEME_COLORS.selectableField.dark.triggerBackground,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  triggerLight: {
    borderColor: COMPONENT_THEME_COLORS.selectableField.light.triggerBorder,
    backgroundColor: COMPONENT_THEME_COLORS.selectableField.light.triggerBackground,
  },
  triggerDisabled: { opacity: 0.5 },
  triggerText: { color: COMPONENT_THEME_COLORS.selectableField.dark.triggerText, fontWeight: '600', flex: 1, marginRight: 8 },
  triggerTextLight: { color: COMPONENT_THEME_COLORS.selectableField.light.triggerText },
  chevron: { color: COMPONENT_THEME_COLORS.selectableField.dark.chevron, fontSize: 11 },
  chevronLight: { color: COMPONENT_THEME_COLORS.selectableField.light.chevron },
  overlay: { flex: 1, backgroundColor: COMPONENT_THEME_COLORS.shared.modalOverlay, justifyContent: 'flex-end' },
  sheet: {
    height: '78%',
    backgroundColor: COMPONENT_THEME_COLORS.selectableField.dark.sheetBackground,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 1,
    borderColor: COMPONENT_THEME_COLORS.selectableField.dark.sheetBorder,
    padding: 14,
    gap: 10,
  },
  sheetLight: {
    backgroundColor: COMPONENT_THEME_COLORS.selectableField.light.sheetBackground,
    borderColor: COMPONENT_THEME_COLORS.selectableField.light.sheetBorder,
  },
  title: { color: COMPONENT_THEME_COLORS.selectableField.dark.title, fontSize: 17, fontWeight: '800' },
  titleLight: { color: COMPONENT_THEME_COLORS.selectableField.light.title },
  searchInput: {
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COMPONENT_THEME_COLORS.selectableField.dark.inputBorder,
    backgroundColor: COMPONENT_THEME_COLORS.selectableField.dark.inputBackground,
    color: COMPONENT_THEME_COLORS.selectableField.dark.inputText,
    paddingHorizontal: 12,
  },
  searchInputLight: {
    borderColor: COMPONENT_THEME_COLORS.selectableField.light.inputBorder,
    backgroundColor: COMPONENT_THEME_COLORS.selectableField.light.inputBackground,
    color: COMPONENT_THEME_COLORS.selectableField.light.inputText,
  },
  list: { flex: 1 },
  listContent: { paddingBottom: 8 },
  option: {
    borderWidth: 1,
    borderColor: COMPONENT_THEME_COLORS.selectableField.dark.optionBorder,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    backgroundColor: COMPONENT_THEME_COLORS.selectableField.dark.optionBackground,
    marginBottom: 8,
  },
  optionLight: {
    borderColor: COMPONENT_THEME_COLORS.selectableField.light.optionBorder,
    backgroundColor: COMPONENT_THEME_COLORS.selectableField.light.optionBackground,
  },
  optionActive: {
    borderColor: COMPONENT_THEME_COLORS.selectableField.active.singleBorder,
    backgroundColor: COMPONENT_THEME_COLORS.selectableField.active.singleBackground,
  },
  optionText: { color: COMPONENT_THEME_COLORS.selectableField.dark.optionText, fontWeight: '600' },
  optionTextLight: { color: COMPONENT_THEME_COLORS.selectableField.light.optionText },
  optionTextActive: { color: COMPONENT_THEME_COLORS.selectableField.active.singleText },
  emptyText: { color: COMPONENT_THEME_COLORS.selectableField.dark.emptyText, textAlign: 'center', paddingVertical: 12 },
  emptyTextLight: { color: COMPONENT_THEME_COLORS.selectableField.light.emptyText },
  closeBtn: {
    alignSelf: 'flex-end',
    backgroundColor: COMPONENT_THEME_COLORS.selectableField.dark.closeBtnBackground,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COMPONENT_THEME_COLORS.selectableField.dark.closeBtnBorder,
    marginTop: 4,
  },
  closeBtnText: { color: COMPONENT_THEME_COLORS.selectableField.dark.closeBtnText, fontWeight: '700' },
});
