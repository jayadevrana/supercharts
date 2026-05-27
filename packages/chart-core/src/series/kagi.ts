import type { Candle } from '@supercharts/types';

export interface KagiOptions {
  /** Reversal amount in price units. */
  reversal: number;
}

/**
 * Kagi transformation.
 *
 * Kagi charts draw alternating up/down lines that change direction only when price
 * reverses by at least `reversal`. Yang (thick) lines start when price rises above the
 * prior shoulder; Yin (thin) lines start when price falls below the prior waist.
 *
 * For SuperCharts we encode each Kagi segment as a synthetic Candle so the existing
 * candlestick renderer can draw it: `open` = segment start price, `close` = segment end
 * price, body color reflects direction. Synthetic bars are time-spaced by the source
 * candle duration.
 */
export function toKagi(input: ReadonlyArray<Candle>, opts: KagiOptions): Candle[] {
  if (input.length === 0 || opts.reversal <= 0) return [];
  const out: Candle[] = [];
  const step = (input[1]?.openTime ?? input[0]!.closeTime) - input[0]!.openTime || 60_000;
  let synthTime = input[0]!.openTime;
  let direction: 1 | -1 = 1;
  let segmentStart = input[0]!.close;
  let segmentExtreme = input[0]!.close;

  for (let i = 1; i < input.length; i += 1) {
    const k = input[i]!;
    const p = k.close;
    if (direction === 1) {
      if (p > segmentExtreme) {
        segmentExtreme = p;
      } else if (segmentExtreme - p >= opts.reversal) {
        // Close current up segment, open down segment.
        out.push(buildSegment(k, synthTime, step, segmentStart, segmentExtreme, 1));
        synthTime += step;
        direction = -1;
        segmentStart = segmentExtreme;
        segmentExtreme = p;
      }
    } else {
      if (p < segmentExtreme) {
        segmentExtreme = p;
      } else if (p - segmentExtreme >= opts.reversal) {
        out.push(buildSegment(k, synthTime, step, segmentStart, segmentExtreme, -1));
        synthTime += step;
        direction = 1;
        segmentStart = segmentExtreme;
        segmentExtreme = p;
      }
    }
  }
  // Flush current segment.
  const last = input[input.length - 1]!;
  out.push(buildSegment(last, synthTime, step, segmentStart, segmentExtreme, direction));
  return out;
}

function buildSegment(
  source: Candle,
  openTime: number,
  step: number,
  start: number,
  end: number,
  dir: 1 | -1,
): Candle {
  const open = dir === 1 ? start : end;
  const close = dir === 1 ? end : start;
  return {
    symbol: source.symbol,
    provider: source.provider,
    venue: source.venue,
    interval: source.interval,
    openTime,
    closeTime: openTime + step - 1,
    open,
    high: Math.max(start, end),
    low: Math.min(start, end),
    close,
    volume: 0,
    quoteVolume: 0,
    buyVolume: 0,
    sellVolume: 0,
    delta: 0,
    trades: 0,
    vwap: (start + end) / 2,
    isClosed: true,
    volumeKind: 'synthetic',
  };
}
