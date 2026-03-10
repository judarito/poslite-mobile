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
              placeholderTextColor={COMPONENT_THEME_COLORS.shared.placeholderText}
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
    borderColor: COMPONENT_THEME_COLORS.selectableField.active.multiBorder,
    backgroundColor: COMPONENT_THEME_COLORS.selectableField.active.multiBackground,
  },
  optionText: { color: COMPONENT_THEME_COLORS.selectableField.dark.optionText, fontWeight: '600' },
  optionTextLight: { color: COMPONENT_THEME_COLORS.selectableField.light.optionText },
  optionTextActive: { color: COMPONENT_THEME_COLORS.selectableField.active.multiText },
  emptyText: { color: COMPONENT_THEME_COLORS.selectableField.dark.emptyText, textAlign: 'center', paddingVertical: 12 },
  emptyTextLight: { color: COMPONENT_THEME_COLORS.selectableField.light.emptyText },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  clearBtn: {
    flex: 1,
    backgroundColor: COMPONENT_THEME_COLORS.selectableField.clear.dark.background,
    borderWidth: 1,
    borderColor: COMPONENT_THEME_COLORS.selectableField.clear.dark.border,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
  },
  clearBtnLight: {
    backgroundColor: COMPONENT_THEME_COLORS.selectableField.clear.light.background,
    borderColor: COMPONENT_THEME_COLORS.selectableField.clear.light.border,
  },
  clearBtnText: { color: COMPONENT_THEME_COLORS.selectableField.clear.dark.text, fontWeight: '700' },
  clearBtnTextLight: { color: COMPONENT_THEME_COLORS.selectableField.clear.light.text },
  closeBtn: {
    flex: 1,
    backgroundColor: COMPONENT_THEME_COLORS.selectableField.dark.closeBtnBackground,
    borderWidth: 1,
    borderColor: COMPONENT_THEME_COLORS.selectableField.dark.closeBtnBorder,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: 'center',
  },
  closeBtnText: { color: COMPONENT_THEME_COLORS.selectableField.dark.closeBtnText, fontWeight: '700' },
});
