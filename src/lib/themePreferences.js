import { Appearance } from 'react-native';

export function normalizeThemePreference(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'auto' || raw === 'system') return 'auto';
  if (raw === 'light') return 'light';
  return 'dark';
}

export function resolveThemeMode(preference) {
  const normalized = normalizeThemePreference(preference);
  if (normalized === 'auto') {
    return Appearance.getColorScheme() === 'light' ? 'light' : 'dark';
  }
  return normalized;
}
