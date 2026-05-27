import type { Candle } from '@supercharts/types';

/**
 * Simple candlestick pattern detectors. Each accepts the most recent
 * `Candle[]` window (typically 3-5 bars) and returns true when the pattern
 * is satisfied on the last bar.
 */

function body(c: Candle): number {
  return Math.abs(c.close - c.open);
}

function upperShadow(c: Candle): number {
  return c.high - Math.max(c.open, c.close);
}

function lowerShadow(c: Candle): number {
  return Math.min(c.open, c.close) - c.low;
}

function isBull(c: Candle): boolean {
  return c.close > c.open;
}

function isBear(c: Candle): boolean {
  return c.close < c.open;
}

export function detectBullishEngulfing(bars: readonly Candle[]): boolean {
  if (bars.length < 2) return false;
  const prev = bars[bars.length - 2]!;
  const cur = bars[bars.length - 1]!;
  return isBear(prev) && isBull(cur) && cur.open <= prev.close && cur.close >= prev.open;
}

export function detectBearishEngulfing(bars: readonly Candle[]): boolean {
  if (bars.length < 2) return false;
  const prev = bars[bars.length - 2]!;
  const cur = bars[bars.length - 1]!;
  return isBull(prev) && isBear(cur) && cur.open >= prev.close && cur.close <= prev.open;
}

export function detectHammer(bars: readonly Candle[]): boolean {
  if (bars.length < 1) return false;
  const c = bars[bars.length - 1]!;
  const b = body(c);
  if (b === 0) return false;
  return lowerShadow(c) >= 2 * b && upperShadow(c) <= b * 0.5;
}

export function detectShootingStar(bars: readonly Candle[]): boolean {
  if (bars.length < 1) return false;
  const c = bars[bars.length - 1]!;
  const b = body(c);
  if (b === 0) return false;
  return upperShadow(c) >= 2 * b && lowerShadow(c) <= b * 0.5;
}

export function detectInsideBar(bars: readonly Candle[]): boolean {
  if (bars.length < 2) return false;
  const prev = bars[bars.length - 2]!;
  const cur = bars[bars.length - 1]!;
  return cur.high < prev.high && cur.low > prev.low;
}

export function detectOutsideBar(bars: readonly Candle[]): boolean {
  if (bars.length < 2) return false;
  const prev = bars[bars.length - 2]!;
  const cur = bars[bars.length - 1]!;
  return cur.high > prev.high && cur.low < prev.low;
}

export function detectPinBarBull(bars: readonly Candle[]): boolean {
  if (bars.length < 1) return false;
  const c = bars[bars.length - 1]!;
  const b = body(c);
  const range = c.high - c.low;
  if (range === 0) return false;
  return lowerShadow(c) / range > 0.55 && b / range < 0.35 && c.close > (c.high + c.low) / 2;
}

export function detectPinBarBear(bars: readonly Candle[]): boolean {
  if (bars.length < 1) return false;
  const c = bars[bars.length - 1]!;
  const b = body(c);
  const range = c.high - c.low;
  if (range === 0) return false;
  return upperShadow(c) / range > 0.55 && b / range < 0.35 && c.close < (c.high + c.low) / 2;
}
