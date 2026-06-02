import { describe, it, expect } from 'vitest';
import { runScript, RuntimeError } from '../packages/script-lang/src/interpreter';
import { sma } from '../packages/indicators/src/ma';
import { series, k } from './_helpers';

describe('PulseScript interpreter', () => {
  it('a 3-bar mean built from history matches ta.sma', () => {
    const closes = [10, 11, 12, 13, 14, 15, 16];
    const res = runScript('let s3 = (close + close[1] + close[2]) / 3\ndraw line(s3, title: "sma3")', series(closes));
    const plot = res.plots.find((p) => p.title === 'sma3')!;
    const expected = sma(closes, 3);
    for (let i = 2; i < closes.length; i++) {
      expect(plot.values[i]).toBeCloseTo(expected[i]!, 9);
    }
    expect(plot.values[0]).toBeNull(); // no history yet
    expect(plot.values[1]).toBeNull();
  });

  it('persist initialises once and carries across bars (a bar counter)', () => {
    const res = runScript('persist count = 0\ncount = count + 1\ndraw line(count, title: "c")', series([1, 2, 3, 4, 5]));
    expect(res.plots[0]!.values).toEqual([1, 2, 3, 4, 5]);
  });

  it('persist accumulates a running sum of close', () => {
    const res = runScript('persist acc = 0\nacc = acc + close\ndraw line(acc, title: "cum")', series([2, 3, 5]));
    expect(res.plots[0]!.values).toEqual([2, 5, 10]);
  });

  it('if / else selects per bar', () => {
    const candles = [k(0, 10, 11, 9, 11), k(60_000, 11, 11, 9, 10)]; // up bar, then down bar
    const res = runScript('if close > open {\n  draw line(1, title: "dir")\n} else {\n  draw line(-1, title: "dir")\n}', candles);
    expect(res.plots[0]!.values).toEqual([1, -1]);
  });

  it('when + mark records signals only on matching bars', () => {
    const candles = [k(0, 10, 12, 9, 12), k(60_000, 12, 12, 10, 10), k(120_000, 10, 13, 10, 13)];
    const res = runScript('when close > open {\n  mark buy at low "up"\n}', candles);
    expect(res.marks.map((m) => m.bar)).toEqual([0, 2]);
    expect(res.marks[0]).toMatchObject({ kind: 'buy', price: 9, text: 'up' });
  });

  it('user functions evaluate per bar', () => {
    const res = runScript('fn triple(x) = x * 3\ndraw line(triple(close), title: "t")', series([2, 3]));
    expect(res.plots[0]!.values).toEqual([6, 9]);
  });

  it('for-range loops within a bar', () => {
    const res = runScript('persist acc = 0\nacc = 0\nfor i = 1 to 3 {\n  acc = acc + i\n}\ndraw line(acc, title: "a")', series([1, 1]));
    expect(res.plots[0]!.values).toEqual([6, 6]);
  });

  it('reads meta into the result', () => {
    const res = runScript('meta(name: "Demo", overlay: true)\ndraw line(close, title: "p")', series([1]));
    expect(res.meta).toMatchObject({ name: 'Demo', overlay: true });
  });

  it('rejects reassigning a let binding', () => {
    expect(() => runScript('let x = 1\nx = 2', series([1, 2]))).toThrow(RuntimeError);
  });

  it('ta.sma(close, 3) is live (task 4 stdlib) and matches the indicators sma', () => {
    const closes = [10, 11, 12, 13, 14, 15, 16];
    const res = runScript('draw line(ta.sma(close, 3), title: "x")', series(closes));
    const expected = sma(closes, 3);
    for (let i = 2; i < closes.length; i++) expect(res.plots[0]!.values[i]).toBeCloseTo(expected[i]!, 9);
    expect(res.plots[0]!.values[0]).toBeNull();
  });
});
