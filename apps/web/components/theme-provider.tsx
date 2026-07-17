'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getSkin, isSkinId } from '@/lib/skins';
import { CLASSIC_DESIGN_ID, DEFAULT_DESIGN_ID, getDesign, isDesignId } from '@/lib/designs';

/** A skin id from the registry ('dark' | 'light' | 'graphite' | …). */
type Theme = string;

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
  /** Active design pack id ('classic' = original look, no data-design attr). */
  design: string;
  /** Applies the design AND its paired skin (one complete look). */
  setDesign: (id: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyDesignAttr(id: string) {
  if (id === CLASSIC_DESIGN_ID) document.documentElement.removeAttribute('data-design');
  else document.documentElement.setAttribute('data-design', id);
}

const defaultSkin = getDesign(DEFAULT_DESIGN_ID).skinId;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(defaultSkin);
  const [design, setDesignState] = useState<string>(DEFAULT_DESIGN_ID);

  useEffect(() => {
    // A stored design means the user has made a choice in the design-pack era —
    // honor it plus their skin. A stored theme WITHOUT a design predates the
    // system (old dark/light toggle); migrate those browsers to the flagship
    // default instead of pinning them to the legacy look.
    const storedDesign = typeof window !== 'undefined' ? localStorage.getItem('sc.design') : null;
    const storedTheme = typeof window !== 'undefined' ? localStorage.getItem('sc.theme') : null;
    const chosen = isDesignId(storedDesign);
    const initialDesign = chosen ? (storedDesign as string) : DEFAULT_DESIGN_ID;
    const initialTheme =
      chosen && isSkinId(storedTheme) ? (storedTheme as Theme) : getDesign(initialDesign).skinId;
    setDesignState(initialDesign);
    applyDesignAttr(initialDesign);
    setThemeState(initialTheme);
    document.documentElement.setAttribute('data-theme', initialTheme);
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

  const setDesign = useCallback(
    (id: string) => {
      if (!isDesignId(id)) return;
      setDesignState(id);
      applyDesignAttr(id);
      try {
        localStorage.setItem('sc.design', id);
      } catch {
        /* private mode */
      }
      // A design ships as one complete look — apply its paired skin too.
      setTheme(getDesign(id).skinId);
    },
    [setTheme],
  );

  // Sun/moon toggle jumps to the opposite family's base theme; skin picking
  // happens in the terminal Settings popover.
  const toggle = useCallback(() => {
    setTheme(getSkin(theme).family === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  const value = useMemo(
    () => ({ theme, setTheme, toggle, design, setDesign }),
    [theme, setTheme, toggle, design, setDesign],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
