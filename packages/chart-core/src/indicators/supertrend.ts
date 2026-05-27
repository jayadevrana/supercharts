import { atr } from './series-math';

export interface Supertrend {
  line: Float64Array;
  /** +1 = down trend (line above price), -1 = up trend (line below price). Matches Pine `ta.supertrend`. */
  dir: Int8Array;
}

export function supertrend(
  high: ReadonlyArray<number>,
  low: ReadonlyArray<number>,
  close: ReadonlyArray<number>,
  factor: number,
  period: number,
): Supertrend {
  const n = high.length;
  const a = atr(high, low, close, period);
  const upper = new Float64Array(n);
  const lower = new Float64Array(n);
  const line = new Float64Array(n);
  const dir = new Int8Array(n);
  for (let i = 0; i < n; i += 1) {
    const hl2 = (high[i]! + low[i]!) / 2;
    const ai = a[i]!;
    if (!Number.isFinite(ai)) {
      upper[i] = NaN;
      lower[i] = NaN;
      line[i] = NaN;
      dir[i] = 0;
      continue;
    }
    const up = hl2 + factor * ai;
    const dn = hl2 - factor * ai;
    upper[i] =
      i === 0
        ? up
        : up < upper[i - 1]! || close[i - 1]! > upper[i - 1]!
          ? up
          : upper[i - 1]!;
    lower[i] =
      i === 0
        ? dn
        : dn > lower[i - 1]! || close[i - 1]! < lower[i - 1]!
          ? dn
          : lower[i - 1]!;
    if (i === 0) {
      line[i] = upper[i]!;
      dir[i] = 1;
      continue;
    }
    const prevLine = line[i - 1]!;
    const prevUpper = upper[i - 1]!;
    const prevLower = lower[i - 1]!;
    let curLine = prevLine;
    if (prevLine === prevUpper) {
      curLine = close[i]! > upper[i]! ? lower[i]! : upper[i]!;
    } else if (prevLine === prevLower) {
      curLine = close[i]! < lower[i]! ? upper[i]! : lower[i]!;
    }
    line[i] = curLine;
    dir[i] = curLine > close[i]! ? 1 : -1;
  }
  return { line, dir };
}
