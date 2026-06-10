import { describe, it, expect } from 'vitest';
import { runMaCrossBacktest } from '../apps/api/src/backtester';
import { runOptimizer } from '../apps/api/src/optimizer';
import type { Candle, MaCrossAlertConfig } from '@supercharts/types';
import { k, series } from './_helpers';

/**
 * Backtester realism layer: commission / slippage / SL / TP — all hand-computed.
 *
 * Fixture math (single-MA mode, SMA(2) on close): sma2[i] = (close[i-1]+close[i])/2, so
 *   close[i] > sma2[i]  ⟺  close[i] > close[i-1]   (and ≤ mirrors).
 * A BUY therefore fires at the first up-tick after a down/flat tick, a SELL at the first
 * down-tick after an up/flat tick — every cross below is verifiable by eye.
 */

const CFG: MaCrossAlertConfig = {
  ma: { type: 'sma', length: 2, source: 'close' },
  labels: { buy: 'BUY', sell: 'SELL' },
  delivery: { web: true, telegram: false },
  timezone: 'UTC',
};

/**
 * Series A closes: 100 98 96 100 104 108 104 100 98
 *   BUY  at idx3 @100 (96→100 up-tick after down-ticks)
 *   SELL at idx6 @104 (108→104 down-tick after up-ticks) — closes the buy AND flips short
 *   end-of-data close at idx8 @98
 * Legacy trades: buy 100→104 (+4%), sell 104→98 (+5.769230…%); equity 100 → 110.
 */
const A = series([100, 98, 96, 100, 104, 108, 104, 100, 98]) as unknown as Candle[];

/**
 * Series B closes: 100 99 98 102 103 104 105 106 → single BUY at idx3 @102, then a
 * monotonic rise (no further cross). Custom highs/lows for the intrabar SL/TP checks;
 * close-source MAs ignore high/low, so the crosses are unaffected.
 */
const B = [
  k(0, 100, 100.5, 99.5, 100),
  k(60_000, 100, 100.2, 98.8, 99),
  k(120_000, 99, 99.2, 97.8, 98),
  k(180_000, 98, 102.4, 97.9, 102), // ← BUY fills at this bar's close (102)
  k(240_000, 102.2, 103.5, 102.0, 103),
  k(300_000, 103.8, 104.5, 95.0, 104), // deep wick: low 95
  k(360_000, 104, 105.5, 103.5, 105), // high 105.5
  k(420_000, 105, 106.5, 104.5, 106),
] as unknown as Candle[];

/** Series C = B but bar idx4 spans BOTH a 2% stop (99.96) and a 2% target (104.04). */
const C = [
  k(0, 100, 100.5, 99.5, 100),
  k(60_000, 100, 100.2, 98.8, 99),
  k(120_000, 99, 99.2, 97.8, 98),
  k(180_000, 98, 102.4, 97.9, 102), // ← BUY @102
  k(240_000, 102.5, 105.0, 99.0, 103), // range hits both levels in one bar
  k(300_000, 103.8, 104.5, 103.0, 104),
  k(360_000, 104, 105.5, 103.5, 105),
  k(420_000, 105, 106.5, 104.5, 106),
] as unknown as Candle[];

describe('backtester realism options', () => {
  it('legacy baseline on series A matches the hand computation', () => {
    const r = runMaCrossBacktest(A, CFG, '1h');
    expect(r.trades).toHaveLength(2);
    expect(r.trades[0]).toMatchObject({ side: 'buy', entryPrice: 100, exitPrice: 104, bars: 3 });
    expect(r.trades[0]!.pnlPercent).toBeCloseTo(4, 10);
    expect(r.trades[1]).toMatchObject({ side: 'sell', entryPrice: 104, exitPrice: 98, bars: 2 });
    expect(r.trades[1]!.pnlPercent).toBeCloseTo(5.769230769230769, 10);
    expect(r.summary.finalEquity).toBeCloseTo(110, 9);
    // Legacy trades never carry the realism-only exitReason field.
    expect(r.trades.every((t) => !('exitReason' in t))).toBe(true);
  });

  it('REGRESSION: options-absent (and inert options) === legacy output, deep equal', () => {
    const legacy = runMaCrossBacktest(A, CFG, '1h');
    expect(runMaCrossBacktest(A, CFG, '1h', {})).toEqual(legacy);
    expect(
      runMaCrossBacktest(A, CFG, '1h', {
        commissionPct: undefined,
        slippagePct: undefined,
        stopLossPct: undefined,
        takeProfitPct: undefined,
      }),
    ).toEqual(legacy);
    // Zero / negative / non-finite values are OFF, not "tiny fees".
    expect(runMaCrossBacktest(A, CFG, '1h', { commissionPct: 0, slippagePct: -1, stopLossPct: NaN })).toEqual(legacy);
  });

  it('commission: per side % of notional — cost% = fee × (1 + exit/entry)', () => {
    const r = runMaCrossBacktest(A, CFG, '1h', { commissionPct: 0.1 });
    expect(r.trades).toHaveLength(2);
    // Fills unchanged (no slippage): commission only reduces P&L.
    expect(r.trades[0]).toMatchObject({ entryPrice: 100, exitPrice: 104, exitReason: 'cross' });
    expect(r.trades[1]).toMatchObject({ entryPrice: 104, exitPrice: 98, exitReason: 'end' });
    // Trade 1: 4% − 0.1×(1 + 104/100) = 4 − 0.204 = 3.796
    expect(r.trades[0]!.pnlPercent).toBeCloseTo(3.796, 10);
    // Trade 2: 5.769230769…% − 0.1×(1 + 98/104) = 5.769230… − 0.194230… = 5.575
    expect(r.trades[1]!.pnlPercent).toBeCloseTo(5.575, 10);
    const legacy = runMaCrossBacktest(A, CFG, '1h');
    expect(r.summary.totalReturnPct).toBeLessThan(legacy.summary.totalReturnPct);
  });

  it('slippage: both fills move against the trade and ARE the recorded prices', () => {
    const r = runMaCrossBacktest(A, CFG, '1h', { slippagePct: 0.1 });
    expect(r.trades).toHaveLength(2);
    // Buy: entry 100×1.001 = 100.1, exit 104×0.999 = 103.896
    expect(r.trades[0]!.entryPrice).toBeCloseTo(100.1, 10);
    expect(r.trades[0]!.exitPrice).toBeCloseTo(103.896, 10);
    expect(r.trades[0]!.pnlPercent).toBeCloseTo(((103.896 - 100.1) / 100.1) * 100, 10); // 3.79220779…
    // Sell: entry 104×0.999 = 103.896, exit 98×1.001 = 98.098
    expect(r.trades[1]!.entryPrice).toBeCloseTo(103.896, 10);
    expect(r.trades[1]!.exitPrice).toBeCloseTo(98.098, 10);
    expect(r.trades[1]!.pnlPercent).toBeCloseTo(((103.896 - 98.098) / 103.896) * 100, 10); // 5.58058…
    const legacy = runMaCrossBacktest(A, CFG, '1h');
    expect(r.summary.totalReturnPct).toBeLessThan(legacy.summary.totalReturnPct);
  });

  it('stop loss: intrabar exit at the SL level off the candle low', () => {
    const r = runMaCrossBacktest(B, CFG, '1h', { stopLossPct: 5 });
    // Buy @102; SL level 102×0.95 = 96.9. idx4 low 102.0 survives; idx5 low 95 stops out.
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]).toMatchObject({ side: 'buy', bars: 2, exitTime: 300_000, exitReason: 'stop' });
    expect(r.trades[0]!.exitPrice).toBeCloseTo(96.9, 10);
    expect(r.trades[0]!.pnlPercent).toBeCloseTo(-5, 8);
    // Without the stop the same series rides to the end-of-data close at 106 (+3.9215…%).
    const legacy = runMaCrossBacktest(B, CFG, '1h');
    expect(legacy.trades[0]!.pnlPercent).toBeCloseTo(3.9215686274509804, 10);
  });

  it('take profit: intrabar exit at the TP level off the candle high', () => {
    const r = runMaCrossBacktest(B, CFG, '1h', { takeProfitPct: 3 });
    // Buy @102; TP level 102×1.03 = 105.06. Highs 103.5 / 104.5 miss; idx6 high 105.5 fills it.
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]).toMatchObject({ side: 'buy', bars: 3, exitTime: 360_000, exitReason: 'target' });
    expect(r.trades[0]!.exitPrice).toBeCloseTo(105.06, 10);
    expect(r.trades[0]!.pnlPercent).toBeCloseTo(3, 8);
  });

  it('SL before TP when one bar spans both levels (conservative worst case)', () => {
    const r = runMaCrossBacktest(C, CFG, '1h', { stopLossPct: 2, takeProfitPct: 2 });
    // Buy @102; idx4 (high 105 ≥ 104.04, low 99 ≤ 99.96) hits both → booked as the stop.
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]).toMatchObject({ side: 'buy', bars: 1, exitTime: 240_000, exitReason: 'stop' });
    expect(r.trades[0]!.exitPrice).toBeCloseTo(99.96, 10);
    expect(r.trades[0]!.pnlPercent).toBeCloseTo(-2, 8);
    // Sanity: with ONLY the target set, the same bar exits at the TP instead.
    const tpOnly = runMaCrossBacktest(C, CFG, '1h', { takeProfitPct: 2 });
    expect(tpOnly.trades[0]).toMatchObject({ exitTime: 240_000, exitReason: 'target' });
    expect(tpOnly.trades[0]!.exitPrice).toBeCloseTo(104.04, 10);
    expect(tpOnly.trades[0]!.pnlPercent).toBeCloseTo(2, 8);
  });

  it('optimizer pass-through: a swept combo backtests WITH fees, ranking untouched', () => {
    // Long zigzag so the dual-MA sweep (SMA 2×3) produces real trades.
    const zig: number[] = [];
    for (let leg = 0; leg < 6; leg += 1) {
      for (let i = 0; i < 6; i += 1) zig.push(leg % 2 === 0 ? 100 + i * 4 : 120 - i * 4);
    }
    const candles = series(zig) as unknown as Candle[];
    const base: MaCrossAlertConfig = { ...CFG, crossWith: { type: 'sma', length: 3 } };
    const req = { topN: 5, minTrades: 0, fastLengths: [2], slowLengths: [3] };
    const noFee = runOptimizer(candles, base, '1h', req);
    const withFee = runOptimizer(candles, base, '1h', { ...req, commissionPct: 0.25 });
    expect(noFee.combos).toHaveLength(1);
    expect(withFee.combos).toHaveLength(1);
    expect(noFee.combos[0]!.summary.trades).toBeGreaterThan(0);
    // Same combo (config grid untouched), strictly lower return once fees are charged.
    expect(withFee.combos[0]!.config).toEqual(noFee.combos[0]!.config);
    expect(withFee.combos[0]!.summary.trades).toBe(noFee.combos[0]!.summary.trades);
    expect(withFee.combos[0]!.summary.totalReturnPct).toBeLessThan(noFee.combos[0]!.summary.totalReturnPct);
  });
});
