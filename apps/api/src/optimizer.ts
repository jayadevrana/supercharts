import type { Candle, MaCrossAlertConfig } from '@supercharts/types';
import { runMaCrossBacktest, type BacktestSummary } from './backtester';

/**
 * Param optimizer v1.
 *
 * Builds a grid of (fast MA length, slow MA length) pairs (and RSI thresholds when
 * `rsiFilter` is set on the base config). For each combo, runs the existing
 * `runMaCrossBacktest` against the same candle window. Returns top-N ranked by a
 * composite score:
 *
 *   score = Sharpe − 0.02 × maxDrawdownPct
 *
 * The drawdown penalty keeps high-Sharpe-but-deep-DD configs from looking great on
 * paper. The constant is tunable per user later; 0.02 means a 50%-DD strategy needs
 * 1.0 extra Sharpe to win out over a 0%-DD one. Trade count below `minTrades`
 * disqualifies the combo (too few samples).
 *
 * v1 LIMITATIONS:
 *   - Grid only — no genetic / Bayesian search yet.
 *   - Single-thread; for 1000-bar windows + ~80 combos this is ~tens of ms total.
 *   - No walk-forward (Phase 1 #4 lands that).
 */

const DEFAULT_FAST_LENGTHS = [5, 7, 9, 12, 15, 20];
const DEFAULT_SLOW_LENGTHS = [20, 30, 50, 100, 200];
const DEFAULT_RSI_BUY_BELOW = [25, 30, 35, 40];
const DEFAULT_RSI_SELL_ABOVE = [60, 65, 70, 75];

export interface OptimizeRequest {
  topN?: number;
  minTrades?: number;
  /** Drawdown penalty multiplier in the composite score (default 0.02). */
  ddPenalty?: number;
  /** Optional explicit sweep grid; defaults applied when missing. */
  fastLengths?: number[];
  slowLengths?: number[];
  rsiBuyBelow?: number[];
  rsiSellAbove?: number[];
}

export interface OptimizerCombo {
  config: MaCrossAlertConfig;
  summary: BacktestSummary;
  score: number;
}

export interface OptimizeResult {
  combos: OptimizerCombo[];
  /** Total grid size before filtering. */
  evaluated: number;
  /** How many combos had at least `minTrades`. */
  qualifying: number;
}

export function runOptimizer(
  candles: ReadonlyArray<Candle>,
  base: MaCrossAlertConfig,
  interval: string,
  req: OptimizeRequest = {},
): OptimizeResult {
  const topN = req.topN ?? 12;
  const minTrades = req.minTrades ?? 5;
  const ddPenalty = req.ddPenalty ?? 0.02;
  const fastLengths = req.fastLengths ?? DEFAULT_FAST_LENGTHS;
  const slowLengths = req.slowLengths ?? DEFAULT_SLOW_LENGTHS;
  const hasRsi = !!base.rsiFilter;
  const rsiBuy = hasRsi ? (req.rsiBuyBelow ?? DEFAULT_RSI_BUY_BELOW) : [base.rsiFilter?.buyBelow ?? 0];
  const rsiSell = hasRsi ? (req.rsiSellAbove ?? DEFAULT_RSI_SELL_ABOVE) : [base.rsiFilter?.sellAbove ?? 0];

  const combos: OptimizerCombo[] = [];
  let evaluated = 0;

  for (const fast of fastLengths) {
    for (const slow of slowLengths) {
      if (slow <= fast) continue; // skip nonsense pairs
      for (const buy of rsiBuy) {
        for (const sell of rsiSell) {
          evaluated += 1;
          const cfg: MaCrossAlertConfig = {
            ...base,
            ma: { ...base.ma, length: fast },
            crossWith: { type: base.crossWith?.type ?? base.ma.type, length: slow },
            rsiFilter: hasRsi
              ? { length: base.rsiFilter!.length, buyBelow: buy, sellAbove: sell }
              : undefined,
          };
          const result = runMaCrossBacktest(candles, cfg, interval);
          if (result.summary.trades < minTrades) continue;
          const score = result.summary.sharpe - ddPenalty * result.summary.maxDrawdownPct;
          combos.push({ config: cfg, summary: result.summary, score });
        }
      }
    }
  }

  combos.sort((a, b) => b.score - a.score);
  return {
    combos: combos.slice(0, topN),
    evaluated,
    qualifying: combos.length,
  };
}
