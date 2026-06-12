import { describe, it, expect } from 'vitest';
import { runScript, intervalToMs, aggregateCandles } from '../packages/script-lang/src/interpreter';
import { ema } from '../packages/indicators/src/ma';
import { series } from './_helpers';

/**
 * onTf("4h", expr) — multi-timeframe reads with strict no-repaint semantics:
 * a chart bar only ever sees the last COMPLETED higher-TF bar.
 */

const CLOSES15 = [10, 11, 12, 13, 14, 20, 21, 22, 23, 24, 30, 31, 32, 33, 34];
const C1M = series(CLOSES15); // 15 aligned 1-minute bars from t=0

const vals = (src: string, candles = C1M, interval = '1m') =>
  runScript(src, candles, { interval }).plots[0]!.values;

describe('intervalToMs / aggregateCandles', () => {
  it('parses m/h/d and rejects the rest', () => {
    expect(intervalToMs('1m')).toBe(60_000);
    expect(intervalToMs('15m')).toBe(900_000);
    expect(intervalToMs('4h')).toBe(14_400_000);
    expect(intervalToMs('1d')).toBe(86_400_000);
    expect(intervalToMs('1w')).toBeNull();
    expect(intervalToMs('x')).toBeNull();
  });

  it('aggregates OHLCV into aligned buckets and drops a partial leading bucket', () => {
    const agg = aggregateCandles(C1M, 300_000, '5m');
    expect(agg).toHaveLength(3);
    expect(agg.map((c) => c.close)).toEqual([14, 24, 34]);
    expect(agg.map((c) => c.open)).toEqual([10, 20, 30]);
    expect(agg[0]!.volume).toBe(500); // 5 × 100
    // misaligned: starts at t=2m → the partial first bucket is dropped
    const off = aggregateCandles(series(CLOSES15.slice(2), 120_000), 300_000, '5m');
    expect(off[0]!.openTime).toBe(300_000);
  });
});

describe('onTf value mapping (no repaint)', () => {
  it('a chart bar reads the last completed higher-TF close', () => {
    const v = vals('draw line(nz(onTf("5m", close), -1), title: "tf")');
    // buckets close at bars 4 / 9 / 14 — value appears exactly there, never earlier
    expect(v.slice(0, 4)).toEqual([-1, -1, -1, -1]); // warm-up: nothing completed
    expect(v[4]).toBe(14); // bucket 0 completes at bar 4's close
    expect(v.slice(5, 9)).toEqual([14, 14, 14, 14]); // forming bucket 1 is never read
    expect(v[9]).toBe(24);
    expect(v.slice(10, 14)).toEqual([24, 24, 24, 24]);
    expect(v[14]).toBe(34);
  });

  it('higher-TF studies compute on aggregated bars (ema matches a hand-built series)', () => {
    const v = vals('draw line(nz(onTf("5m", ema(close, 2)), -1), title: "tf")');
    const ref = ema([14, 24, 34], 2); // the three 5m closes
    expect(v[4]).toBe(-1); // ema(…, 2) has no value on the first 5m bar
    expect(v[9]).toBeCloseTo(ref[1]!, 9);
    expect(v[10]).toBeCloseTo(ref[1]!, 9); // held while the next 5m bar forms
    expect(v[14]).toBeCloseTo(ref[2]!, 9);
  });

  it('history works through onTf: value[5] sees the mapping five chart bars back', () => {
    const src = 'let tf = onTf("5m", close)\ndraw line(nz(tf[5], -1), title: "back")';
    const v = vals(src);
    expect(v[9]).toBe(14); // five bars before bar 9 = bar 4 → bucket 0
    expect(v[14]).toBe(24);
  });

  it('records flow through onTf (field access on a higher-TF study)', () => {
    const src = 'draw line(nz(onTf("5m", ta.donchian(2).upper), -1), title: "du")';
    const v = vals(src);
    // donchian(2).upper on 5m bars: needs 2 buckets → first value at bucket 1 (chart bar 9)
    expect(v[4]).toBe(-1);
    expect(v[9]).toBeGreaterThan(0);
  });

  it('a misaligned buffer yields none until the first complete bucket closes', () => {
    const candles = series(CLOSES15.slice(2), 120_000); // starts at t=2m
    const v = runScript('draw line(nz(onTf("5m", close), -1), title: "tf")', candles, { interval: '1m' }).plots[0]!.values;
    // bars t=2m..4m: partial leading bucket dropped → none; first complete bucket [5m,10m) closes at t=9m
    expect(v[0]).toBe(-1);
    expect(v[2]).toBe(-1);
    const bar9 = candles.findIndex((c) => c.openTime === 540_000);
    expect(v[bar9]!).toBe(CLOSES15[9]);
  });

  it('chained chart-TF studies over onTf values stay consistent (run-cache path)', () => {
    const src = 'draw line(nz(ta.sma(nz(onTf("5m", close), 0), 3), -1), title: "sm")';
    const v = vals(src);
    // bars 12..14 of nz(onTf, 0) are [24, 24, 34] → 3-bar mean
    expect(v[14]).toBeCloseTo((24 + 24 + 34) / 3, 9);
    // bars 7..9 are [14, 14, 24]
    expect(v[9]).toBeCloseTo((14 + 14 + 24) / 3, 9);
  });
});

describe('onTf guard rails', () => {
  it('requires the run interval', () => {
    expect(() => runScript('draw line(onTf("5m", close))', C1M)).toThrowError(/no chart interval/);
  });

  it('rejects lower or non-multiple timeframes and unknown units', () => {
    expect(() => runScript('draw line(onTf("1m", close))', series([1, 2], 0, 300_000), { interval: '5m' })).toThrowError(
      /whole multiple/,
    );
    expect(() => runScript('draw line(onTf("7m", close))', series([1, 2], 0, 120_000), { interval: '2m' })).toThrowError(
      /whole multiple/,
    );
    expect(() => runScript('draw line(onTf("1w", close))', C1M, { interval: '1m' })).toThrowError(/unsupported onTf timeframe/);
  });

  it('forbids chart-context variable reads inside the expression', () => {
    const src = 'let myLevel = ta.sma(close, 3)\ndraw line(onTf("5m", myLevel + 1))';
    expect(() => runScript(src, C1M, { interval: '1m' })).toThrowError(/chart-timeframe variable/);
  });

  it('forbids nesting and use inside fn bodies', () => {
    expect(() => runScript('draw line(onTf("5m", onTf("10m", close)))', C1M, { interval: '1m' })).toThrowError(
      /cannot be nested/,
    );
    expect(() => runScript('fn f() = onTf("5m", close)\ndraw line(f())', C1M, { interval: '1m' })).toThrowError(
      /top level/,
    );
  });
});
