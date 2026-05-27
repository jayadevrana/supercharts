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
