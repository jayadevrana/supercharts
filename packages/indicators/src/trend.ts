import type { Candle } from '@supercharts/types';
import { ema, rma, sma } from './ma';
import { atr } from './volatility';

export interface ADXOptions {
  length?: number;
}

export interface ADXFrame {
  plusDI: number[];
  minusDI: number[];
  adx: number[];
}

export function adx(candles: readonly Candle[], opts: ADXOptions = {}): ADXFrame {
  const len = opts.length ?? 14;
  const plusDM = new Array<number>(candles.length).fill(0);
  const minusDM = new Array<number>(candles.length).fill(0);
  const tr = new Array<number>(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const up = candles[i]!.high - candles[i - 1]!.high;
    const down = candles[i - 1]!.low - candles[i]!.low;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
    tr[i] = Math.max(
      candles[i]!.high - candles[i]!.low,
      Math.abs(candles[i]!.high - candles[i - 1]!.close),
      Math.abs(candles[i]!.low - candles[i - 1]!.close),
    );
  }
  const trSm = rma(tr, len);
  const pSm = rma(plusDM, len);
  const mSm = rma(minusDM, len);
  const plusDI = new Array<number>(candles.length).fill(NaN);
  const minusDI = new Array<number>(candles.length).fill(NaN);
  const dx = new Array<number>(candles.length).fill(NaN);
  for (let i = 0; i < candles.length; i++) {
    if (Number.isNaN(trSm[i]!) || trSm[i]! === 0) continue;
    plusDI[i] = (pSm[i]! / trSm[i]!) * 100;
    minusDI[i] = (mSm[i]! / trSm[i]!) * 100;
    const sum = plusDI[i]! + minusDI[i]!;
    if (sum === 0) { dx[i] = 0; continue; }
    dx[i] = (Math.abs(plusDI[i]! - minusDI[i]!) / sum) * 100;
  }
  const adxArr = rma(dx, len);
  return { plusDI, minusDI, adx: adxArr };
}

export interface SupertrendOptions {
  atrLength?: number;
  multiplier?: number;
}

export interface SupertrendFrame {
  /** Supertrend line value. */
  line: number[];
  /** -1 for downtrend, +1 for uptrend, 0 unknown. */
  direction: number[];
}

export function supertrend(candles: readonly Candle[], opts: SupertrendOptions = {}): SupertrendFrame {
  const len = opts.atrLength ?? 10;
  const mult = opts.multiplier ?? 3;
  const a = atr(candles, { length: len });
  const line = new Array<number>(candles.length).fill(NaN);
  const dir = new Array<number>(candles.length).fill(0);
  let prevUpper = 0;
  let prevLower = 0;
  let prevDir = 0;
  for (let i = 0; i < candles.length; i++) {
    const hl2 = (candles[i]!.high + candles[i]!.low) / 2;
    if (Number.isNaN(a[i]!)) continue;
    const basicUpper = hl2 + mult * a[i]!;
    const basicLower = hl2 - mult * a[i]!;
    const finalUpper =
      i === 0 || candles[i - 1]!.close > prevUpper
        ? basicUpper
        : Math.min(basicUpper, prevUpper);
    const finalLower =
      i === 0 || candles[i - 1]!.close < prevLower
        ? basicLower
        : Math.max(basicLower, prevLower);
    let curDir: number;
    if (prevDir === 0) curDir = candles[i]!.close > finalUpper ? 1 : -1;
    else if (prevDir === 1) curDir = candles[i]!.close < finalLower ? -1 : 1;
    else curDir = candles[i]!.close > finalUpper ? 1 : -1;
    line[i] = curDir === 1 ? finalLower : finalUpper;
    dir[i] = curDir;
    prevUpper = finalUpper;
    prevLower = finalLower;
    prevDir = curDir;
  }
  return { line, direction: dir };
}

export interface PSAROptions {
  start?: number;
  step?: number;
  max?: number;
}

export function psar(candles: readonly Candle[], opts: PSAROptions = {}): number[] {
  const start = opts.start ?? 0.02;
  const step = opts.step ?? 0.02;
  const max = opts.max ?? 0.2;
  const out = new Array<number>(candles.length).fill(NaN);
  if (candles.length < 3) return out;
  let bull = candles[1]!.close > candles[0]!.close;
  let af = start;
  let ep = bull ? candles[0]!.high : candles[0]!.low;
  let sar = bull ? candles[0]!.low : candles[0]!.high;
  out[1] = sar;
  for (let i = 2; i < candles.length; i++) {
    sar = sar + af * (ep - sar);
    if (bull) {
      // SAR can't penetrate the previous two lows.
      sar = Math.min(sar, candles[i - 1]!.low, candles[i - 2]!.low);
      if (candles[i]!.low < sar) {
        bull = false;
        sar = ep;
        ep = candles[i]!.low;
        af = start;
      } else if (candles[i]!.high > ep) {
        ep = candles[i]!.high;
        af = Math.min(af + step, max);
      }
    } else {
      sar = Math.max(sar, candles[i - 1]!.high, candles[i - 2]!.high);
      if (candles[i]!.high > sar) {
        bull = true;
        sar = ep;
        ep = candles[i]!.high;
        af = start;
      } else if (candles[i]!.low < ep) {
        ep = candles[i]!.low;
        af = Math.min(af + step, max);
      }
    }
    out[i] = sar;
  }
  return out;
}

export interface IchimokuOptions {
  conversion?: number;
  base?: number;
  spanB?: number;
  displacement?: number;
}

export interface IchimokuFrame {
  conversion: number[];
  base: number[];
  spanA: number[];
  spanB: number[];
  lagging: number[];
}

export function ichimoku(candles: readonly Candle[], opts: IchimokuOptions = {}): IchimokuFrame {
  const cLen = opts.conversion ?? 9;
  const bLen = opts.base ?? 26;
  const sbLen = opts.spanB ?? 52;
  const disp = opts.displacement ?? 26;
  const conversion = donchianMid(candles, cLen);
  const base = donchianMid(candles, bLen);
  const spanA = new Array<number>(candles.length).fill(NaN);
  const spanB = new Array<number>(candles.length).fill(NaN);
  const lagging = new Array<number>(candles.length).fill(NaN);
  const spanBSource = donchianMid(candles, sbLen);
  for (let i = 0; i < candles.length; i++) {
    const future = i + disp;
    if (future < candles.length) {
      if (!Number.isNaN(conversion[i]!) && !Number.isNaN(base[i]!)) {
        spanA[future] = (conversion[i]! + base[i]!) / 2;
      }
      if (!Number.isNaN(spanBSource[i]!)) spanB[future] = spanBSource[i]!;
    }
    const past = i - disp;
    if (past >= 0) lagging[past] = candles[i]!.close;
  }
  return { conversion, base, spanA, spanB, lagging };
}

function donchianMid(candles: readonly Candle[], length: number): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
  for (let i = length - 1; i < candles.length; i++) {
    let hi = -Infinity;
    let lo = +Infinity;
    for (let j = i - length + 1; j <= i; j++) {
      if (candles[j]!.high > hi) hi = candles[j]!.high;
      if (candles[j]!.low < lo) lo = candles[j]!.low;
    }
    out[i] = (hi + lo) / 2;
  }
  return out;
}

export interface AroonOptions {
  length?: number;
}

export interface AroonFrame {
  up: number[];
  down: number[];
  oscillator: number[];
}

export function aroon(candles: readonly Candle[], opts: AroonOptions = {}): AroonFrame {
  const len = opts.length ?? 14;
  const up = new Array<number>(candles.length).fill(NaN);
  const down = new Array<number>(candles.length).fill(NaN);
  const osc = new Array<number>(candles.length).fill(NaN);
  for (let i = len; i < candles.length; i++) {
    let hi = -Infinity;
    let hiIdx = i;
    let lo = +Infinity;
    let loIdx = i;
    for (let j = i - len; j <= i; j++) {
      if (candles[j]!.high > hi) { hi = candles[j]!.high; hiIdx = j; }
      if (candles[j]!.low < lo)  { lo = candles[j]!.low;  loIdx = j; }
    }
    up[i] = (100 * (len - (i - hiIdx))) / len;
    down[i] = (100 * (len - (i - loIdx))) / len;
    osc[i] = up[i]! - down[i]!;
  }
  return { up, down, oscillator: osc };
}

void ema;
void sma;
