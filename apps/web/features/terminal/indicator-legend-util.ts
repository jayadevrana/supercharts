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
    'bandColor',
    'lineColor',
  ];
  for (const k of keys) {
    const v = s[k] ?? sp[k];
    if (typeof v === 'string' && v) return v;
  }
  return '#9aa4b2';
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
