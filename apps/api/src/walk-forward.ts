import type { Candle, MaCrossAlertConfig } from '@supercharts/types';
import { runMaCrossBacktest, type BacktestSummary, type BacktestTrade } from './backtester';
import { runOptimizer, type OptimizeRequest } from './optimizer';

/**
 * Walk-forward analysis (a.k.a. anchored / rolling out-of-sample test).
 *
 * For each rolling window of bars: optimize on the train slice, lock the best combo,
 * apply it to the immediately-following test slice, record OOS performance. Repeat
 * until we run out of candles.
 *
 * Why it matters:
 *   - A grid optimizer can hand-pick params that look great on the lookback but fall
 *     apart out of sample (curve-fitting).
 *   - Walk-forward separates "the system has edge" from "we cherry-picked numbers".
 *   - The aggregate OOS equity curve is what a trader would actually have realised had
 *     they re-optimized periodically and traded the picks forward.
 *
 * v1 limitations:
 *   - Single composite score (Sharpe − DD penalty) carries from optimizer; no walk-
 *     forward-specific objective yet (e.g. trade-count weighting).
 *   - Best combo is chosen once per train window; no parameter blending.
 *   - Test window of N bars is fixed; user-controlled in the route.
 */

export interface WalkForwardWindow {
  trainStart: number;
  trainEnd: number;
  testStart: number;
  testEnd: number;
  /** Number of combos that qualified during the train optimization. */
  trainCombos: number;
  /** Winning combo's score on the train slice. */
  trainScore: number;
  trainSummary: BacktestSummary;
  /** Config picked from the train slice. */
  pickedConfig: MaCrossAlertConfig;
  /** OOS backtest using the picked config on the test slice. */
  testSummary: BacktestSummary;
  /** OOS trades, for the aggregate equity rebuild. */
  testTrades: BacktestTrade[];
}

export interface WalkForwardAggregate {
  windows: number;
  /** Cumulative OOS return (compounded across all test windows). */
  oosReturnPct: number;
  /** Sum of OOS trades across all windows. */
  oosTrades: number;
  /** Aggregate OOS win rate. */
  oosWinRate: number;
  /** Worst peak-to-trough drawdown across the aggregated OOS equity curve. */
  oosMaxDrawdownPct: number;
  /** Sharpe across all OOS trades. */
  oosSharpe: number;
  /** Mean Sharpe of the per-window TRAIN slices — a quick sanity check on the picks. */
  meanTrainSharpe: number;
  /** Robustness: oosSharpe / meanTrainSharpe. Close to 1 = generalises; near 0 = curve-fit. */
  robustness: number;
}

export interface WalkForwardRequest {
  trainBars?: number;
  testBars?: number;
  /** Step between windows. Defaults to testBars (non-overlapping). */
  step?: number;
  optimize?: OptimizeRequest;
}

export interface WalkForwardResult {
  windows: WalkForwardWindow[];
  aggregate: WalkForwardAggregate;
}

const BARS_PER_YEAR: Record<string, number> = {
  '1m': 525600,
  '5m': 105120,
  '15m': 35040,
  '30m': 17520,
  '1h': 8760,
  '2h': 4380,
  '4h': 2190,
  '6h': 1460,
  '12h': 730,
  '1d': 365,
  '1w': 52,
  '1mo': 12,
};

export function runWalkForward(
  candles: ReadonlyArray<Candle>,
  base: MaCrossAlertConfig,
  interval: string,
  req: WalkForwardRequest = {},
): WalkForwardResult {
  const trainBars = req.trainBars ?? 250;
  const testBars = req.testBars ?? 60;
  const step = req.step ?? testBars;
  const optReq: OptimizeRequest = { topN: 1, minTrades: 5, ...req.optimize };

  if (candles.length < trainBars + testBars) {
    return {
      windows: [],
      aggregate: emptyAggregate(),
    };
  }

  const windows: WalkForwardWindow[] = [];
  const oosTrades: BacktestTrade[] = [];

  for (let i = 0; i + trainBars + testBars <= candles.length; i += step) {
    const train = candles.slice(i, i + trainBars);
    const test = candles.slice(i + trainBars, i + trainBars + testBars);
    const opt = runOptimizer(train, base, interval, optReq);
    if (opt.combos.length === 0) continue; // no qualifying picks; skip this window
    const winner = opt.combos[0]!;
    const testResult = runMaCrossBacktest(test, winner.config, interval);
    windows.push({
      trainStart: train[0]!.openTime,
      trainEnd: train[train.length - 1]!.openTime,
      testStart: test[0]!.openTime,
      testEnd: test[test.length - 1]!.openTime,
      trainCombos: opt.qualifying,
      trainScore: winner.score,
      trainSummary: winner.summary,
      pickedConfig: winner.config,
      testSummary: testResult.summary,
      testTrades: testResult.trades,
    });
    for (const t of testResult.trades) oosTrades.push(t);
  }

  return {
    windows,
    aggregate: aggregate(windows, oosTrades, interval),
  };
}

function aggregate(
  windows: WalkForwardWindow[],
  oosTrades: BacktestTrade[],
  interval: string,
): WalkForwardAggregate {
  if (windows.length === 0) return emptyAggregate();
  let cur = 100;
  let peak = 100;
  let maxDd = 0;
  for (const t of oosTrades) {
    cur *= 1 + t.pnlPercent / 100;
    if (cur > peak) peak = cur;
    const dd = ((peak - cur) / peak) * 100;
    if (dd > maxDd) maxDd = dd;
  }
  const wins = oosTrades.filter((t) => t.pnlPercent > 0).length;
  const returns = oosTrades.map((t) => t.pnlPercent);
  const mean = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance =
    returns.length > 1
      ? returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1)
      : 0;
  const stddev = Math.sqrt(variance);
  const avgBars = oosTrades.length > 0 ? oosTrades.reduce((a, t) => a + t.bars, 0) / oosTrades.length : 0;
  const barsPerYear = BARS_PER_YEAR[interval] ?? 365;
  const tradesPerYear = avgBars > 0 ? barsPerYear / avgBars : 0;
  const oosSharpe = stddev > 0 ? (mean / stddev) * Math.sqrt(tradesPerYear) : 0;
  const meanTrainSharpe =
    windows.reduce((a, w) => a + w.trainSummary.sharpe, 0) / windows.length;
  return {
    windows: windows.length,
    oosReturnPct: cur - 100,
    oosTrades: oosTrades.length,
    oosWinRate: oosTrades.length > 0 ? wins / oosTrades.length : 0,
    oosMaxDrawdownPct: maxDd,
    oosSharpe,
    meanTrainSharpe,
    robustness: meanTrainSharpe !== 0 ? oosSharpe / meanTrainSharpe : 0,
  };
}

function emptyAggregate(): WalkForwardAggregate {
  return {
    windows: 0,
    oosReturnPct: 0,
    oosTrades: 0,
    oosWinRate: 0,
    oosMaxDrawdownPct: 0,
    oosSharpe: 0,
    meanTrainSharpe: 0,
    robustness: 0,
  };
}
