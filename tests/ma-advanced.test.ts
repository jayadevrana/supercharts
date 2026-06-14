import { describe, it, expect } from 'vitest';
import { computeAll } from '../packages/indicators/src/runner';
import { INDICATOR_LOOKUP } from '../packages/indicators/src/registry';
import { alma, vwma, kama, t3 } from '../packages/indicators/src/ma-advanced';
import { series, k } from './_helpers';

const closes = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 7) * 5 + i * 0.03);
const wave = series(closes).map((c, i) => ({ ...c, volume: 100 + (i % 5) * 30 }));

const TYPES = ['dema', 'tema', 'vwma', 'smma', 'alma', 'lsma', 'kama', 't3', 'zlema', 'mcginley'] as const;

describe('batch-3 advanced MAs — registry + runner integrity', () => {
  it('every type is registered (overlay) and computes a finite value channel at the end', () => {
    for (const type of TYPES) {
      const spec = INDICATOR_LOOKUP[type];
      expect(spec, `${type} missing`).toBeDefined();
      expect(spec!.pane).toBe('overlay');
      const inputs = Object.fromEntries(spec!.inputs.map((i) => [i.key, i.default]));
      const v = computeAll(type, wave as never, inputs).get('value')!;
      expect(v.length).toBe(wave.length);
      expect(Number.isFinite(v[v.length - 1]!), `${type} finite at end`).toBe(true);
    }
  });
});

describe('advanced MA math spot-checks', () => {
  it('every MA of a constant series equals that constant', () => {
    // 90 bars so even TEMA(21)'s 3-stage EMA warm-up (~61 bars) fills.
    const flat = series(Array.from({ length: 90 }, () => 50)).map((c) => ({ ...c, volume: 100 }));
    for (const type of TYPES) {
      const spec = INDICATOR_LOOKUP[type]!;
      const inputs = Object.fromEntries(spec.inputs.map((i) => [i.key, i.default]));
      const v = computeAll(type, flat as never, inputs).get('value')!;
      expect(v[v.length - 1]!, `${type} on flat`).toBeCloseTo(50, 4);
    }
  });

  it('VWMA biases toward the higher-volume bar', () => {
    // Two-bar window: price 10 @ vol 100, price 20 @ vol 300 → (10·100+20·300)/400 = 17.5.
    const c = [k(0, 10, 10, 10, 10, 100), k(1, 20, 20, 20, 20, 300)];
    expect(vwma(c, 2)[1]).toBeCloseTo(17.5);
  });

  it('ALMA of a constant equals the constant (weights normalise)', () => {
    const v = alma(Array.from({ length: 30 }, () => 7), 9);
    expect(v[29]).toBeCloseTo(7);
  });

  it('KAMA and T3 stay within the price envelope on a trend', () => {
    const up = Array.from({ length: 60 }, (_, i) => 100 + i);
    const kv = kama(up, 10);
    const tv = t3(up, 8);
    expect(kv[59]!).toBeGreaterThan(100);
    expect(kv[59]!).toBeLessThanOrEqual(160);
    expect(tv[59]!).toBeGreaterThan(100);
  });
});
