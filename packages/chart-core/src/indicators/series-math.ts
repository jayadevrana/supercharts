/**
 * Pure numerical helpers used by every indicator.
 *
 * Every function takes an immutable input array and returns a Float64Array of the same
 * length. Leading positions where the indicator has not yet warmed up are NaN.
 */

export function ema(values: ReadonlyArray<number>, period: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  if (n === 0 || period <= 0) return out;
  const k = 2 / (period + 1);
  out[0] = values[0]!;
  for (let i = 1; i < n; i += 1) {
    out[i] = (values[i]! - out[i - 1]!) * k + out[i - 1]!;
  }
  return out;
}

/** Wilder's RMA (smoothed moving average), the basis for ATR/RSI/ADX. */
export function rma(values: ReadonlyArray<number>, period: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  if (n === 0 || period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < Math.min(period, n); i += 1) {
    sum += values[i]!;
    out[i] = NaN;
  }
  if (n >= period) {
    out[period - 1] = sum / period;
    for (let i = period; i < n; i += 1) {
      out[i] = (out[i - 1]! * (period - 1) + values[i]!) / period;
    }
  }
  return out;
}

export function trueRange(
  high: ReadonlyArray<number>,
  low: ReadonlyArray<number>,
  close: ReadonlyArray<number>,
): Float64Array {
  const n = high.length;
  const out = new Float64Array(n);
  if (n === 0) return out;
  out[0] = high[0]! - low[0]!;
  for (let i = 1; i < n; i += 1) {
    const hl = high[i]! - low[i]!;
    const hc = Math.abs(high[i]! - close[i - 1]!);
    const lc = Math.abs(low[i]! - close[i - 1]!);
    out[i] = Math.max(hl, hc, lc);
  }
  return out;
}

export function atr(
  high: ReadonlyArray<number>,
  low: ReadonlyArray<number>,
  close: ReadonlyArray<number>,
  period: number,
): Float64Array {
  return rma(Array.from(trueRange(high, low, close)), period);
}

/** Cumulative VWAP that resets at each day boundary. */
export function vwap(
  high: ReadonlyArray<number>,
  low: ReadonlyArray<number>,
  close: ReadonlyArray<number>,
  volume: ReadonlyArray<number>,
  openTimes: ReadonlyArray<number>,
): Float64Array {
  const n = close.length;
  const out = new Float64Array(n);
  let cumPV = 0;
  let cumV = 0;
  let lastDay = -1;
  for (let i = 0; i < n; i += 1) {
    const day = Math.floor(openTimes[i]! / 86_400_000);
    if (day !== lastDay) {
      cumPV = 0;
      cumV = 0;
      lastDay = day;
    }
    const typical = (high[i]! + low[i]! + close[i]!) / 3;
    cumPV += typical * volume[i]!;
    cumV += volume[i]!;
    out[i] = cumV > 0 ? cumPV / cumV : typical;
  }
  return out;
}

export function rsi(values: ReadonlyArray<number>, period: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  if (n < 2 || period <= 0) return out;
  const gains: number[] = [0];
  const losses: number[] = [0];
  for (let i = 1; i < n; i += 1) {
    const d = values[i]! - values[i - 1]!;
    gains.push(Math.max(0, d));
    losses.push(Math.max(0, -d));
  }
  const avgGain = rma(gains, period);
  const avgLoss = rma(losses, period);
  for (let i = 0; i < n; i += 1) {
    const g = avgGain[i]!;
    const l = avgLoss[i]!;
    if (!Number.isFinite(g) || !Number.isFinite(l)) {
      out[i] = NaN;
    } else if (l === 0) {
      out[i] = 100;
    } else {
      const rs = g / l;
      out[i] = 100 - 100 / (1 + rs);
    }
  }
  return out;
}

export function highest(values: ReadonlyArray<number>, period: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let m = -Infinity;
    for (let j = Math.max(0, i - period + 1); j <= i; j += 1) {
      if (values[j]! > m) m = values[j]!;
    }
    out[i] = m;
  }
  return out;
}

export function lowest(values: ReadonlyArray<number>, period: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let m = Infinity;
    for (let j = Math.max(0, i - period + 1); j <= i; j += 1) {
      if (values[j]! < m) m = values[j]!;
    }
    out[i] = m;
  }
  return out;
}

export function sum(values: ReadonlyArray<number>, period: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i += 1) {
    acc += values[i]!;
    if (i >= period) acc -= values[i - period]!;
    out[i] = i >= period - 1 ? acc : NaN;
  }
  return out;
}

/** Simple moving average. Constant-time per bar via the rolling sum above. */
export function sma(values: ReadonlyArray<number>, period: number): Float64Array {
  const s = sum(values, period);
  const out = new Float64Array(s.length);
  for (let i = 0; i < s.length; i += 1) {
    out[i] = i >= period - 1 ? s[i]! / period : NaN;
  }
  return out;
}

/**
 * Weighted moving average. Weights are 1..period (so the most-recent bar has the
 * largest weight). Useful when traders want a faster reaction than SMA without the
 * recency exponential of EMA.
 */
export function wma(values: ReadonlyArray<number>, period: number): Float64Array {
  const n = values.length;
  const out = new Float64Array(n);
  if (period <= 0 || n === 0) return out;
  const denom = (period * (period + 1)) / 2;
  for (let i = 0; i < n; i += 1) {
    if (i < period - 1) {
      out[i] = NaN;
      continue;
    }
    let acc = 0;
    for (let k = 0; k < period; k += 1) {
      // weight = (period - k), so the newest bar gets the highest weight.
      acc += values[i - k]! * (period - k);
    }
    out[i] = acc / denom;
  }
  return out;
}
