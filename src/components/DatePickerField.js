import { useMemo, useState } from 'react';
import { Alert, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useThemeMode } from '../lib/themeMode';

let NativeDateTimePicker = null;
try {
  NativeDateTimePicker = require('@react-native-community/datetimepicker').default;
} catch (_error) {
  NativeDateTimePicker = null;
}

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
  const [open, setOpen] = useState(false);
  const [tempDate, setTempDate] = useState(fromYmd(value) || new Date());

  const minDate = useMemo(() => (minimumDate ? fromYmd(minimumDate) : null), [minimumDate]);
  const maxDate = useMemo(() => (maximumDate ? fromYmd(maximumDate) : null), [maximumDate]);

  const openPicker = () => {
    if (!NativeDateTimePicker) {
      Alert.alert(
        'DatePicker no disponible',
        'Instala @react-native-community/datetimepicker para habilitar la seleccion de fecha.',
      );
      return;
    }
    setTempDate(fromYmd(value) || new Date());
    setOpen(true);
  };

  const applyDate = () => {
    onChange?.(toYmd(tempDate));
    setOpen(false);
  };

  return (
    <View style={[styles.container, style]}>
      {label ? <Text style={[styles.label, isLightTheme && styles.labelLight]}>{label}</Text> : null}
      <Pressable style={[styles.field, isLightTheme && styles.fieldLight]} onPress={openPicker}>
        <Text style={[styles.value, isLightTheme && styles.valueLight, !value && styles.placeholder]}>
          {value || placeholder}
        </Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.overlay}>
          <View style={[styles.modalCard, isLightTheme && styles.modalCardLight]}>
            <Text style={[styles.modalTitle, isLightTheme && styles.modalTitleLight]}>{label || 'Seleccionar fecha'}</Text>
            {NativeDateTimePicker ? (
              <NativeDateTimePicker
                value={tempDate}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(_event, selected) => {
                  if (selected) setTempDate(selected);
                }}
                minimumDate={minDate || undefined}
                maximumDate={maxDate || undefined}
              />
            ) : null}
            <View style={styles.actions}>
              <Pressable style={[styles.btn, styles.cancelBtn]} onPress={() => setOpen(false)}>
                <Text style={styles.btnText}>Cancelar</Text>
              </Pressable>
              <Pressable style={[styles.btn, styles.applyBtn]} onPress={applyDate}>
                <Text style={styles.btnText}>Aplicar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  label: { color: '#93c5fd', fontWeight: '700', fontSize: 12, marginBottom: 6 },
  labelLight: { color: '#0369a1' },
  field: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  fieldLight: { borderColor: '#cbd5e1', backgroundColor: '#ffffff' },
  value: { color: '#f8fafc', fontSize: 14 },
  valueLight: { color: '#0f172a' },
  placeholder: { color: '#64748b' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 16 },
  modalCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#0f172a',
    padding: 12,
  },
  modalCardLight: { borderColor: '#dbe4ef', backgroundColor: '#ffffff' },
  modalTitle: { color: '#f8fafc', fontSize: 16, fontWeight: '700', marginBottom: 8 },
  modalTitleLight: { color: '#0f172a' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  btn: { borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  cancelBtn: { backgroundColor: '#334155' },
  applyBtn: { backgroundColor: '#1d4ed8' },
  btnText: { color: '#ffffff', fontWeight: '700' },
});
