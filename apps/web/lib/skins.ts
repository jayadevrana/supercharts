/**
 * Skin registry — the single source the theme provider, chart pane, and the
 * Settings picker consume. Each skin pairs a `data-theme` CSS-var chrome block
 * (globals.css) with a full canvas palette (chart-core theme.ts).
 * Spec: docs/superpowers/specs/2026-07-18-terminal-skins-design.md
 */

import {
  ARCTIC_THEME,
  AURUM_THEME,
  CARBON_THEME,
  DARK_THEME,
  GRAPHITE_THEME,
  LIGHT_THEME,
  MIDNIGHT_THEME,
  OBSIDIAN_THEME,
  PHOSPHOR_THEME,
  type ChartTheme,
} from '@supercharts/chart-core';

export interface Skin {
  id: string;
  label: string;
  tagline: string;
  family: 'dark' | 'light';
  chart: ChartTheme;
  /** Swatch strip for the picker: bg · accent · bull · bear. */
  preview: { bg: string; accent: string; bull: string; bear: string };
}

export const SKINS: Skin[] = [
  {
    id: 'dark',
    label: 'SuperCharts Dark',
    tagline: 'The classic glass look',
    family: 'dark',
    chart: DARK_THEME,
    preview: { bg: '#0a0c10', accent: '#7c9cff', bull: '#26a69a', bear: '#ef5350' },
  },
  {
    id: 'light',
    label: 'SuperCharts Light',
    tagline: 'Classic, on white',
    family: 'light',
    chart: LIGHT_THEME,
    preview: { bg: '#ffffff', accent: '#3b6cff', bull: '#0ea371', bear: '#d6354a' },
  },
  {
    id: 'obsidian',
    label: 'Obsidian',
    tagline: 'High-contrast flagship: near-black · electric blue',
    family: 'dark',
    chart: OBSIDIAN_THEME,
    preview: { bg: '#05060a', accent: '#3d7bff', bull: '#00c26e', bear: '#ff3b46' },
  },
  {
    id: 'graphite',
    label: 'Graphite',
    tagline: 'Flat, dense, squared — pro reference',
    family: 'dark',
    chart: GRAPHITE_THEME,
    preview: { bg: '#131722', accent: '#2962ff', bull: '#089981', bear: '#f23645' },
  },
  {
    id: 'midnight',
    label: 'Midnight',
    tagline: 'Institutional desk navy',
    family: 'dark',
    chart: MIDNIGHT_THEME,
    preview: { bg: '#0b1220', accent: '#38bdf8', bull: '#10b981', bear: '#f43f5e' },
  },
  {
    id: 'carbon',
    label: 'Carbon',
    tagline: 'Terminal black · amber',
    family: 'dark',
    chart: CARBON_THEME,
    preview: { bg: '#000000', accent: '#f59e0b', bull: '#0ecb81', bear: '#f6465d' },
  },
  {
    id: 'phosphor',
    label: 'Phosphor',
    tagline: 'Quant green-on-black',
    family: 'dark',
    chart: PHOSPHOR_THEME,
    preview: { bg: '#0a0f0a', accent: '#22c55e', bull: '#16a34a', bear: '#dc2626' },
  },
  {
    id: 'arctic',
    label: 'Arctic',
    tagline: 'Crisp professional light',
    family: 'light',
    chart: ARCTIC_THEME,
    preview: { bg: '#ffffff', accent: '#2962ff', bull: '#089981', bear: '#f23645' },
  },
  {
    id: 'aurum',
    label: 'Aurum',
    tagline: 'Warm charcoal · gold',
    family: 'dark',
    chart: AURUM_THEME,
    preview: { bg: '#12100c', accent: '#eab308', bull: '#26a69a', bear: '#ef5350' },
  },
];

export const DEFAULT_SKIN_ID = 'dark';

export function getSkin(id: string | null | undefined): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS.find((s) => s.id === DEFAULT_SKIN_ID)!;
}

export function isSkinId(id: string | null | undefined): boolean {
  return SKINS.some((s) => s.id === id);
}
