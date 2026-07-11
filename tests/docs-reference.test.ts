import { describe, expect, it } from 'vitest';
import { runScript } from '../packages/script-lang/src/interpreter';
import { TA, MATH } from '../packages/script-lang/src/stdlib';
import { series } from './_helpers';
import { TA_DOCS } from '../apps/web/features/docs/reference/ta';
import { MATH_DOCS } from '../apps/web/features/docs/reference/math';
import { INPUT_DOCS } from '../apps/web/features/docs/reference/inputs';
import { OUTPUT_DOCS } from '../apps/web/features/docs/reference/outputs';

// Long wavy series: enough bars for every study's warmup + a couple of completed 4h buckets.
const CLOSES = Array.from({ length: 700 }, (_, i) => 100 + Math.sin(i / 7) * 9 + Math.cos(i / 23) * 4 + (i % 13) * 0.2);
const CANDLES = series(CLOSES);

function runsClean(src: string): { ok: boolean; err?: string } {
  try {
    runScript(src, CANDLES, { interval: '1m' });
    return { ok: true };
  } catch (e) {
    return { ok: false, err: e instanceof Error ? e.message : String(e) };
  }
}

describe('docs API reference — coverage (fails if the language changes without docs)', () => {
  it('documents every ta.* function', () => {
    const missing = Object.keys(TA).filter((k) => !(k in TA_DOCS));
    expect(missing, `undocumented ta.*: ${missing.join(', ')}`).toEqual([]);
    expect(Object.keys(TA_DOCS).length).toBe(Object.keys(TA).length);
  });

  it('documents every math.* function', () => {
    const missing = Object.keys(MATH).filter((k) => !(k in MATH_DOCS));
    expect(missing, `undocumented math.*: ${missing.join(', ')}`).toEqual([]);
  });

  it('has ≥61 ta.* entries and ≥24 math.* entries', () => {
    expect(Object.keys(TA_DOCS).length).toBeGreaterThanOrEqual(61);
    expect(Object.keys(MATH_DOCS).length).toBeGreaterThanOrEqual(24);
  });
});

describe('docs API reference — every example runs clean', () => {
  for (const [name, entry] of Object.entries(TA_DOCS)) {
    it(`ta.${name} example runs`, () => {
      const r = runsClean(entry.example);
      expect(r.ok, `ta.${name}: ${r.err}`).toBe(true);
    });
  }
  for (const [name, entry] of Object.entries(MATH_DOCS)) {
    it(`math.${name} example runs`, () => {
      const r = runsClean(entry.example);
      expect(r.ok, `math.${name}: ${r.err}`).toBe(true);
    });
  }
  for (const [name, entry] of Object.entries(INPUT_DOCS)) {
    it(`input.${name} example runs`, () => {
      const r = runsClean(entry.example);
      expect(r.ok, `input.${name}: ${r.err}`).toBe(true);
    });
  }
  for (const [name, entry] of Object.entries(OUTPUT_DOCS)) {
    it(`output ${name} example runs`, () => {
      const r = runsClean(entry.example);
      expect(r.ok, `output ${name}: ${r.err}`).toBe(true);
    });
  }
});
