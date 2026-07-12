import { describe, expect, it } from 'vitest';
import { runScript } from '../packages/script-lang/src/interpreter';
import { RECIPES, RECIPE_CATEGORIES } from '../apps/web/features/docs/cookbook';
import { k } from './_helpers';

// 8000 1m bars = 33 completed 4h buckets, enough for the HTF-gate recipe's onTf("4h", ema(21))
// to fully warm up, plus every intrabar warmup (sma 200, bands 20, etc.). Unlike the bare
// `series()` helper (open==close, flat volume), these candles have a real open (= prior close)
// and volume that periodically spikes — so the up-bar and relative-volume recipes can trigger.
const CLOSES = Array.from({ length: 8000 }, (_, i) => 100 + Math.sin(i / 11) * 9 + Math.cos(i / 29) * 5 + (i % 19) * 0.25);
const CANDLES = CLOSES.map((c, i) => {
  const open = i === 0 ? c : CLOSES[i - 1]!;
  const high = Math.max(open, c) + 0.5;
  const low = Math.min(open, c) - 0.5;
  const volume = 100 + (i % 37 === 0 ? 480 : (i % 11) * 15); // ~5x spike every 37 bars → rvol > 2
  return k(i * 60_000, open, high, low, c, volume);
});

describe('cookbook recipes', () => {
  for (const recipe of RECIPES) {
    it(`"${recipe.title}" runs clean and produces output`, () => {
      const res = runScript(recipe.code, CANDLES, { interval: '1m' });
      const output =
        res.plots.length +
        res.marks.length +
        res.levels.length +
        res.shapes.length +
        res.alerts.length +
        res.bgFills.filter(Boolean).length +
        res.barTints.filter(Boolean).length;
      expect(output, `${recipe.id} produced no visible output`).toBeGreaterThan(0);
    });
  }

  it('every recipe has a known category and unique id', () => {
    const ids = new Set<string>();
    for (const r of RECIPES) {
      expect(RECIPE_CATEGORIES).toContain(r.category);
      expect(ids.has(r.id), `duplicate id ${r.id}`).toBe(false);
      ids.add(r.id);
    }
    expect(RECIPES.length).toBeGreaterThanOrEqual(10);
  });
});
