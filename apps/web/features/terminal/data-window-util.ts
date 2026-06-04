import type { Candle, IndicatorInstance } from '@supercharts/types';
import type { IndicatorSpec } from '@supercharts/indicators';
import { legendColor, formatIndicatorValue } from './indicator-legend-util';

/**
 * Data Window snapshot builder (Mission M3). Pure — produces the small, already-formatted values
 * the right-rail Data panel renders for the crosshair candle (or the latest bar). Heavy series stay
 * in chart-pane's ref; only this compact snapshot is published to the store.
 */

export interface DataWindowChannel {
  label: string;
  value: string;
}
export interface DataWindowIndicator {
  id: string;
  name: string;
  color: string;
  channels: DataWindowChannel[];
}
export interface DataWindowOhlcv {
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  change: string;
  changePct: string;
  up: boolean;
}
export interface DataWindowSnapshot {
  paneId: string;
  /** Candle openTime shown, or null when there's no data. */
  time: number | null;
  /** True when reflecting the crosshair candle (vs the latest bar). */
  atCrosshair: boolean;
  ohlcv: DataWindowOhlcv | null;
  indicators: DataWindowIndicator[];
}

/** Compact volume formatting (1.2M, 530K, 4.1B). */
export function formatVolume(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function buildDataWindow(
  paneId: string,
  candles: Candle[],
  index: number,
  atCrosshair: boolean,
  instances: IndicatorInstance[],
  specOf: (type: string) => IndicatorSpec | undefined,
  channelsByInstance: Map<string, Record<string, number[]>>,
): DataWindowSnapshot {
  const c = index >= 0 && index < candles.length ? candles[index] : undefined;
  const prev = index - 1 >= 0 && index - 1 < candles.length ? candles[index - 1] : undefined;

  let ohlcv: DataWindowOhlcv | null = null;
  if (c) {
    const base = prev ? prev.close : c.open;
    const change = c.close - base;
    const changePct = base ? (change / base) * 100 : 0;
    const sign = change >= 0 ? '+' : '-';
    ohlcv = {
      open: formatIndicatorValue(c.open),
      high: formatIndicatorValue(c.high),
      low: formatIndicatorValue(c.low),
      close: formatIndicatorValue(c.close),
      volume: formatVolume(c.volume),
      change: `${sign}${formatIndicatorValue(Math.abs(change))}`,
      changePct: `${sign}${Math.abs(changePct).toFixed(2)}%`,
      up: change >= 0,
    };
  }

  const indicators: DataWindowIndicator[] = [];
  for (const inst of instances) {
    const spec = specOf(inst.type);
    if (!spec) continue;
    const series = inst.visible ? channelsByInstance.get(inst.id) : undefined;
    indicators.push({
      id: inst.id,
      name: spec.label,
      color: legendColor(spec, inst),
      channels: spec.channels.map((name) => ({
        label: name,
        value: formatIndicatorValue(series?.[name]?.[index]),
      })),
    });
  }

  return { paneId, time: c ? c.openTime : null, atCrosshair, ohlcv, indicators };
}
