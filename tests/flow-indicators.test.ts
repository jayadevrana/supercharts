import { describe, it, expect } from 'vitest';
import { computeAll } from '../packages/indicators/src/runner';
import { INDICATOR_LOOKUP } from '../packages/indicators/src/registry';
import { netVolume, priceVolumeTrend } from '../packages/indicators/src/flow';
import { series, k } from './_helpers';

const closes = Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 6) * 6 + i * 0.04);
const wave = series(closes).map((c, i) => ({ ...c, volume: 100 + (i % 7) * 20 }));

const TYPES = ['adl', 'chaikin_osc', 'eom', 'pvt', 'nvi', 'pvi', 'klinger', 'force_index', 'bull_bear_power', 'net_volume'] as const;

describe('batch-2 volume/flow — registry + runner integrity', () => {
  it('every type is registered and computes its declared channels, finite at end', () => {
    for (const type of TYPES) {
      const spec = INDICATOR_LOOKUP[type];
      expect(spec, `${type} missing`).toBeDefined();
      const inputs = Object.fromEntries(spec!.inputs.map((i) => [i.key, i.default]));
      const out = computeAll(type, wave as never, inputs);
      for (const ch of spec!.channels) {
        const arr = out.get(ch);
        expect(arr, `${type}.${ch} missing`).toBeDefined();
        expect(arr!.length).toBe(wave.length);
        expect(Number.isFinite(arr![arr!.length - 1]!), `${type}.${ch} finite at end`).toBe(true);
      }
    }
  });
});

describe('flow math spot-checks', () => {
  it('Net Volume = +volume on up bars, −volume on down bars', () => {
    const c = [k(0, 10, 11, 9, 10, 100), k(1, 10, 12, 9, 11, 200), k(2, 11, 12, 8, 9, 150)];
    const v = netVolume(c);
    expect(v[1]).toBe(200); // close 11 > 10 → +200
    expect(v[2]).toBe(-150); // close 9 < 11 → −150
  });

  it('PVT accumulates and moves with price direction', () => {
    const c = [k(0, 10, 10, 10, 10, 100), k(1, 10, 11, 10, 11, 100), k(2, 11, 11, 10, 10, 100)];
    const v = priceVolumeTrend(c);
    expect(v[0]).toBe(0);
    expect(v[1]!).toBeGreaterThan(0); // price up → PVT up
    expect(v[2]!).toBeLessThan(v[1]!); // price down → PVT down
  });

  it('A/D line is cumulative (monotone-ish under steady accumulation)', () => {
    // Closes pinned at the high → strong accumulation → rising ADL.
    const c = Array.from({ length: 30 }, (_, i) => k(i, 10, 11, 9, 11, 100));
    const v = computeAll('adl', c as never, {}).get('value')!;
    expect(v[29]!).toBeGreaterThan(v[0]!);
  });
});
