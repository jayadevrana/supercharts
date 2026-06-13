import { describe, it, expect } from 'vitest';
import { computeAll } from '../packages/indicators/src/runner';
import { INDICATOR_LOOKUP } from '../packages/indicators/src/registry';
import { momentum, linreg } from '../packages/indicators/src/momentum';
import { series, k } from './_helpers';

/** A long-enough oscillating series so every warm-up window fills. */
const closes = Array.from({ length: 220 }, (_, i) => 100 + Math.sin(i / 5) * 8 + i * 0.05);
const wave = series(closes);

const NEW_TYPES = [
  'stoch_rsi', 'awesome', 'momentum', 'trix', 'ultimate', 'cmo', 'dpo', 'fisher', 'coppock',
  'kst', 'tsi', 'rvgi', 'bop', 'connors_rsi', 'smi', 'wavetrend', 'squeeze_momentum',
  'williams_vix_fix', 'choppiness', 'vortex', 'mass_index', 'stc',
] as const;

describe('batch-1 oscillators — registry + runner integrity', () => {
  it('every new type is registered and computes its declared channels', () => {
    for (const type of NEW_TYPES) {
      const spec = INDICATOR_LOOKUP[type];
      expect(spec, `${type} missing from registry`).toBeDefined();
      const inputs = Object.fromEntries(spec!.inputs.map((i) => [i.key, i.default]));
      const out = computeAll(type, wave as never, inputs);
      for (const ch of spec!.channels) {
        const arr = out.get(ch);
        expect(arr, `${type}.${ch} not returned`).toBeDefined();
        expect(arr!.length, `${type}.${ch} length`).toBe(wave.length);
        // The last bar must be finite (warm-up has filled by 220 bars).
        expect(Number.isFinite(arr![arr!.length - 1]!), `${type}.${ch} finite at end`).toBe(true);
      }
    }
  });

  it('warm-up region is NaN, not fabricated zeros', () => {
    // Momentum(10) has no value before bar 10.
    const out = computeAll('momentum', wave as never, { length: 10, source: 'close' });
    const v = out.get('value')!;
    expect(Number.isNaN(v[5]!)).toBe(true);
    expect(Number.isFinite(v[50]!)).toBe(true);
  });
});

describe('momentum math spot-checks', () => {
  it('Momentum = close − close[length]', () => {
    const v = momentum(series([10, 11, 12, 13, 14, 15]), { length: 2 });
    expect(v[2]).toBeCloseTo(2); // 12 − 10
    expect(v[5]).toBeCloseTo(2); // 15 − 13
  });

  it('linreg of a straight line returns the line endpoint exactly', () => {
    // y = 2x + 3 over x=0..4 → endpoint at x=4 is 11.
    const lr = linreg([3, 5, 7, 9, 11], 5);
    expect(lr[4]).toBeCloseTo(11);
  });

  it('Awesome Oscillator is ~0 on a flat market', () => {
    const flat = Array.from({ length: 60 }, () => k(0, 50, 50.1, 49.9, 50));
    const out = computeAll('awesome', flat as never, { fast: 5, slow: 34 });
    expect(Math.abs(out.get('histogram')![59]!)).toBeLessThan(1e-6);
  });

  it('Choppiness Index stays within 0..100', () => {
    const out = computeAll('choppiness', wave as never, { length: 14 });
    for (const v of out.get('value')!) {
      if (Number.isNaN(v)) continue;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('Williams Vix Fix is non-negative', () => {
    const out = computeAll('williams_vix_fix', wave as never, { length: 22 });
    for (const v of out.get('histogram')!) {
      if (Number.isNaN(v)) continue;
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});
