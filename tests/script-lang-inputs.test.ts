import { describe, it, expect } from 'vitest';
import { runScript, PRICE_SOURCES } from '../packages/script-lang/src/interpreter';
import { sma } from '../packages/indicators/src/ma';
import { series, k } from './_helpers';

describe('PulseScript inputs (task 5)', () => {
  it('exposes a form schema with id/kind/default/bounds, titles falling back to the decl name', () => {
    const res = runScript(
      'let len = input.num(14, title: "Length", min: 1, max: 200, step: 2)\n' +
        'let useEma = input.bool(true)\n' +
        'let lbl = input.text("hi", title: "Label")\n' +
        'let src = input.source(open)\n' +
        'draw line(close, title: "p")',
      series([1, 2, 3]),
    );
    expect(res.inputs.map((d) => d.id)).toEqual(['len', 'useEma', 'lbl', 'src']);
    expect(res.inputs[0]).toMatchObject({ id: 'len', kind: 'num', default: 14, title: 'Length', min: 1, max: 200, step: 2 });
    expect(res.inputs[1]).toMatchObject({ id: 'useEma', kind: 'bool', default: true, title: 'useEma' });
    expect(res.inputs[2]).toMatchObject({ id: 'lbl', kind: 'text', default: 'hi', title: 'Label' });
    expect(res.inputs[3]).toMatchObject({ id: 'src', kind: 'source', default: 'open' });
    expect(res.inputs[3]!.options).toEqual([...PRICE_SOURCES]);
  });

  it('a num input drives an indicator at its default, then at an override', () => {
    const closes = [10, 11, 12, 13, 14, 15, 16, 17];
    const src = 'let len = input.num(3)\ndraw line(ta.sma(close, len), title: "s")';
    const def = runScript(src, series(closes));
    const ovr = runScript(src, series(closes), { inputs: { len: 5 } });
    for (let i = 0; i < closes.length; i++) {
      const e3 = sma(closes, 3)[i]!;
      const e5 = sma(closes, 5)[i]!;
      expect(def.plots[0]!.values[i]).toEqual(Number.isNaN(e3) ? null : e3);
      expect(ovr.plots[0]!.values[i]).toEqual(Number.isNaN(e5) ? null : e5);
    }
  });

  it('a num override is clamped to the declared min/max', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    const src = 'let len = input.num(3, min: 2, max: 10)\ndraw line(ta.sma(close, len), title: "s")';
    const res = runScript(src, series(closes), { inputs: { len: 999 } });
    const expected = sma(closes, 10); // clamped to 10
    for (let i = 0; i < closes.length; i++) {
      expect(res.plots[0]!.values[i]).toEqual(Number.isNaN(expected[i]!) ? null : expected[i]!);
    }
  });

  it('a bool input switches a branch via its override', () => {
    const src = 'let neg = input.bool(false)\nif neg {\n  draw line(0 - close, title: "p")\n} else {\n  draw line(close, title: "p")\n}';
    const def = runScript(src, series([3, 7]));
    const ovr = runScript(src, series([3, 7]), { inputs: { neg: true } });
    expect(def.plots[0]!.values).toEqual([3, 7]);
    expect(ovr.plots[0]!.values).toEqual([-3, -7]);
  });

  it('input.source resolves to the chosen price series (default vs override)', () => {
    const candles = [k(0, 1, 11, 0, 10), k(60_000, 2, 21, 1, 20)]; // open 1/2, high 11/21, low 0/1, close 10/20
    const src = 'let s = input.source(close)\ndraw line(s, title: "p")';
    expect(runScript(src, candles).plots[0]!.values).toEqual([10, 20]); // close
    expect(runScript(src, candles, { inputs: { s: 'open' } }).plots[0]!.values).toEqual([1, 2]);
    expect(runScript(src, candles, { inputs: { s: 'high' } }).plots[0]!.values).toEqual([11, 21]);
    expect(runScript(src, candles, { inputs: { s: 'hl2' } }).plots[0]!.values).toEqual([5.5, 11]);
  });

  it('clamps a num default that sits outside its own declared bounds', () => {
    const closes = Array.from({ length: 12 }, (_, i) => 100 + i);
    const res = runScript('let len = input.num(3, min: 5, max: 9)\ndraw line(ta.sma(close, len), title: "s")', series(closes));
    expect(res.inputs[0]!.default).toBe(5); // 3 clamped up to min 5
    const expected = sma(closes, 5); // and the run uses 5, matching an identical override
    for (let i = 0; i < closes.length; i++) expect(res.plots[0]!.values[i]).toEqual(Number.isNaN(expected[i]!) ? null : expected[i]!);
  });

  it('reads a positional title per the documented signature input.num(default, title, …)', () => {
    const res = runScript('let len = input.num(14, "Length", 1, 200)\ndraw line(close, title: "p")', series([1, 2]));
    expect(res.inputs[0]).toMatchObject({ id: 'len', title: 'Length', default: 14, min: 1, max: 200 });
  });

  it('a non-boolean bool default coerces the same way as an override (1 → true)', () => {
    const def = runScript('let b = input.bool(1)\ndraw line(close, title: "p")', series([1, 2]));
    expect(def.inputs[0]!.default).toBe(true);
  });

  it('rejects an unknown input kind', () => {
    expect(() => runScript('let x = input.color("red")\ndraw line(close, title: "p")', series([1, 2]))).toThrow(/unknown input kind/);
  });
});
