import { describe, expect, it } from 'vitest';
import { buildCustomScreen, describeRow, type ScreenRow } from '../apps/web/features/terminal/scanner-screen-util';

describe('buildCustomScreen', () => {
  it('RSI row → indicator_compare with a per-row spec id and the chosen length', () => {
    const rows: ScreenRow[] = [{ kind: 'rsi', length: 7, op: '<', value: 25 }];
    const s = buildCustomScreen(rows, 'all');
    expect(s.logic).toBe('all');
    expect(s.conditions).toEqual([
      { type: 'indicator_compare', indicator: 'r0_rsi', channel: 'value', operator: '<', right: { kind: 'constant', value: 25 } },
    ]);
    expect(s.indicatorSpecs[0]).toMatchObject({ id: 'r0_rsi', type: 'rsi', inputs: { length: 7 } });
  });

  it('price-vs-EMA crosses row → price_crosses targeting the EMA spec', () => {
    const rows: ScreenRow[] = [{ kind: 'price_vs_ema', length: 50, op: 'crosses_above' }];
    const s = buildCustomScreen(rows, 'any');
    expect(s.conditions).toEqual([
      { type: 'price_crosses', source: 'close', operator: 'crosses_above', target: { kind: 'indicator', indicator: 'r0_ema', channel: 'value' } },
    ]);
    expect(s.indicatorSpecs[0]).toMatchObject({ id: 'r0_ema', type: 'ema', inputs: { length: 50 } });
  });

  it('price-vs-EMA > row → flipped indicator_compare (close > ema ⇔ ema < close)', () => {
    const s = buildCustomScreen([{ kind: 'price_vs_ema', length: 21, op: '>' }], 'all');
    expect(s.conditions).toEqual([
      { type: 'indicator_compare', indicator: 'r0_ema', channel: 'value', operator: '<', right: { kind: 'price', field: 'close' } },
    ]);
  });

  it('multi-row screens get unique ids per row', () => {
    const rows: ScreenRow[] = [
      { kind: 'rsi', length: 14, op: '>', value: 60 },
      { kind: 'rvol', op: '>', value: 1.5 },
    ];
    const s = buildCustomScreen(rows, 'all');
    expect(s.conditions).toHaveLength(2);
    expect(s.indicatorSpecs.map((x) => x.id)).toEqual(['r0_rsi', 'r1_rvol']);
  });

  it('describeRow renders plain English', () => {
    expect(describeRow({ kind: 'rsi', length: 14, op: '<', value: 30 })).toBe('RSI(14) < 30');
    expect(describeRow({ kind: 'price_vs_ema', length: 21, op: 'crosses_above' })).toBe('Close crosses above EMA(21)');
    expect(describeRow({ kind: 'rvol', op: '>', value: 2 })).toBe('RVOL > 2');
  });
});
