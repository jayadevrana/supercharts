import type { Candle } from '@supercharts/types';

export interface RenkoOptions {
  /** Brick size in price units. */
  brickSize: number;
  /** When `useATR` is true, brickSize is recomputed as ATR(period) of the input. */
  useATR?: boolean;
  atrPeriod?: number;
  /** Treat wicks as taking part in brick formation (closer to ATR-based renko). */
  useWicks?: boolean;
}

/**
 * Convert candles to Renko bricks. Each brick is returned as a Candle so the renderer
 * can draw it with existing candle code.
 *
 * Bricks have synthetic timestamps spaced by the source candle's bar duration to keep
 * the time axis usable. Each brick reports its tag in `volumeKind: 'synthetic'`.
 */
export function toRenko(input: ReadonlyArray<Candle>, opts: RenkoOptions): Candle[] {
  if (input.length === 0) return [];
  let brick = opts.brickSize;
  if (opts.useATR) {
    const period = opts.atrPeriod ?? 14;
    const atr = computeATR(input, period);
    if (atr > 0) brick = atr;
  }
  if (!Number.isFinite(brick) || brick <= 0) return [];

  const out: Candle[] = [];
  let lastBrickClose = input[0]!.close;
  let direction: 1 | -1 = 1;
  let synthTime = input[0]!.openTime;
  const stepMs = (input[1]?.openTime ?? input[0]!.closeTime) - input[0]!.openTime || 60_000;

  for (const k of input) {
    const samples: number[] = opts.useWicks ? [k.low, k.high, k.close] : [k.close];
    for (const price of samples) {
      while (true) {
        const upTarget = lastBrickClose + brick;
        const downTarget = lastBrickClose - brick;
        if (price >= upTarget) {
          const open = direction === 1 ? lastBrickClose : lastBrickClose + brick;
          const close = open + brick;
          out.push(buildBrick(k, synthTime, stepMs, open, close, brick));
          lastBrickClose = close;
          direction = 1;
          synthTime += stepMs;
          continue;
        }
        if (price <= downTarget) {
          const open = direction === -1 ? lastBrickClose : lastBrickClose - brick;
          const close = open - brick;
          out.push(buildBrick(k, synthTime, stepMs, open, close, brick));
          lastBrickClose = close;
          direction = -1;
          synthTime += stepMs;
          continue;
        }
        break;
      }
    }
  }
  return out;
}

function buildBrick(
  source: Candle,
  openTime: number,
  stepMs: number,
  open: number,
  close: number,
  brickSize: number,
): Candle {
  const high = Math.max(open, close);
  const low = Math.min(open, close);
  return {
    symbol: source.symbol,
    provider: source.provider,
    venue: source.venue,
    interval: source.interval,
    openTime,
    closeTime: openTime + stepMs - 1,
    open,
    high,
    low,
    close,
    volume: 0,
    quoteVolume: 0,
    buyVolume: 0,
    sellVolume: 0,
    delta: 0,
    trades: 0,
    vwap: (open + close) / 2,
    isClosed: true,
    volumeKind: 'synthetic',
  };
}

function computeATR(candles: ReadonlyArray<Candle>, period: number): number {
  if (candles.length < 2) return 0;
  let trSum = 0;
  let prevClose = candles[0]!.close;
  let count = 0;
  for (let i = 1; i < candles.length; i += 1) {
    const k = candles[i]!;
    const tr = Math.max(k.high - k.low, Math.abs(k.high - prevClose), Math.abs(k.low - prevClose));
    trSum += tr;
    prevClose = k.close;
    count += 1;
    if (count >= period) break;
  }
  return trSum / Math.max(count, 1);
}
