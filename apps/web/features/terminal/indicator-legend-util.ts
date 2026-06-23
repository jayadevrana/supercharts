import type { IndicatorSpec } from '@supercharts/indicators';
import type { IndicatorInstance } from '@supercharts/types';

/**
 * Pure helpers for the on-chart indicator legend / status line (Mission M2).
 * Kept separate from the React component so they can be unit-tested without a DOM.
 */

/** A compact "EMA 21 · close" style summary of an instance's tuned inputs (booleans omitted). */
export function indicatorInputSummary(spec: IndicatorSpec, inst: IndicatorInstance): string {
  const parts: string[] = [];
  for (const input of spec.inputs) {
    if (input.type === 'bool') continue;
    const v = inst.inputs[input.key] ?? input.default;
    if (v === undefined || v === null || v === '') continue;
    parts.push(String(v));
    if (parts.length >= 4) break;
  }
  return parts.join(' · ');
}

/** Best-effort "primary" colour for an instance's legend swatch across the registry's style keys. */
export function legendColor(spec: IndicatorSpec, inst: IndicatorInstance): string {
  const s = (inst.style ?? {}) as Record<string, unknown>;
  const sp = (spec.style ?? {}) as Record<string, unknown>;
  const keys = [
    'color',
    'middleColor',
    'macdColor',
    'upColor',
    'conversionColor',
    'kColor',
    'adxColor',
    'baseColor',
    'signalColor',
    'histogramPositive',
    'bandColor',
    'lineColor',
    'fisherColor',
    'kstColor',
    'tsiColor',
    'rvgiColor',
    'smiColor',
    'wt1Color',
    'viPlusColor',
    'kvoColor',
    'bullColor',
  ];
  for (const k of keys) {
    const v = s[k] ?? sp[k];
    if (typeof v === 'string' && v) return v;
  }
  return '#9aa4b2';
}

const CHANNEL_STYLE_KEYS: Record<string, string[]> = {
  value: ['color', 'lineColor'],
  middle: ['middleColor', 'color'],
  upper: ['upperColor', 'bandColor', 'color'],
  lower: ['lowerColor', 'bandColor', 'color'],
  bandwidth: ['bandwidthColor', 'bandColor', 'color'],
  percentB: ['percentBColor', 'bandColor', 'color'],
  macd: ['macdColor', 'color'],
  signal: ['signalColor', 'color'],
  histogram: ['histogramColor', 'histogramPositive', 'color'],
  adx: ['adxColor', 'color'],
  plusDI: ['plusColor', 'plusDIColor', 'color'],
  minusDI: ['minusColor', 'minusDIColor', 'color'],
  line: ['lineColor', 'upColor', 'color'],
  direction: ['directionColor', 'downColor', 'color'],
  conversion: ['conversionColor', 'color'],
  base: ['baseColor', 'color'],
  spanA: ['spanAColor', 'cloudUp', 'bandColor', 'color'],
  spanB: ['spanBColor', 'cloudDown', 'bandColor', 'color'],
  lagging: ['laggingColor', 'color'],
  up: ['upColor', 'color'],
  down: ['downColor', 'color'],
  oscillator: ['oscillatorColor', 'upColor', 'color'],
  k: ['kColor', 'color'],
  d: ['dColor', 'signalColor', 'color'],
  vwap: ['vwapColor', 'color'],
  upper1: ['upper1Color', 'bandColor', 'color'],
  lower1: ['lower1Color', 'bandColor', 'color'],
  upper2: ['upper2Color', 'bandColor', 'color'],
  lower2: ['lower2Color', 'bandColor', 'color'],
  ibHigh: ['highColor', 'color'],
  ibLow: ['lowColor', 'color'],
  ibMid: ['midColor', 'color'],
  poc: ['pocColor', 'color'],
  fisher: ['fisherColor', 'color'],
  trigger: ['triggerColor', 'signalColor', 'color'],
  kst: ['kstColor', 'color'],
  tsi: ['tsiColor', 'color'],
  rvgi: ['rvgiColor', 'color'],
  smi: ['smiColor', 'color'],
  wt1: ['wt1Color', 'color'],
  wt2: ['wt2Color', 'signalColor', 'color'],
  viPlus: ['viPlusColor', 'plusColor', 'color'],
  viMinus: ['viMinusColor', 'minusColor', 'color'],
  kvo: ['kvoColor', 'color'],
  bull: ['bullColor', 'upColor', 'color'],
  bear: ['bearColor', 'downColor', 'color'],
};

const DEFAULT_CHANNEL_LABELS: Record<string, string> = {
  value: 'Value',
  macd: 'MACD',
  signal: 'Signal',
  histogram: 'Histogram',
  k: '%K',
  d: '%D',
  adx: 'ADX',
  plusDI: '+DI',
  minusDI: '-DI',
  percentB: '%B',
  spanA: 'Span A',
  spanB: 'Span B',
  ibHigh: 'IB High',
  ibLow: 'IB Low',
  ibMid: 'IB Mid',
  upper1: 'Upper 1',
  lower1: 'Lower 1',
  upper2: 'Upper 2',
  lower2: 'Lower 2',
  viPlus: 'VI+',
  viMinus: 'VI-',
  kvo: 'KVO',
  wt1: 'WT1',
  wt2: 'WT2',
};

/** Plot/channel colour, using the same style keys as the chart renderers. */
export function channelColor(spec: IndicatorSpec, inst: IndicatorInstance, channel: string): string {
  const style = (inst.style ?? {}) as Record<string, unknown>;
  const defaults = (spec.style ?? {}) as Record<string, unknown>;
  const keys = CHANNEL_STYLE_KEYS[channel] ?? [`${channel}Color`, 'color'];
  for (const key of keys) {
    const value = style[key] ?? defaults[key];
    if (typeof value === 'string' && value) return value;
  }
  return legendColor(spec, inst);
}

/** Human-readable plot/channel label, with explicit registry overrides first. */
export function channelLabel(spec: IndicatorSpec, channel: string): string {
  const labels = spec.channelLabels;
  return labels?.[channel] ?? DEFAULT_CHANNEL_LABELS[channel] ?? titleizeChannel(channel);
}

function titleizeChannel(channel: string): string {
  return channel
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Adaptive numeric formatting for legend / data-window values. Non-finite → an em dash.
 * Pinned to en-US so display (and tests) are deterministic regardless of the runtime locale —
 * a charting terminal wants consistent `1,234.56` formatting, not the OS locale's separators.
 */
export function formatIndicatorValue(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const decimals = abs >= 100 ? 2 : abs >= 1 ? 3 : abs >= 0.01 ? 5 : 8;
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

export interface LegendRow {
  id: string;
  name: string;
  color: string;
  summary: string;
  value: string;
  visible: boolean;
}

/**
 * Build the legend rows for a pane. `channelsByInstance` maps instanceId → channel → series; `index`
 * is the candle index to read (crosshair candle, or the latest). Hidden instances and missing/NaN
 * values render an em dash. Pure — the React layer just maps these to DOM.
 */
export function buildLegendRows(
  instances: IndicatorInstance[],
  specOf: (type: string) => IndicatorSpec | undefined,
  channelsByInstance: Map<string, Record<string, number[]>>,
  index: number,
): LegendRow[] {
  const rows: LegendRow[] = [];
  for (const inst of instances) {
    const spec = specOf(inst.type);
    if (!spec) continue;
    const primary = spec.channels[0];
    const series = inst.visible ? channelsByInstance.get(inst.id)?.[primary ?? ''] : undefined;
    const raw = series && index >= 0 && index < series.length ? series[index] : undefined;
    rows.push({
      id: inst.id,
      name: inst.name || spec.label,
      color: legendColor(spec, inst),
      summary: indicatorInputSummary(spec, inst),
      value: formatIndicatorValue(raw),
      visible: inst.visible,
    });
  }
  return rows;
}
