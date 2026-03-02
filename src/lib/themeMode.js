import { createContext, useContext } from 'react';

const ThemeModeContext = createContext('dark');

export function ThemeModeProvider({ mode = 'dark', children }) {
  const normalized = mode === 'light' ? 'light' : 'dark';
  return <ThemeModeContext.Provider value={normalized}>{children}</ThemeModeContext.Provider>;
}

export function useThemeMode() {
  return useContext(ThemeModeContext) || 'dark';
}
