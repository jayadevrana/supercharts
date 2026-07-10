import { describe, expect, it } from 'vitest';
import { snapToOhlc } from '../apps/web/features/terminal/drawing-snap';

const bar = (openTime: number, open: number, high: number, low: number, close: number) => ({
  openTime,
  open,
  high,
  low,
  close,
});

const CANDLES = [
  bar(0, 100, 110, 95, 105),
  bar(60_000, 105, 120, 104, 118),
  bar(120_000, 118, 119, 108, 110),
];

describe('snapToOhlc', () => {
  it('snaps to the nearest candle by time and the nearest OHLC value by price', () => {
    // 70s is nearest to the 60s bar; 119 is nearest to its high (120).
    expect(snapToOhlc(CANDLES, 70_000, 119)).toEqual({ time: 60_000, price: 120 });
  });

  it('snaps price to open/close when those are nearest', () => {
    expect(snapToOhlc(CANDLES, 121_000, 117.5)).toEqual({ time: 120_000, price: 118 });
    expect(snapToOhlc(CANDLES, 1_000, 104.6)).toEqual({ time: 0, price: 105 });
  });

  it('clamps to the first/last candle when the time is outside the buffer', () => {
    expect(snapToOhlc(CANDLES, -50_000, 96)).toEqual({ time: 0, price: 95 });
    expect(snapToOhlc(CANDLES, 999_000, 109)).toEqual({ time: 120_000, price: 108 });
  });

  it('returns null when there are no candles', () => {
    expect(snapToOhlc([], 60_000, 100)).toBeNull();
  });
});
