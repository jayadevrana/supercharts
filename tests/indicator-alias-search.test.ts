import { describe, it, expect } from 'vitest';
import { INDICATOR_REGISTRY, INDICATOR_LOOKUP } from '../packages/indicators/src/registry';

/**
 * Regression for the headline parity gap: the indicator search matched only the display
 * label + type, so typing the acronym a trader actually uses ("EMA", "BB", "SAR") found
 * nothing (the label spells the name out — "Exponential Moving Average"). Aliases fix it.
 * This mirrors the predicate used by both pickers (indicators-dialog matches / panel filter).
 */
function findByQuery(query: string): string[] {
  const lower = query.toLowerCase();
  return INDICATOR_REGISTRY.filter(
    (s) =>
      s.label.toLowerCase().includes(lower) ||
      s.type.toLowerCase().includes(lower) ||
      (s.aliases ?? []).some((a) => a.includes(lower)),
  ).map((s) => s.type);
}

describe('indicator acronym/alias search', () => {
  it('resolves common acronyms whose label spells the name out', () => {
    expect(findByQuery('ema')).toContain('ema');
    expect(findByQuery('rsi')).toContain('rsi');
    expect(findByQuery('atr')).toContain('atr');
    expect(findByQuery('obv')).toContain('obv');
    expect(findByQuery('mfi')).toContain('mfi');
    expect(findByQuery('roc')).toContain('roc');
    expect(findByQuery('sar')).toContain('psar');
    expect(findByQuery('bb')).toContain('bollinger');
    expect(findByQuery('kc')).toContain('keltner');
    expect(findByQuery('dc')).toContain('donchian');
    expect(findByQuery('dmi')).toContain('adx');
  });

  it('typing "ema" no longer returns ONLY a band study (the original bug)', () => {
    const hits = findByQuery('ema');
    expect(hits).toContain('ema');
    // The bug was: "ema" matched only keltner (desc "EMA ± ATR"). Now the MA itself ranks.
    expect(hits[0] === 'keltner' && hits.length === 1).toBe(false);
  });

  it('"ma" surfaces every moving average', () => {
    const hits = findByQuery('ma');
    for (const t of ['sma', 'ema', 'wma', 'hma']) expect(hits).toContain(t);
  });

  it('every registry spec that needs an acronym has aliases applied', () => {
    // Specs whose label/type already contains a searchable token are exempt; these don't.
    for (const t of ['ema', 'rsi', 'atr', 'obv', 'mfi', 'roc', 'psar', 'bollinger', 'keltner', 'donchian']) {
      expect(INDICATOR_LOOKUP[t]?.aliases?.length, `${t} should carry aliases`).toBeGreaterThan(0);
    }
  });
});
