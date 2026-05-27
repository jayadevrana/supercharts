/**
 * Shared utilities used by every SMC / order-flow indicator.
 *
 * - `Fractal` swing detection (the foundation of FVG / OB / liquidity / structure).
 * - Safe division helpers (no NaN propagation on zero-range bars).
 * - Minimal `Candle` view that doesn't tie us to the wire-format type.
 */

export interface BarLike {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openTime: number;
}

/** Bull pivot = `bar[i].high` greater than `len` neighbors on each side. */
export interface Pivot {
  index: number;
  price: number;
  side: 'high' | 'low';
}

export function detectPivots(bars: ReadonlyArray<BarLike>, len: number): Pivot[] {
  const out: Pivot[] = [];
  const n = bars.length;
  for (let i = len; i < n - len; i += 1) {
    const center = bars[i]!;
    let isHigh = true;
    let isLow = true;
    for (let k = 1; k <= len; k += 1) {
      const left = bars[i - k]!;
      const right = bars[i + k]!;
      if (left.high >= center.high || right.high >= center.high) isHigh = false;
      if (left.low <= center.low || right.low <= center.low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) out.push({ index: i, price: center.high, side: 'high' });
    if (isLow) out.push({ index: i, price: center.low, side: 'low' });
  }
  return out;
}

/** Simple ATR (Wilder smoothing). */
export function atrSeries(bars: ReadonlyArray<BarLike>, len: number): Float64Array {
  const n = bars.length;
  const out = new Float64Array(n);
  if (n === 0) return out;
  // True range
  const tr: number[] = [bars[0]!.high - bars[0]!.low];
  for (let i = 1; i < n; i += 1) {
    const b = bars[i]!;
    const prev = bars[i - 1]!;
    tr.push(Math.max(b.high - b.low, Math.abs(b.high - prev.close), Math.abs(b.low - prev.close)));
  }
  // Wilder RMA
  let sum = 0;
  for (let i = 0; i < Math.min(len, n); i += 1) {
    sum += tr[i]!;
    out[i] = NaN;
  }
  if (n >= len) {
    out[len - 1] = sum / len;
    for (let i = len; i < n; i += 1) {
      out[i] = (out[i - 1]! * (len - 1) + tr[i]!) / len;
    }
  }
  return out;
}

export function safeDiv(num: number, denom: number, fallback = 0): number {
  if (!Number.isFinite(num) || !Number.isFinite(denom) || denom === 0) return fallback;
  return num / denom;
}

/** Color helper used by canvas layers. */
export function withAlpha(color: string, alpha: number): string {
  if (color.startsWith('rgba')) return color.replace(/[\d.]+\)$/, `${alpha})`);
  if (color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return color;
}

/** A 2D box anchored in chart space. Used by FVG, OB, OTE, sessions, etc. */
export interface ZoneBox {
  id: string;
  side: 'bull' | 'bear';
  /** Bar index where the zone is created. */
  startIndex: number;
  /** Bar index where the zone is invalidated / mitigated, or null while open. */
  endIndex: number | null;
  /** UNIX ms of start / end (mirrors the index fields for renderers that use time scale). */
  startTime: number;
  endTime: number | null;
  top: number;
  bottom: number;
  state: 'active' | 'mitigated' | 'inverted' | 'breaker' | 'failed';
  label?: string;
}

let _zoneSeq = 0;
export function nextZoneId(prefix: string): string {
  _zoneSeq += 1;
  return `${prefix}_${_zoneSeq}`;
}
