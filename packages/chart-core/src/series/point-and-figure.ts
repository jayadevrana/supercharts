import type { Candle } from '@supercharts/types';

export interface PointAndFigureOptions {
  /** Price box size — every box this many units. */
  boxSize: number;
  /** Reversal in number of boxes needed before flipping direction. Default 3. */
  reversalBoxes: number;
}

/**
 * Point & Figure transformation.
 *
 * P&F charts plot columns of X's (rising prices) or O's (falling prices). A new column
 * appears when the price reverses by `reversalBoxes × boxSize`. The number of boxes in
 * each column reflects the magnitude of the move.
 *
 * To stay compatible with the candlestick renderer, each P&F column is encoded as a
 * synthetic Candle whose `open`/`close` mark the column's start and end prices. The
 * candle direction (close vs. open) tells the renderer whether to paint bull (X) or
 * bear (O).
 */
export function toPointAndFigure(
  input: ReadonlyArray<Candle>,
  opts: PointAndFigureOptions,
): Candle[] {
  if (input.length === 0 || opts.boxSize <= 0) return [];
  const box = opts.boxSize;
  const rev = Math.max(1, opts.reversalBoxes) * box;

  const out: Candle[] = [];
  const step = (input[1]?.openTime ?? input[0]!.closeTime) - input[0]!.openTime || 60_000;
  let synthTime = input[0]!.openTime;
  let direction: 1 | -1 = 1;
  let columnTop = input[0]!.high;
  let columnBottom = input[0]!.low;

  for (const k of input) {
    if (direction === 1) {
      if (k.high >= columnTop + box) {
        // Extend up column to nearest box.
        columnTop = Math.floor(k.high / box) * box;
      } else if (columnTop - k.low >= rev) {
        // Reverse to down column.
        out.push(buildColumn(k, synthTime, step, columnBottom, columnTop, 1));
        synthTime += step;
        direction = -1;
        columnTop = columnTop - box; // start one box below the high
        columnBottom = Math.ceil(k.low / box) * box;
      }
    } else {
      if (k.low <= columnBottom - box) {
        columnBottom = Math.ceil(k.low / box) * box;
      } else if (k.high - columnBottom >= rev) {
        out.push(buildColumn(k, synthTime, step, columnBottom, columnTop, -1));
        synthTime += step;
        direction = 1;
        columnBottom = columnBottom + box;
        columnTop = Math.floor(k.high / box) * box;
      }
    }
  }
  // Flush trailing column.
  const last = input[input.length - 1]!;
  out.push(buildColumn(last, synthTime, step, columnBottom, columnTop, direction));
  return out;
}

function buildColumn(
  source: Candle,
  openTime: number,
  step: number,
  bottom: number,
  top: number,
  dir: 1 | -1,
): Candle {
  const open = dir === 1 ? bottom : top;
  const close = dir === 1 ? top : bottom;
  return {
    symbol: source.symbol,
    provider: source.provider,
    venue: source.venue,
    interval: source.interval,
    openTime,
    closeTime: openTime + step - 1,
    open,
    high: top,
    low: bottom,
    close,
    volume: 0,
    quoteVolume: 0,
    buyVolume: 0,
    sellVolume: 0,
    delta: 0,
    trades: 0,
    vwap: (top + bottom) / 2,
    isClosed: true,
    volumeKind: 'synthetic',
  };
}
