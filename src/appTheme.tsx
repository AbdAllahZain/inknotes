import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { useSettings } from './settings';

export type Palette = {
  bg: string;
  surface: string;
  surfaceAlt: string;
  primary: string;
  primaryText: string;
  text: string;
  textDim: string;
  border: string;
  danger: string;
  canvasBg: string;
  chip: string;
  overlay: string;
  isDark: boolean;
};

export const lightPalette: Palette = {
  bg: '#F3F4F8',
  surface: '#FFFFFF',
  surfaceAlt: '#ECEEF5',
  primary: '#4F46E5',
  primaryText: '#FFFFFF',
  text: '#1B1D2A',
  textDim: '#6B7088',
  border: '#DADCE8',
  danger: '#D93025',
  canvasBg: '#D5D8E2',
  chip: '#EEF0FF',
  overlay: 'rgba(0,0,0,0.4)',
  isDark: false,
};

export const darkPalette: Palette = {
  bg: '#0F1016',
  surface: '#1A1C26',
  surfaceAlt: '#262938',
  primary: '#6E70F0',
  primaryText: '#FFFFFF',
  text: '#ECEEF8',
  textDim: '#9AA0B8',
  border: '#313549',
  danger: '#F87171',
  canvasBg: '#0B0C11',
  chip: '#2A2D45',
  overlay: 'rgba(0,0,0,0.6)',
  isDark: true,
};

export const ThemeContext = createContext<Palette>(lightPalette);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const system = useColorScheme();
  const palette = useMemo(() => {
    const dark = settings.themeMode === 'dark' || (settings.themeMode === 'system' && system === 'dark');
    return dark ? darkPalette : lightPalette;
  }, [settings.themeMode, system]);
  return <ThemeContext.Provider value={palette}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Palette {
  return useContext(ThemeContext);
}

/** Memoised StyleSheet factory bound to the current palette. */
export function useStyles<T>(factory: (p: Palette) => T): T {
  const p = useTheme();
  return useMemo(() => factory(p), [p]); // eslint-disable-line react-hooks/exhaustive-deps
}
