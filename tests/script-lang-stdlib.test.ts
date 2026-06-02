import { describe, it, expect } from 'vitest';
import { runScript } from '../packages/script-lang/src/interpreter';
import { ema } from '../packages/indicators/src/ma';
import { rsi } from '../packages/indicators/src/oscillators';
import { atr } from '../packages/indicators/src/volatility';
import { series } from './_helpers';

describe('PulseScript stdlib (task 4)', () => {
  it('bare ema(close, 5) matches @supercharts/indicators ema', () => {
    const closes = [10, 12, 11, 13, 15, 14, 16, 18, 17, 19, 21];
    const res = runScript('draw line(ema(close, 5), title: "e")', series(closes));
    const expected = ema(closes, 5);
    for (let i = 0; i < closes.length; i++) {
      if (Number.isNaN(expected[i]!)) expect(res.plots[0]!.values[i]).toBeNull();
      else expect(res.plots[0]!.values[i]).toBeCloseTo(expected[i]!, 9);
    }
  });

  it('ta.rsi(close, 14) matches the indicators rsi bar-for-bar', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + Math.sin(i / 2) * 6 + i * 0.3);
    const candles = series(closes);
    const res = runScript('draw line(ta.rsi(close, 14), title: "r")', candles);
    const expected = rsi(candles, { length: 14 });
    for (let i = 0; i < closes.length; i++) {
      if (Number.isNaN(expected[i]!)) expect(res.plots[0]!.values[i]).toBeNull();
      else expect(res.plots[0]!.values[i]).toBeCloseTo(expected[i]!, 8);
    }
  });

  it('ta.atr(14) matches the indicators atr (candle-based, no series arg)', () => {
    const closes = Array.from({ length: 25 }, (_, i) => 50 + i + (i % 3));
    const candles = series(closes);
    const res = runScript('draw line(ta.atr(14), title: "a")', candles);
    const expected = atr(candles, { length: 14 });
    for (let i = 0; i < closes.length; i++) {
      if (Number.isNaN(expected[i]!)) expect(res.plots[0]!.values[i]).toBeNull();
      else expect(res.plots[0]!.values[i]).toBeCloseTo(expected[i]!, 9);
    }
  });

  it('math.* scalar helpers evaluate per bar', () => {
    const res = runScript(
      'draw line(math.max(close, 100), title: "mx")\ndraw line(math.abs(close - 100), title: "ab")\ndraw line(math.pow(2, 3), title: "pw")',
      series([90, 110]),
    );
    const mx = res.plots.find((p) => p.title === 'mx')!;
    const ab = res.plots.find((p) => p.title === 'ab')!;
    const pw = res.plots.find((p) => p.title === 'pw')!;
    expect(mx.values).toEqual([100, 110]);
    expect(ab.values).toEqual([10, 10]);
    expect(pw.values).toEqual([8, 8]);
  });

  it('nz(x, d) replaces none with a default; na(x) detects it', () => {
    const nzRes = runScript('draw line(nz(close[3], -1), title: "nz")', series([5, 6, 7, 8, 9]));
    expect(nzRes.plots[0]!.values).toEqual([-1, -1, -1, 5, 6]);
    const naRes = runScript('when na(close[3]) {\n  mark note at close "warm"\n}', series([5, 6, 7, 8, 9]));
    expect(naRes.marks.map((m) => m.bar)).toEqual([0, 1, 2]);
  });

  it('crossOver / crossUnder fire on the crossing bar (scalar promoted to a flat series)', () => {
    const closes = [98, 99, 101, 100, 102, 97];
    const over = runScript('when crossOver(close, 100) {\n  mark buy\n}', series(closes));
    expect(over.marks.map((m) => m.bar)).toEqual([2, 4]);
    const under = runScript('when crossUnder(close, 100) {\n  mark sell\n}', series(closes));
    expect(under.marks.map((m) => m.bar)).toEqual([5]);
  });

  it('change / highest / lowest compute rolling values', () => {
    const closes = [10, 13, 11, 17, 12];
    const ch = runScript('draw line(change(close), title: "c")', series(closes));
    expect(ch.plots[0]!.values).toEqual([null, 3, -2, 6, -5]);
    const hi = runScript('draw line(highest(close, 3), title: "h")', series(closes));
    expect(hi.plots[0]!.values).toEqual([null, null, 13, 17, 17]);
    const lo = runScript('draw line(lowest(close, 3), title: "l")', series(closes));
    expect(lo.plots[0]!.values).toEqual([null, null, 10, 11, 11]);
  });

  it('draw hist and draw band capture their kind + edges', () => {
    const res = runScript('draw hist(close, title: "h")\ndraw band(high, low, title: "b")', series([10, 20]));
    const h = res.plots.find((p) => p.title === 'h')!;
    const b = res.plots.find((p) => p.title === 'b')!;
    expect(h.kind).toBe('hist');
    expect(h.values).toEqual([10, 20]);
    expect(b.kind).toBe('band');
    expect(b.values).toEqual([10.5, 20.5]); // high = close + 0.5
    expect(b.values2).toEqual([9.5, 19.5]); // low = close - 0.5
  });
});
