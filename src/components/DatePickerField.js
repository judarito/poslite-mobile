import { useMemo, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useThemeMode } from '../lib/themeMode';
import { COMPONENT_THEME_COLORS } from '../theme/colors';

let NativeDateTimePicker = null;
try {
  NativeDateTimePicker = require('@react-native-community/datetimepicker').default;
} catch (_error) {
  NativeDateTimePicker = null;
}

const WEB_INPUT_DARK_STYLE = {
  width: '100%',
  border: 'none',
  outline: 'none',
  backgroundColor: 'transparent',
  color: COMPONENT_THEME_COLORS.datePickerField.dark.webInputText,
  fontSize: 14,
  minHeight: 30,
};

const WEB_INPUT_LIGHT_STYLE = {
  width: '100%',
  border: 'none',
  outline: 'none',
  backgroundColor: 'transparent',
  color: COMPONENT_THEME_COLORS.datePickerField.light.webInputText,
  fontSize: 14,
  minHeight: 30,
};

function toYmd(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fromYmd(value) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== Number(y) ||
    date.getMonth() !== Number(m) - 1 ||
    date.getDate() !== Number(d)
  ) {
    return null;
  }
  return date;
}

export default function DatePickerField({
  label,
  value,
  placeholder = 'Seleccionar fecha',
  onChange,
  minimumDate,
  maximumDate,
  style,
}) {
  const themeMode = useThemeMode();
  const isLightTheme = themeMode === 'light';
  const isWeb = Platform.OS === 'web';
  const [open, setOpen] = useState(false);
  const [tempDate, setTempDate] = useState(fromYmd(value) || new Date());

  const minDate = useMemo(() => (minimumDate ? fromYmd(minimumDate) : null), [minimumDate]);
  const maxDate = useMemo(() => (maximumDate ? fromYmd(maximumDate) : null), [maximumDate]);

  const openPicker = () => {
    if (isWeb) return;
    if (!NativeDateTimePicker) {
      Alert.alert(
        'DatePicker no disponible',
        'Instala @react-native-community/datetimepicker para habilitar la seleccion de fecha.',
      );
      return;
    }
    setTempDate(fromYmd(value) || new Date());
    setOpen((prev) => !prev);
  };

  return (
    <View style={[styles.container, style]}>
      {label ? <Text style={[styles.label, isLightTheme && styles.labelLight]}>{label}</Text> : null}
      {isWeb ? (
        // Web: usa input type="date" del navegador.
        <View style={[styles.field, isLightTheme && styles.fieldLight, styles.webFieldWrap]}>
          <input
            type="date"
            value={value || ''}
            min={minimumDate || undefined}
            max={maximumDate || undefined}
            onChange={(event) => onChange?.(event?.target?.value || '')}
            style={isLightTheme ? WEB_INPUT_LIGHT_STYLE : WEB_INPUT_DARK_STYLE}
          />
        </View>
      ) : !NativeDateTimePicker ? (
        <TextInput
          value={value || ''}
          onChangeText={(text) => onChange?.(text)}
          placeholder={placeholder}
          placeholderTextColor={COMPONENT_THEME_COLORS.shared.placeholderText}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.field, isLightTheme && styles.fieldLight, styles.manualInput, isLightTheme && styles.manualInputLight]}
        />
      ) : (
        <Pressable style={[styles.field, isLightTheme && styles.fieldLight]} onPress={openPicker}>
          <Text style={[styles.value, isLightTheme && styles.valueLight, !value && styles.placeholder]}>
            {value || placeholder}
          </Text>
        </Pressable>
      )}

      {open && NativeDateTimePicker ? (
        <View style={[styles.pickerWrap, isLightTheme && styles.pickerWrapLight]}>
          <NativeDateTimePicker
            value={tempDate}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            onChange={(event, selected) => {
              if (event?.type === 'dismissed') {
                setOpen(false);
                return;
              }
              if (selected) {
                setTempDate(selected);
                onChange?.(toYmd(selected));
              }
              if (Platform.OS === 'android') {
                setOpen(false);
              }
            }}
            minimumDate={minDate || undefined}
            maximumDate={maxDate || undefined}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  label: { color: COMPONENT_THEME_COLORS.datePickerField.dark.label, fontWeight: '700', fontSize: 12, marginBottom: 6, letterSpacing: 0.3 },
  labelLight: { color: COMPONENT_THEME_COLORS.datePickerField.light.label },
  field: {
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COMPONENT_THEME_COLORS.datePickerField.dark.fieldBorder,
    backgroundColor: COMPONENT_THEME_COLORS.datePickerField.dark.fieldBackground,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  fieldLight: {
    borderColor: COMPONENT_THEME_COLORS.datePickerField.light.fieldBorder,
    backgroundColor: COMPONENT_THEME_COLORS.datePickerField.light.fieldBackground,
  },
  value: { color: COMPONENT_THEME_COLORS.datePickerField.dark.valueText, fontSize: 14, fontWeight: '600' },
  valueLight: { color: COMPONENT_THEME_COLORS.datePickerField.light.valueText },
  placeholder: { color: COMPONENT_THEME_COLORS.shared.placeholderText },
  pickerWrap: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COMPONENT_THEME_COLORS.datePickerField.dark.pickerBorder,
    backgroundColor: COMPONENT_THEME_COLORS.datePickerField.dark.pickerBackground,
    overflow: 'hidden',
    paddingVertical: Platform.OS === 'ios' ? 0 : 4,
  },
  pickerWrapLight: {
    borderColor: COMPONENT_THEME_COLORS.datePickerField.light.pickerBorder,
    backgroundColor: COMPONENT_THEME_COLORS.datePickerField.light.pickerBackground,
  },
  webFieldWrap: { paddingHorizontal: 8, paddingVertical: 4 },
  manualInput: { color: COMPONENT_THEME_COLORS.datePickerField.dark.manualInputText, paddingHorizontal: 10, paddingVertical: 10 },
  manualInputLight: { color: COMPONENT_THEME_COLORS.datePickerField.light.manualInputText },
});
