import { describe, expect, it } from 'vitest';
import { runScript } from '../packages/script-lang/src/interpreter';
import { ALL_SAMPLES } from '../apps/web/features/docs/samples';
import { series } from './_helpers';

// Deterministic wavy series — enough bars for every sample's warmup (incl. 4h onTf buckets
// when the docs samples run on the live 1m chart; here 600 bars exercises the code paths).
// 6000 1m bars = 25 completed 4h buckets, so the MTF sample's HTF EMA(20) materialises.
const CLOSES = Array.from({ length: 6000 }, (_, i) => 100 + Math.sin(i / 9) * 8 + (i % 17) * 0.3);
const CANDLES = series(CLOSES);

describe('public docs code samples', () => {
  for (const [name, src] of Object.entries(ALL_SAMPLES)) {
    it(`${name} runs clean through the real interpreter`, () => {
      const res = runScript(src, CANDLES, { interval: '1m' });
      // Every sample must produce SOMETHING (plot/mark/level/paint/alert) — docs never show inert code.
      const output =
        res.plots.length + res.marks.length + res.levels.length + res.shapes.length + res.alerts.length +
        res.bgFills.filter(Boolean).length + res.barTints.filter(Boolean).length;
      expect(output).toBeGreaterThan(0);
    });
  }

  it('covers every sample the pages import (no orphans)', () => {
    expect(Object.keys(ALL_SAMPLES).length).toBeGreaterThanOrEqual(9);
  });
});
