import { describe, it, expect } from 'vitest';
import {
  rankPeak,
  runOptimizer,
  qualityScore,
  expectancyPct,
  profitFactorCapped,
  PF_CAP,
  type OptimizerCombo,
} from '../apps/api/src/optimizer';
import type { BacktestSummary } from '../apps/api/src/backtester';
import type { Candle, MaCrossAlertConfig } from '@supercharts/types';

/**
 * Peak-performance optimizer: objective ranking + accuracy floor + robustness guards.
 * The ranking/filter core (rankPeak) is pure — tested with synthetic BacktestSummary objects so the
 * math is asserted in isolation (no candles, no backtest run, no network).
 */

function mkSummary(o: Partial<BacktestSummary> = {}): BacktestSummary {
  return {
    trades: 30, wins: 18, losses: 12, winRate: 0.6,
    finalEquity: 130, totalReturnPct: 30, maxDrawdownPct: 10,
    sharpe: 1.5, profitFactor: 1.8, avgWinPct: 3, avgLossPct: -1.5, avgBars: 10,
    ...o,
  };
}

function mkCombo(fast: number, slow: number, o: Partial<BacktestSummary> = {}): OptimizerCombo {
  return {
    config: {
      ma: { type: 'ema', length: fast, source: 'close' },
      crossWith: { type: 'ema', length: slow },
      labels: { buy: 'BUY', sell: 'SELL' },
      delivery: { web: true, telegram: false },
      timezone: 'UTC',
    },
    summary: mkSummary(o),
    score: 0,
  };
}
const fastOf = (c: OptimizerCombo): number => c.config.ma.length;

describe('pure metric helpers', () => {
  it('expectancyPct uses the (already-negative) avgLossPct', () => {
    // 0.6·3 + 0.4·(−1.5) = 1.8 − 0.6 = 1.2
    expect(expectancyPct(mkSummary({ winRate: 0.6, avgWinPct: 3, avgLossPct: -1.5 }))).toBeCloseTo(1.2, 6);
  });
  it('profitFactorCapped maps Infinity → PF_CAP and clamps the rest', () => {
    expect(profitFactorCapped(mkSummary({ profitFactor: Infinity }))).toBe(PF_CAP);
    expect(profitFactorCapped(mkSummary({ profitFactor: 9 }))).toBe(PF_CAP);
    expect(profitFactorCapped(mkSummary({ profitFactor: 1.8 }))).toBe(1.8);
  });
  it('qualityScore matches a hand-computed value', () => {
    const s = mkSummary({ sharpe: 3, winRate: 0.65, profitFactor: 5, maxDrawdownPct: 0, trades: 30, avgWinPct: 2, avgLossPct: -1 });
    // nSharpe 1, nExpect clamp(0.95/2)=0.475, nPF 1, nWin 1, ddPen 0, sampleConf 1
    // raw = .3 + .25*.475 + .2 + .15 = 0.76875
    expect(qualityScore(s, 10)).toBeCloseTo(0.76875, 5);
  });
});

describe('the named fluke (9×75 = +750% @ 15% win) is EXCLUDED by the accuracy floor', () => {
  const fluke = mkCombo(9, 75, { totalReturnPct: 750, winRate: 0.15, wins: 3, losses: 17, profitFactor: 1.2, avgWinPct: 60, avgLossPct: -8 });
  const good = mkCombo(10, 39, { totalReturnPct: 31, winRate: 0.67, wins: 20, losses: 10 });
  for (const objective of ['profit', 'accuracy', 'balanced'] as const) {
    it(`objective=${objective}: fluke never appears with minWinRate=0.60`, () => {
      const r = rankPeak([fluke, good], { objective, minWinRate: 0.6 });
      expect(r.combos.some((c) => fastOf(c) === 9)).toBe(false);
      expect(r.filtered!.belowWinRate).toBeGreaterThanOrEqual(1);
    });
  }
});

describe('profit objective', () => {
  it('ranks by total return, then Sharpe, then shallower DD', () => {
    const r = rankPeak([mkCombo(5, 20, { totalReturnPct: 50 }), mkCombo(7, 30, { totalReturnPct: 80 }), mkCombo(9, 40, { totalReturnPct: 65 })], { objective: 'profit' });
    expect(r.combos.map((c) => c.summary.totalReturnPct)).toEqual([80, 65, 50]);
  });
  it('breaks equal returns by higher Sharpe', () => {
    const r = rankPeak([mkCombo(5, 20, { totalReturnPct: 50, sharpe: 1.0 }), mkCombo(7, 30, { totalReturnPct: 50, sharpe: 2.0 })], { objective: 'profit' });
    expect(fastOf(r.combos[0]!)).toBe(7);
  });
  it('ignores the legacy composite score — ranks the full pool by the objective', () => {
    const lowScore = mkCombo(5, 20, { totalReturnPct: 90, sharpe: 0.3, maxDrawdownPct: 30 });
    lowScore.score = -100; // would lose under legacy sharpe-dd ranking
    const r = rankPeak([lowScore, mkCombo(7, 30, { totalReturnPct: 40 })], { objective: 'profit' });
    expect(r.combos[0]!.summary.totalReturnPct).toBe(90);
  });
});

describe('accuracy objective', () => {
  it('ranks by win rate, then expectancy (kills the high-win/negative-edge trap)', () => {
    const negEdge = mkCombo(5, 20, { winRate: 0.9, wins: 27, losses: 3, avgWinPct: 1, avgLossPct: -20 });
    const posEdge = mkCombo(7, 30, { winRate: 0.9, wins: 27, losses: 3, avgWinPct: 3, avgLossPct: -1 });
    const r = rankPeak([negEdge, posEdge], { objective: 'accuracy' });
    expect(fastOf(r.combos[0]!)).toBe(7);
  });
  it('drops a 100%-win / 5-trade combo by the raised min-trades floor', () => {
    const tiny = mkCombo(5, 20, { trades: 5, wins: 5, losses: 0, winRate: 1 });
    const r = rankPeak([tiny, mkCombo(7, 30)], { objective: 'accuracy' });
    expect(r.combos.some((c) => c.summary.trades === 5)).toBe(false);
    expect(r.filtered!.belowMinTrades).toBeGreaterThanOrEqual(1);
  });
});

describe('balanced objective', () => {
  it('a deep-DD / low-PF / low-win huge-return combo scores BELOW a steady combo', () => {
    const flashy = mkCombo(9, 75, { totalReturnPct: 300, winRate: 0.4, wins: 8, losses: 12, profitFactor: 1.1, maxDrawdownPct: 45, avgWinPct: 50, avgLossPct: -30, sharpe: 0.5 });
    const steady = mkCombo(10, 39, { totalReturnPct: 60, winRate: 0.6, profitFactor: 1.8, maxDrawdownPct: 12, sharpe: 1.5, avgWinPct: 3, avgLossPct: -1.5 });
    const r = rankPeak([flashy, steady], { objective: 'balanced', minWinRate: 0 });
    expect(fastOf(r.combos[0]!)).toBe(10);
  });
});

describe('Infinity profit-factor (zero losing trades)', () => {
  const noLoss = mkCombo(5, 20, { losses: 0, wins: 30, winRate: 1, profitFactor: Infinity, avgLossPct: 0, avgWinPct: 2, totalReturnPct: 60 });
  it('is excluded by default (requireLosingTrade) — suspicious, not perfect', () => {
    const r = rankPeak([noLoss, mkCombo(7, 30)], { objective: 'profit' });
    expect(r.combos.some((c) => c.summary.losses === 0)).toBe(false);
    expect(r.filtered!.zeroLoss).toBe(1);
  });
  it('is included + flagged when requireLosingTrade=false, and never leaks Infinity', () => {
    const r = rankPeak([noLoss, mkCombo(7, 30)], { objective: 'profit', requireLosingTrade: false });
    const inc = r.combos.find((c) => c.summary.losses === 0)!;
    expect(inc).toBeDefined();
    expect(inc.metrics!.robustness.flags).toContain('no losing trades');
    expect(Number.isFinite(inc.metrics!.profitFactorCapped)).toBe(true);
    expect(JSON.stringify(inc.metrics)).not.toContain('null'); // no Infinity → null in the wire
  });
});

describe('expectancy filter', () => {
  const negExp = mkCombo(5, 20, { totalReturnPct: 10, winRate: 0.5, wins: 15, losses: 15, avgWinPct: 1, avgLossPct: -2 });
  it('excludes positive-return / negative-expectancy combos for profit', () => {
    const r = rankPeak([negExp, mkCombo(7, 30)], { objective: 'profit', minWinRate: 0 });
    expect(r.combos.some((c) => fastOf(c) === 5)).toBe(false);
    expect(r.filtered!.nonPositiveExpectancy).toBeGreaterThanOrEqual(1);
  });
  it('surfaces them (not excluded) for accuracy', () => {
    const r = rankPeak([negExp, mkCombo(7, 30)], { objective: 'accuracy', minWinRate: 0 });
    expect(r.combos.some((c) => fastOf(c) === 5)).toBe(true);
  });
});

describe('floors, counts + honest note', () => {
  it('empties the list when no combo meets the win-rate floor and reports the best seen', () => {
    const r = rankPeak([mkCombo(5, 20, { winRate: 0.5 }), mkCombo(7, 30, { winRate: 0.55 })], { objective: 'profit', minWinRate: 0.6 });
    expect(r.combos).toHaveLength(0);
    expect(r.note).toMatch(/win rate/i);
    expect(r.floor!.bestWinRate).toBeCloseTo(0.55, 5);
    expect(r.filtered!.belowWinRate).toBe(2);
  });
});

describe('runOptimizer wiring + back-compat', () => {
  const candles: Candle[] = Array.from({ length: 420 }, (_, i) => {
    const price = 100 + Math.sin(i / 8) * 8 + i * 0.04 + Math.sin(i / 3) * 2;
    return { openTime: i * 3_600_000, closeTime: i * 3_600_000 + 1, open: price, high: price + 1, low: price - 1, close: price, volume: 100 } as Candle;
  });
  const base: MaCrossAlertConfig = {
    ma: { type: 'ema', length: 7, source: 'close' },
    crossWith: { type: 'ema', length: 21 },
    labels: { buy: 'BUY', sell: 'SELL' },
    delivery: { web: true, telegram: false },
    timezone: 'UTC',
  };
  it('legacy path (no objective) is unchanged: score-sorted, no metrics, no objective field', () => {
    const r = runOptimizer(candles, base, '1h', {});
    expect(r.objective).toBeUndefined();
    expect(r.combos.every((c) => c.metrics === undefined)).toBe(true);
    for (let i = 1; i < r.combos.length; i++) {
      expect(r.combos[i - 1]!.score).toBeGreaterThanOrEqual(r.combos[i]!.score);
    }
  });
  it('peak path attaches metrics + objective + appliedMinTrades', () => {
    const r = runOptimizer(candles, base, '1h', { objective: 'profit', minWinRate: 0 });
    expect(r.objective).toBe('profit');
    expect(r.appliedMinTrades).toBe(10);
    expect(r.combos.every((c) => c.metrics !== undefined)).toBe(true);
    // ranks are 1..n in order
    r.combos.forEach((c, i) => expect(c.metrics!.rank).toBe(i + 1));
  });
});

describe('honest empty-result note + fallback candidates (never dead-end)', () => {
  // Every combo is UNPROFITABLE (PF < 1) but ABOVE the win-rate floor — the old note
  // wrongly blamed the floor ("no setting met win rate ≥ 10%… best seen 40%").
  const losers = [
    mkCombo(5, 20, { totalReturnPct: -8, winRate: 0.40, wins: 12, losses: 18, profitFactor: 0.7, avgWinPct: 1, avgLossPct: -1.2 }),
    mkCombo(7, 30, { totalReturnPct: -4, winRate: 0.38, wins: 11, losses: 19, profitFactor: 0.8, avgWinPct: 1, avgLossPct: -1.1 }),
    mkCombo(9, 40, { totalReturnPct: -12, winRate: 0.33, wins: 10, losses: 20, profitFactor: 0.6, avgWinPct: 1, avgLossPct: -1.4 }),
  ];

  it('attributes the empty result to unprofitability, NOT the win-rate floor', () => {
    const r = rankPeak(losers, { objective: 'profit', minWinRate: 0.1 });
    expect(r.combos).toHaveLength(0);
    expect(r.filtered!.belowWinRate).toBe(0);
    expect(r.note).toMatch(/unprofitable/i);
    expect(r.note).not.toMatch(/win rate floor/i);
  });

  it('still blames the floor when the floor IS the binding filter', () => {
    const r = rankPeak(
      [mkCombo(5, 20, { winRate: 0.5 }), mkCombo(7, 30, { winRate: 0.55 })],
      { objective: 'profit', minWinRate: 0.6 },
    );
    expect(r.note).toMatch(/win rate/i);
    expect(r.note).toMatch(/55%/);
  });

  it('returns fallback candidates ranked by the objective, flagged below-quality-bar', () => {
    const r = rankPeak(losers, { objective: 'profit', minWinRate: 0.1 });
    expect(r.fallbackCombos).toBeDefined();
    expect(r.fallbackCombos!.length).toBe(3);
    // profit objective → least-bad return first
    expect(r.fallbackCombos!.map((c) => c.summary.totalReturnPct)).toEqual([-4, -8, -12]);
    for (const c of r.fallbackCombos!) {
      expect(c.metrics!.robustness.flags[0]).toBe('below quality bar');
      expect(c.metrics!.robustness.tone).toBe('red');
    }
    expect(r.fallbackCombos!.map((c) => c.metrics!.rank)).toEqual([1, 2, 3]);
  });

  it('omits fallbackCombos entirely when real winners exist', () => {
    const r = rankPeak([mkCombo(10, 39)], { objective: 'profit', minWinRate: 0 });
    expect(r.combos).toHaveLength(1);
    expect(r.fallbackCombos).toBeUndefined();
  });
});
