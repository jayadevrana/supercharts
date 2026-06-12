import { describe, it, expect } from 'vitest';
import { runScript } from '../packages/script-lang/src/interpreter';
import { series } from './_helpers';

/** input.select + input.color (Pine input.string-with-options / input.color equivalents). */
describe('PulseScript input.select', () => {
  const SRC = [
    'let mode = input.select("fast", "Mode", options: ["fast", "slow", "off"])',
    'let len = mode == "fast" ? 5 : mode == "slow" ? 20 : 1',
    'draw line(ta.sma(close, len), title: "ma")',
    'mark note mode',
  ].join('\n');

  it('declares a schema with options and resolves the default', () => {
    const res = runScript(SRC, series([1, 2, 3, 4, 5, 6]));
    const def = res.inputs.find((d) => d.kind === 'select')!;
    expect(def.options).toEqual(['fast', 'slow', 'off']);
    expect(def.default).toBe('fast');
    expect(def.id).toBe('mode');
    expect(res.marks[0]!.text).toBe('fast');
  });

  it('an override picks another option; an unknown override falls back to the default', () => {
    const over = runScript(SRC, series([1, 2, 3]), { inputs: { mode: 'slow' } });
    expect(over.marks[0]!.text).toBe('slow');
    const bad = runScript(SRC, series([1, 2, 3]), { inputs: { mode: 'turbo' } });
    expect(bad.marks[0]!.text).toBe('fast');
  });

  it('select without options fails loud with the signature', () => {
    expect(() => runScript('let m = input.select("a")', series([1]))).toThrowError(/options list/);
  });
});

describe('PulseScript input.color', () => {
  it('feeds a color string into draws and accepts overrides', () => {
    const src = 'let c = input.color("#22c55e", "Line color")\ndraw line(close, color: c, title: "p")';
    const res = runScript(src, series([1, 2]));
    expect(res.inputs[0]).toMatchObject({ kind: 'color', default: '#22c55e', id: 'c' });
    expect(res.plots[0]!.color).toBe('#22c55e');
    const over = runScript(src, series([1, 2]), { inputs: { c: '#ff0000' } });
    expect(over.plots[0]!.color).toBe('#ff0000');
  });
});
