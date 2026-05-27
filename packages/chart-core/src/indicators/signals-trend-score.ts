import type { Candle } from '@supercharts/types';
import { atr, ema, highest, lowest, rsi, sum, vwap as vwapSeries } from './series-math';
import { dmi } from './dmi';
import { supertrend } from './supertrend';

export interface SignalsTrendScoreInputs {
  maLength: number;
  atrPeriod: number;
  atrMultiplier: number;
  emaLength: number;
  stFactor: number;
  stAtrPeriod: number;
  adxLength: number;
  adxThreshold: number;
  rsiLength: number;
  rsiBull: number;
  rsiBear: number;
  swingLen: number;
  volLookback: number;
}

export const DEFAULT_STS_INPUTS: SignalsTrendScoreInputs = {
  maLength: 17,
  atrPeriod: 14,
  atrMultiplier: 1,
  emaLength: 21,
  stFactor: 2,
  stAtrPeriod: 10,
  adxLength: 14,
  adxThreshold: 23,
  rsiLength: 14,
  rsiBull: 55,
  rsiBear: 45,
  swingLen: 10,
  volLookback: 10,
};

/**
 * Computed series and scalar state for the Signals & Trend Score indicator.
 *
 * The layer reads everything it needs from this object; the React dashboards read the
 * `last...` scalars for compact rendering.
 */
export interface SignalsTrendScoreFrame {
  /** Per-bar series, aligned with the input candles array. */
  maHigh: Float64Array;
  maLow: Float64Array;
  maMid: Float64Array;
  upperBand: Float64Array;
  lowerBand: Float64Array;
  trail: Float64Array;
  trendDir: Int8Array; // +1 bull, -1 bear
  buySignal: Uint8Array;
  sellSignal: Uint8Array;

  ema21: Float64Array;
  rsiSeries: Float64Array;
  atrSeries: Float64Array;
  vwapSeries: Float64Array;
  stLine: Float64Array;
  stDir: Int8Array;
  adx: Float64Array;
  diPlus: Float64Array;
  diMinus: Float64Array;

  bullScore: Uint8Array;
  bearScore: Uint8Array;

  swingHigh: Float64Array;
  swingLow: Float64Array;

  /** Latest scalar readings for the dashboards. */
  last: {
    trendDir: 1 | -1;
    bullScore: number;
    bearScore: number;
    close: number;
    maMid: number;
    trail: number;
    ema21: number;
    rsi: number;
    atr: number;
    vwap: number;
    vwapUp: boolean;
    stDir: 1 | -1;
    adx: number;
    adxRising: boolean;
    dailyBuyPct: number;
    dailySellPct: number;
    lookbackBuyPct: number;
    lookbackSellPct: number;
    atrRangePct: number;
  };
}

export function computeSignalsTrendScore(
  candles: ReadonlyArray<Candle>,
  inputs: SignalsTrendScoreInputs = DEFAULT_STS_INPUTS,
): SignalsTrendScoreFrame | null {
  const n = candles.length;
  if (n < Math.max(inputs.maLength, inputs.atrPeriod, inputs.rsiLength, inputs.adxLength, 30)) {
    return null;
  }
  const high = new Array<number>(n);
  const low = new Array<number>(n);
  const close = new Array<number>(n);
  const open = new Array<number>(n);
  const volume = new Array<number>(n);
  const openTimes = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    const k = candles[i]!;
    high[i] = k.high;
    low[i] = k.low;
    close[i] = k.close;
    open[i] = k.open;
    volume[i] = k.volume;
    openTimes[i] = k.openTime;
  }

  const maHigh = ema(high, inputs.maLength);
  const maLow = ema(low, inputs.maLength);
  const maMid = ema(close, inputs.maLength);
  const atrSeries = atr(high, low, close, inputs.atrPeriod);

  const upperBand = new Float64Array(n);
  const lowerBand = new Float64Array(n);
  const trail = new Float64Array(n);
  const trendDir = new Int8Array(n);
  const buy = new Uint8Array(n);
  const sell = new Uint8Array(n);
  let dir: 1 | -1 = -1;
  for (let i = 0; i < n; i += 1) {
    const band = (atrSeries[i] || 0) * inputs.atrMultiplier;
    const mid = maMid[i] || close[i]!;
    const ub = mid + band;
    const lb = mid - band;
    upperBand[i] = ub;
    lowerBand[i] = lb;
    const prevDir = dir;
    if (dir < 0 && close[i]! > ub) dir = 1;
    else if (dir > 0 && close[i]! < lb) dir = -1;
    trendDir[i] = dir;
    trail[i] = dir > 0 ? lb : ub;
    if (i > 0) {
      if (dir > 0 && prevDir < 0) buy[i] = 1;
      else if (dir < 0 && prevDir > 0) sell[i] = 1;
    }
  }

  const ema21 = ema(close, inputs.emaLength);
  const rsiSeries = rsi(close, inputs.rsiLength);
  const vwapValues = vwapSeries(high, low, close, volume, openTimes);
  const st = supertrend(high, low, close, inputs.stFactor, inputs.stAtrPeriod);
  const d = dmi(high, low, close, inputs.adxLength);

  const bullScore = new Uint8Array(n);
  const bearScore = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    const m = maMid[i] || 0;
    const e = ema21[i] || 0;
    const r = rsiSeries[i] || 0;
    const ax = d.adx[i] || 0;
    const dp = d.diPlus[i] || 0;
    const dm = d.diMinus[i] || 0;
    const sd = st.dir[i] || 0;
    let bs = 0;
    let br = 0;
    if (close[i]! > m) bs += 1;
    if (close[i]! > e) bs += 1;
    if (sd < 0) bs += 1;
    if (ax > inputs.adxThreshold && dp > dm) bs += 1;
    if (r > inputs.rsiBull) bs += 1;
    if (close[i]! < m) br += 1;
    if (close[i]! < e) br += 1;
    if (sd > 0) br += 1;
    if (ax > inputs.adxThreshold && dm > dp) br += 1;
    if (r < inputs.rsiBear) br += 1;
    bullScore[i] = bs;
    bearScore[i] = br;
  }

  const swingLow = lowest(low, inputs.swingLen);
  const swingHigh = highest(high, inputs.swingLen);

  // Volume splits (daily & lookback)
  const upVol = new Array<number>(n);
  const dnVol = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    upVol[i] = close[i]! >= open[i]! ? volume[i]! : 0;
    dnVol[i] = close[i]! < open[i]! ? volume[i]! : 0;
  }
  // Daily — accumulate from start-of-day to last bar.
  const lastDay = Math.floor(openTimes[n - 1]! / 86_400_000);
  let dBuyV = 0;
  let dSellV = 0;
  for (let i = n - 1; i >= 0; i -= 1) {
    if (Math.floor(openTimes[i]! / 86_400_000) !== lastDay) break;
    dBuyV += upVol[i]!;
    dSellV += dnVol[i]!;
  }
  const dailyBuyPct = dBuyV + dSellV > 0 ? (dBuyV / (dBuyV + dSellV)) * 100 : 50;
  const dailySellPct = 100 - dailyBuyPct;

  const lbSum = inputs.volLookback;
  const lbBuyArr = sum(upVol, lbSum);
  const lbSellArr = sum(dnVol, lbSum);
  const lbBuyV = lbBuyArr[n - 1] || 0;
  const lbSellV = lbSellArr[n - 1] || 0;
  const lookbackBuyPct = lbBuyV + lbSellV > 0 ? (lbBuyV / (lbBuyV + lbSellV)) * 100 : 50;
  const lookbackSellPct = 100 - lookbackBuyPct;

  // ATR Range %
  const rngHi = highest(high, inputs.atrPeriod);
  const rngLo = lowest(low, inputs.atrPeriod);
  const rangeSpan = (rngHi[n - 1] || 0) - (rngLo[n - 1] || 0);
  const atrRangePct = rangeSpan > 0 ? ((close[n - 1]! - (rngLo[n - 1] || 0)) / rangeSpan) * 100 : 0;

  const adxRising = (d.adx[n - 1] || 0) >= (d.adx[n - 2] || 0);
  const vwapUp = close[n - 1]! >= (vwapValues[n - 1] || close[n - 1]!);

  return {
    maHigh,
    maLow,
    maMid,
    upperBand,
    lowerBand,
    trail,
    trendDir,
    buySignal: buy,
    sellSignal: sell,
    ema21,
    rsiSeries,
    atrSeries,
    vwapSeries: vwapValues,
    stLine: st.line,
    stDir: st.dir,
    adx: d.adx,
    diPlus: d.diPlus,
    diMinus: d.diMinus,
    bullScore,
    bearScore,
    swingHigh,
    swingLow,
    last: {
      trendDir: (trendDir[n - 1] === 1 ? 1 : -1) as 1 | -1,
      bullScore: bullScore[n - 1] || 0,
      bearScore: bearScore[n - 1] || 0,
      close: close[n - 1]!,
      maMid: maMid[n - 1] || 0,
      trail: trail[n - 1] || 0,
      ema21: ema21[n - 1] || 0,
      rsi: rsiSeries[n - 1] || 0,
      atr: atrSeries[n - 1] || 0,
      vwap: vwapValues[n - 1] || 0,
      vwapUp,
      stDir: (st.dir[n - 1] === 1 ? 1 : -1) as 1 | -1,
      adx: d.adx[n - 1] || 0,
      adxRising,
      dailyBuyPct,
      dailySellPct,
      lookbackBuyPct,
      lookbackSellPct,
      atrRangePct,
    },
  };
}

/**
 * Compute just the per-timeframe trend dir and bull/bear scores for an MTF dashboard cell.
 */
export function computeMtfState(
  candles: ReadonlyArray<Candle>,
  inputs: SignalsTrendScoreInputs = DEFAULT_STS_INPUTS,
): { trendDir: 1 | -1; bullScore: number; bearScore: number; rsi: number } | null {
  const frame = computeSignalsTrendScore(candles, inputs);
  if (!frame) return null;
  return {
    trendDir: frame.last.trendDir,
    bullScore: frame.last.bullScore,
    bearScore: frame.last.bearScore,
    rsi: frame.last.rsi,
  };
}
