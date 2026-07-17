'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_SKIN_ID, getSkin, isSkinId } from '@/lib/skins';

/** A skin id from the registry ('dark' | 'light' | 'graphite' | …). */
type Theme = string;

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_SKIN_ID);

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('sc.theme') : null;
    const initial = isSkinId(stored) ? (stored as Theme) : DEFAULT_SKIN_ID;
    setThemeState(initial);
    document.documentElement.setAttribute('data-theme', initial);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    if (!isSkinId(t)) return;
    setThemeState(t);
    document.documentElement.setAttribute('data-theme', t);
    try {
      localStorage.setItem('sc.theme', t);
    } catch {
      /* private mode */
    }
  }, []);

  // Sun/moon toggle jumps to the opposite family's base theme; skin picking
  // happens in the terminal Settings popover.
  const toggle = useCallback(() => {
    setTheme(getSkin(theme).family === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
