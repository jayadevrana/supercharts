/**
 * Theme tokens consumed by all canvas layers.
 * Frontend reads CSS vars and passes a resolved ChartTheme into ChartCore on mount and on theme change.
 */

export interface ChartTheme {
  name: 'dark' | 'light' | 'high_contrast' | 'custom';
  background: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  gridLine: string;
  gridLineStrong: string;
  text: string;
  textMuted: string;
  textAxis: string;
  accent: string;
  bull: string;
  bear: string;
  bullDim: string;
  bearDim: string;
  wick: string;
  crosshair: string;
  crosshairLabelBg: string;
  crosshairLabelText: string;
  volumeBull: string;
  volumeBear: string;
  heatmap: {
    bid: [number, number, number];
    ask: [number, number, number];
    background: [number, number, number];
  };
  bubble: {
    buy: string;
    sell: string;
    unknown: string;
    stroke: string;
  };
  drawing: {
    selectionStroke: string;
    handleFill: string;
    handleStroke: string;
  };
  poc: string;
  valueArea: string;
  font: {
    family: string;
    sizeAxis: number;
    sizeTooltip: number;
    sizeLabel: number;
  };
}

export const DARK_THEME: ChartTheme = {
  name: 'dark',
  background: '#0a0c10',
  surface: '#0d1117',
  surfaceMuted: '#11161e',
  border: '#1b2230',
  gridLine: 'rgba(255,255,255,0.04)',
  gridLineStrong: 'rgba(255,255,255,0.08)',
  text: '#e6edf3',
  textMuted: '#8b95a7',
  textAxis: '#6b7383',
  accent: '#7c9cff',
  bull: '#26a69a',
  bear: '#ef5350',
  bullDim: 'rgba(38,166,154,0.45)',
  bearDim: 'rgba(239,83,80,0.45)',
  wick: '#9aa4b3',
  crosshair: 'rgba(180,200,230,0.45)',
  crosshairLabelBg: '#1f2937',
  crosshairLabelText: '#f3f6fb',
  volumeBull: 'rgba(38,166,154,0.55)',
  volumeBear: 'rgba(239,83,80,0.55)',
  heatmap: {
    bid: [76, 200, 180],
    ask: [255, 90, 100],
    background: [10, 12, 16],
  },
  bubble: {
    buy: 'rgba(38,166,154,0.85)',
    sell: 'rgba(239,83,80,0.85)',
    unknown: 'rgba(180,180,180,0.7)',
    stroke: 'rgba(255,255,255,0.25)',
  },
  drawing: {
    selectionStroke: '#7c9cff',
    handleFill: '#0d1117',
    handleStroke: '#7c9cff',
  },
  poc: '#f0b429',
  valueArea: 'rgba(124,156,255,0.16)',
  font: {
    family:
      'ui-sans-serif, system-ui, -apple-system, "SF Pro Display", "Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    sizeAxis: 11,
    sizeTooltip: 12,
    sizeLabel: 11,
  },
};

export const LIGHT_THEME: ChartTheme = {
  ...DARK_THEME,
  name: 'light',
  background: '#ffffff',
  surface: '#ffffff',
  surfaceMuted: '#f5f7fa',
  border: '#e3e7ee',
  gridLine: 'rgba(20,28,40,0.05)',
  gridLineStrong: 'rgba(20,28,40,0.09)',
  text: '#0f1623',
  textMuted: '#566273',
  textAxis: '#6b7383',
  accent: '#3b6cff',
  bull: '#0ea371',
  bear: '#d6354a',
  bullDim: 'rgba(14,163,113,0.35)',
  bearDim: 'rgba(214,53,74,0.35)',
  wick: '#6a7280',
  crosshair: 'rgba(20,40,80,0.4)',
  crosshairLabelBg: '#0f1623',
  crosshairLabelText: '#ffffff',
  volumeBull: 'rgba(14,163,113,0.55)',
  volumeBear: 'rgba(214,53,74,0.55)',
  heatmap: {
    bid: [12, 140, 110],
    ask: [200, 50, 70],
    background: [255, 255, 255],
  },
};

/* =====================================================================
   Skin palettes. Each is a complete ChartTheme the web skin registry
   (apps/web/lib/skins.ts) pairs with its CSS-var chrome block.
   ===================================================================== */

/** Flat, dense charcoal-blue — the professional reference look. */
export const GRAPHITE_THEME: ChartTheme = {
  ...DARK_THEME,
  name: 'custom',
  background: '#131722',
  surface: '#171b26',
  surfaceMuted: '#1e222d',
  border: '#2a2e39',
  gridLine: 'rgba(255,255,255,0.05)',
  gridLineStrong: 'rgba(255,255,255,0.1)',
  text: '#d1d4dc',
  textMuted: '#787b86',
  textAxis: '#787b86',
  accent: '#2962ff',
  bull: '#089981',
  bear: '#f23645',
  bullDim: 'rgba(8,153,129,0.45)',
  bearDim: 'rgba(242,54,69,0.45)',
  wick: '#8f95a1',
  crosshair: 'rgba(149,164,184,0.55)',
  crosshairLabelBg: '#2a2e39',
  crosshairLabelText: '#d1d4dc',
  volumeBull: 'rgba(8,153,129,0.5)',
  volumeBear: 'rgba(242,54,69,0.5)',
  heatmap: { bid: [8, 153, 129], ask: [242, 54, 69], background: [19, 23, 34] },
  drawing: { selectionStroke: '#2962ff', handleFill: '#131722', handleStroke: '#2962ff' },
  poc: '#f0b429',
  valueArea: 'rgba(41,98,255,0.14)',
};

/** Institutional trading-desk navy with cyan accents. */
export const MIDNIGHT_THEME: ChartTheme = {
  ...DARK_THEME,
  name: 'custom',
  background: '#0b1220',
  surface: '#0f1829',
  surfaceMuted: '#142038',
  border: '#1e2c47',
  gridLine: 'rgba(148,190,255,0.05)',
  gridLineStrong: 'rgba(148,190,255,0.1)',
  text: '#dbe4f3',
  textMuted: '#7d8db0',
  textAxis: '#6f7f9f',
  accent: '#38bdf8',
  bull: '#10b981',
  bear: '#f43f5e',
  bullDim: 'rgba(16,185,129,0.45)',
  bearDim: 'rgba(244,63,94,0.45)',
  wick: '#8fa3c4',
  crosshair: 'rgba(126,180,240,0.5)',
  crosshairLabelBg: '#1a2a4a',
  crosshairLabelText: '#e8f0fc',
  volumeBull: 'rgba(16,185,129,0.5)',
  volumeBear: 'rgba(244,63,94,0.5)',
  heatmap: { bid: [16, 185, 129], ask: [244, 63, 94], background: [11, 18, 32] },
  drawing: { selectionStroke: '#38bdf8', handleFill: '#0b1220', handleStroke: '#38bdf8' },
  poc: '#fbbf24',
  valueArea: 'rgba(56,189,248,0.12)',
};

/** Terminal black with amber — Bloomberg-desk energy. */
export const CARBON_THEME: ChartTheme = {
  ...DARK_THEME,
  name: 'custom',
  background: '#000000',
  surface: '#0a0a0a',
  surfaceMuted: '#121212',
  border: '#262626',
  gridLine: 'rgba(255,255,255,0.06)',
  gridLineStrong: 'rgba(255,255,255,0.11)',
  text: '#e5e5e5',
  textMuted: '#8a8a8a',
  textAxis: '#7a7a7a',
  accent: '#f59e0b',
  bull: '#0ecb81',
  bear: '#f6465d',
  bullDim: 'rgba(14,203,129,0.45)',
  bearDim: 'rgba(246,70,93,0.45)',
  wick: '#9a9a9a',
  crosshair: 'rgba(245,158,11,0.45)',
  crosshairLabelBg: '#1c1c1c',
  crosshairLabelText: '#f5f5f5',
  volumeBull: 'rgba(14,203,129,0.5)',
  volumeBear: 'rgba(246,70,93,0.5)',
  heatmap: { bid: [14, 203, 129], ask: [246, 70, 93], background: [0, 0, 0] },
  drawing: { selectionStroke: '#f59e0b', handleFill: '#0a0a0a', handleStroke: '#f59e0b' },
  poc: '#f59e0b',
  valueArea: 'rgba(245,158,11,0.12)',
};

/** Quant terminal — phosphor green on near-black. */
export const PHOSPHOR_THEME: ChartTheme = {
  ...DARK_THEME,
  name: 'custom',
  background: '#0a0f0a',
  surface: '#0d140d',
  surfaceMuted: '#121b12',
  border: '#1f2f22',
  gridLine: 'rgba(120,220,150,0.06)',
  gridLineStrong: 'rgba(120,220,150,0.11)',
  text: '#d6e8d6',
  textMuted: '#7d967f',
  textAxis: '#6f8a72',
  accent: '#22c55e',
  bull: '#16a34a',
  bear: '#dc2626',
  bullDim: 'rgba(22,163,74,0.45)',
  bearDim: 'rgba(220,38,38,0.45)',
  wick: '#8aa78d',
  crosshair: 'rgba(120,220,150,0.45)',
  crosshairLabelBg: '#16241a',
  crosshairLabelText: '#dff0e0',
  volumeBull: 'rgba(22,163,74,0.5)',
  volumeBear: 'rgba(220,38,38,0.5)',
  heatmap: { bid: [34, 197, 94], ask: [220, 38, 38], background: [10, 15, 10] },
  drawing: { selectionStroke: '#22c55e', handleFill: '#0a0f0a', handleStroke: '#22c55e' },
  poc: '#a3e635',
  valueArea: 'rgba(34,197,94,0.12)',
};

/** Professional light — crisp white with hairline grays. */
export const ARCTIC_THEME: ChartTheme = {
  ...LIGHT_THEME,
  name: 'custom',
  background: '#ffffff',
  surface: '#f8fafc',
  surfaceMuted: '#f1f5f9',
  border: '#e2e8f0',
  gridLine: 'rgba(15,23,42,0.05)',
  gridLineStrong: 'rgba(15,23,42,0.1)',
  text: '#0f172a',
  textMuted: '#64748b',
  textAxis: '#64748b',
  accent: '#2962ff',
  bull: '#089981',
  bear: '#f23645',
  bullDim: 'rgba(8,153,129,0.35)',
  bearDim: 'rgba(242,54,69,0.35)',
  wick: '#64748b',
  crosshair: 'rgba(41,98,255,0.4)',
  crosshairLabelBg: '#0f172a',
  crosshairLabelText: '#ffffff',
  volumeBull: 'rgba(8,153,129,0.5)',
  volumeBear: 'rgba(242,54,69,0.5)',
  heatmap: { bid: [8, 153, 129], ask: [242, 54, 69], background: [255, 255, 255] },
  drawing: { selectionStroke: '#2962ff', handleFill: '#ffffff', handleStroke: '#2962ff' },
  poc: '#d97706',
  valueArea: 'rgba(41,98,255,0.1)',
};

/** Premium warm charcoal with gold accents. */
export const AURUM_THEME: ChartTheme = {
  ...DARK_THEME,
  name: 'custom',
  background: '#12100c',
  surface: '#171410',
  surfaceMuted: '#1d1913',
  border: '#2e2818',
  gridLine: 'rgba(234,179,8,0.05)',
  gridLineStrong: 'rgba(234,179,8,0.1)',
  text: '#ece5d8',
  textMuted: '#9a8f7a',
  textAxis: '#8a8070',
  accent: '#eab308',
  bull: '#26a69a',
  bear: '#ef5350',
  bullDim: 'rgba(38,166,154,0.45)',
  bearDim: 'rgba(239,83,80,0.45)',
  wick: '#a39a88',
  crosshair: 'rgba(234,179,8,0.4)',
  crosshairLabelBg: '#2a2418',
  crosshairLabelText: '#f4eede',
  volumeBull: 'rgba(38,166,154,0.5)',
  volumeBear: 'rgba(239,83,80,0.5)',
  heatmap: { bid: [38, 166, 154], ask: [239, 83, 80], background: [18, 16, 12] },
  drawing: { selectionStroke: '#eab308', handleFill: '#12100c', handleStroke: '#eab308' },
  poc: '#eab308',
  valueArea: 'rgba(234,179,8,0.1)',
};
