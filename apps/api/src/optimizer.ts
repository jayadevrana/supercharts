import type { Candle, MaCrossAlertConfig } from '@supercharts/types';
import { runMaCrossBacktest, type BacktestRealismOptions, type BacktestSummary } from './backtester';

/**
 * Param optimizer.
 *
 * Builds a grid of (fast MA length, slow MA length) pairs (and RSI thresholds when
 * `rsiFilter` is set on the base config). For each combo, runs the existing
 * `runMaCrossBacktest` against the same candle window (REAL backtests on REAL candles).
 *
 * Two ranking modes share one grid sweep:
 *
 *   1. LEGACY (req.objective undefined) — top-N by composite `score = Sharpe − 0.02 × maxDD`.
 *      Byte-for-byte unchanged so walk-forward.ts and the original modal keep working.
 *
 *   2. PEAK PERFORMANCE (req.objective set) — the trader picks an objective
 *      ('profit' | 'accuracy' | 'balanced') and an accuracy floor (minWinRate). We collect the
 *      FULL qualifying pool, apply HARD robustness guards (so a high-return / low-win-rate fluke
 *      is removed BEFORE ranking, never just down-ranked), rank by the objective, and return the
 *      top-N enriched with metrics + a cheap neighbour-robustness flag. No fabricated numbers —
 *      every figure comes from the real per-combo backtest; $ is derived client-side from %.
 */

const DEFAULT_FAST_LENGTHS = [5, 7, 9, 12, 15, 20];
const DEFAULT_SLOW_LENGTHS = [20, 30, 50, 100, 200];
const DEFAULT_RSI_BUY_BELOW = [25, 30, 35, 40];
const DEFAULT_RSI_SELL_ABOVE = [60, 65, 70, 75];

/** Cap profit-factor for ranking/normalisation math (raw can be Infinity when there are no losers). */
export const PF_CAP = 5;

export type OptimizeObjective = 'profit' | 'accuracy' | 'balanced';

export interface OptimizeRequest {
  topN?: number;
  minTrades?: number;
  /** Drawdown penalty multiplier in the LEGACY composite score (default 0.02). */
  ddPenalty?: number;
  /** Optional explicit sweep grid; defaults applied when missing. */
  fastLengths?: number[];
  slowLengths?: number[];
  rsiBuyBelow?: number[];
  rsiSellAbove?: number[];

  /* ── Peak-performance mode (opt-in by presence of `objective`) ── */
  objective?: OptimizeObjective;
  /** Accuracy floor 0..1 — drop combos whose win rate is below this. */
  minWinRate?: number;
  /** Min gross profit factor (default 1.0 for profit/balanced). */
  minProfitFactor?: number;
  /** Max acceptable drawdown % (default 60 when an objective is set). */
  maxDdPct?: number;
  /** Require positive per-trade expectancy (default true for profit/balanced). */
  requirePositiveExpectancy?: boolean;
  /** Exclude zero-loss (Infinity-PF) combos — almost always overfit/too-few-trades (default true). */
  requireLosingTrade?: boolean;
  /** Optional "balanced" weight overrides. */
  weights?: { sharpe?: number; expectancy?: number; profitFactor?: number; winRate?: number; ddPenalty?: number };

  /* ── Realism pass-through (forwarded verbatim to every per-combo backtest) ──
     All OFF by default. These ONLY change the per-combo backtest results the sweep
     ranks over — ranking logic, filters and comparators are untouched. */
  /** Commission per side, % of notional. */
  commissionPct?: number;
  /** Slippage %, applied against the trade on entry + exit fills. */
  slippagePct?: number;
  /** Stop loss % (intrabar exit). */
  stopLossPct?: number;
  /** Take profit % (intrabar exit; SL assumed first when both hit in one bar). */
  takeProfitPct?: number;
}

export interface ComboMetrics {
  /** Per-trade expectancy in % = winRate·avgWin + (1−winRate)·avgLoss (avgLoss is already negative). */
  expectancyPct: number;
  /** min(profitFactor, PF_CAP); raw summary.profitFactor (may be Infinity) is preserved untouched. */
  profitFactorCapped: number;
  /** Risk-adjusted composite (0..~1), computed for ALL objectives for transparency. */
  qualityScore: number;
  /** 1-based position under the active objective. */
  rank: number;
  robustness: {
    neighboursChecked: number;
    neighbourPassFraction: number;
    /** Most-severe first; the UI shows flags[0] as a chip. */
    flags: string[];
    tone: 'green' | 'amber' | 'red';
  };
}

export interface OptimizerCombo {
  config: MaCrossAlertConfig;
  summary: BacktestSummary;
  /** LEGACY composite (sharpe − ddPenalty·maxDD). Kept for back-compat + transparency. */
  score: number;
  /** Present only in peak-performance mode. */
  metrics?: ComboMetrics;
}

export interface OptimizeResult {
  combos: OptimizerCombo[];
  /** Total grid size before filtering. */
  evaluated: number;
  /** How many combos had at least `minTrades`. */
  qualifying: number;
  /* ── Peak-performance extras (present only when an objective was applied) ── */
  objective?: OptimizeObjective | 'legacy';
  appliedMinTrades?: number;
  filtered?: {
    belowMinTrades: number;
    belowWinRate: number;
    nonPositiveExpectancy: number;
    exceededMaxDd: number;
    degeneratePf: number;
    zeroLoss: number;
  };
  /** When the win-rate floor shortens/empties the list, `bestWinRate` lets the UI suggest a value. */
  floor?: { minWinRate?: number; passed: number; bestWinRate: number };
  note?: string;
  /** Present ONLY when `combos` is empty: the closest candidates ranked by the same
   *  objective, every one flagged 'below quality bar' — so the pass table never
   *  dead-ends, without pretending a failing setting is a winner. */
  fallbackCombos?: OptimizerCombo[];
}

/* ─── Pure metric helpers (unit-tested directly) ─── */

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

export function expectancyPct(s: BacktestSummary): number {
  // avgLossPct is already negative (backtester stores -grossLoss/losses).
  return s.winRate * s.avgWinPct + (1 - s.winRate) * s.avgLossPct;
}

export function profitFactorCapped(s: BacktestSummary): number {
  return Number.isFinite(s.profitFactor) ? Math.min(s.profitFactor, PF_CAP) : PF_CAP;
}

/**
 * Risk-adjusted "balanced" quality in [0, ~1]. Absolute-constant normalisers (NOT min-max over the
 * survivor set) so it is deterministic, reproducible, and not gameable by a single outlier. A
 * deep-DD / low-PF / low-win-rate / thin-sample fluke collapses here even with a huge raw return.
 */
export function qualityScore(s: BacktestSummary, minTrades: number, w?: OptimizeRequest['weights']): number {
  const exp = expectancyPct(s);
  const pfc = profitFactorCapped(s);
  const nSharpe = clamp01(s.sharpe / 3);
  const nExpect = clamp01(exp / 2);
  const nPF = clamp01((pfc - 1) / (PF_CAP - 1));
  const nWin = clamp01((s.winRate - 0.35) / (0.65 - 0.35));
  const ddPen = clamp01(s.maxDrawdownPct / 50);
  const denom = 30 - minTrades;
  const sampleConf = denom > 0 ? clamp01((s.trades - minTrades) / denom) : 1;
  const wS = w?.sharpe ?? 0.3;
  const wE = w?.expectancy ?? 0.25;
  const wP = w?.profitFactor ?? 0.2;
  const wW = w?.winRate ?? 0.15;
  const wD = w?.ddPenalty ?? 0.25;
  const raw = wS * nSharpe + wE * nExpect + wP * nPF + wW * nWin - wD * ddPen;
  return Math.max(0, raw) * (0.5 + 0.5 * sampleConf);
}

/** Stable grid key for a combo (and the deterministic tiebreak source). */
function comboKey(c: { config: MaCrossAlertConfig }): { fast: number; slow: number; buy: number; sell: number; key: string } {
  const fast = c.config.ma.length;
  const slow = c.config.crossWith?.length ?? 0;
  const buy = c.config.rsiFilter?.buyBelow ?? 0;
  const sell = c.config.rsiFilter?.sellAbove ?? 0;
  return { fast, slow, buy, sell, key: `${fast}|${slow}|${buy}|${sell}` };
}

/** Lower fast, then slow, then buy, then sell — deterministic final tiebreak so runs are reproducible. */
function cfgCompare(a: OptimizerCombo, b: OptimizerCombo): number {
  const ka = comboKey(a);
  const kb = comboKey(b);
  return ka.fast - kb.fast || ka.slow - kb.slow || ka.buy - kb.buy || ka.sell - kb.sell;
}

export function robustnessFlags(s: BacktestSummary, neighboursChecked: number, neighbourPassFraction: number): { flags: string[]; tone: 'green' | 'amber' | 'red' } {
  const red: string[] = [];
  const amber: string[] = [];
  if (s.losses === 0) red.push('no losing trades');
  if (neighboursChecked > 0 && neighbourPassFraction < 0.5) red.push('lone spike');
  if (s.maxDrawdownPct > 50) red.push('deep DD');
  else if (s.maxDrawdownPct > 35) amber.push('deep DD');
  if (s.trades < 15) amber.push('few trades');
  if (Number.isFinite(s.profitFactor) && s.profitFactor < 1.3) amber.push('low PF');
  if (red.length) return { flags: [...red, ...amber], tone: 'red' };
  if (amber.length) return { flags: amber, tone: 'amber' };
  if (neighboursChecked > 0 && neighbourPassFraction >= 0.75) return { flags: ['robust'], tone: 'green' };
  return { flags: [], tone: 'green' };
}

/**
 * Pure peak-performance ranking: filter by hard guards (counting each drop), enrich survivors with
 * metrics, rank by the objective with deterministic tiebreaks, slice to topN. `pool` is every
 * evaluated combo (the neighbour map for robustness is built from it). No I/O, no backtests here —
 * unit-tested with synthetic summaries.
 */
export function rankPeak(pool: OptimizerCombo[], req: OptimizeRequest & { objective: OptimizeObjective }): OptimizeResult {
  const objective = req.objective;
  const topN = req.topN ?? 10;
  const minTrades = req.minTrades ?? 10;
  const minWinRate = req.minWinRate;
  const minPF = req.minProfitFactor ?? 1.0;
  const maxDd = req.maxDdPct ?? 60;
  const requirePosExp = req.requirePositiveExpectancy ?? (objective !== 'accuracy');
  const requireLoser = req.requireLosingTrade ?? true;
  const enforcePF = objective !== 'accuracy';

  const filtered = { belowMinTrades: 0, belowWinRate: 0, nonPositiveExpectancy: 0, exceededMaxDd: 0, degeneratePf: 0, zeroLoss: 0 };

  // Neighbour map (robustness): grid key → totalReturnPct, over the whole evaluated pool.
  const retByKey = new Map<string, number>();
  const uniqFast = new Set<number>();
  const uniqSlow = new Set<number>();
  for (const c of pool) {
    const k = comboKey(c);
    retByKey.set(k.key, c.summary.totalReturnPct);
    uniqFast.add(k.fast);
    uniqSlow.add(k.slow);
  }
  const fastArr = [...uniqFast].sort((a, b) => a - b);
  const slowArr = [...uniqSlow].sort((a, b) => a - b);
  const neighbourStats = (c: OptimizerCombo): { checked: number; pass: number } => {
    const k = comboKey(c);
    const fi = fastArr.indexOf(k.fast);
    const si = slowArr.indexOf(k.slow);
    const cand: string[] = [];
    for (const nf of [fastArr[fi - 1], fastArr[fi + 1]]) if (nf != null) cand.push(`${nf}|${k.slow}|${k.buy}|${k.sell}`);
    for (const ns of [slowArr[si - 1], slowArr[si + 1]]) if (ns != null) cand.push(`${k.fast}|${ns}|${k.buy}|${k.sell}`);
    let checked = 0;
    let pass = 0;
    for (const key of cand) {
      const ret = retByKey.get(key);
      if (ret == null) continue;
      checked += 1;
      if (ret > 0) pass += 1;
    }
    return { checked, pass };
  };

  // Hard guards — count every drop. Order matters only for the counter attribution.
  const survivors: OptimizerCombo[] = [];
  let bestWinRateSeen = 0;
  for (const c of pool) {
    const s = c.summary;
    if (s.trades < minTrades) { filtered.belowMinTrades += 1; continue; }
    bestWinRateSeen = Math.max(bestWinRateSeen, s.winRate);
    if (minWinRate != null && s.winRate < minWinRate) { filtered.belowWinRate += 1; continue; }
    if (requireLoser && s.losses === 0) { filtered.zeroLoss += 1; continue; }
    if (enforcePF && Number.isFinite(s.profitFactor) && s.profitFactor < minPF) { filtered.degeneratePf += 1; continue; }
    if (requirePosExp && expectancyPct(s) <= 0) { filtered.nonPositiveExpectancy += 1; continue; }
    if (s.maxDrawdownPct > maxDd) { filtered.exceededMaxDd += 1; continue; }
    survivors.push(c);
  }

  // Enrich a combo with metrics; `belowBar` prepends the honest fallback flag.
  const enrich = (c: OptimizerCombo, belowBar = false): OptimizerCombo => {
    const nb = neighbourStats(c);
    const passFrac = nb.checked > 0 ? nb.pass / nb.checked : 0;
    const rob = robustnessFlags(c.summary, nb.checked, passFrac);
    const metrics: ComboMetrics = {
      expectancyPct: expectancyPct(c.summary),
      profitFactorCapped: profitFactorCapped(c.summary),
      qualityScore: qualityScore(c.summary, minTrades, req.weights),
      rank: 0,
      robustness: {
        neighboursChecked: nb.checked,
        neighbourPassFraction: passFrac,
        flags: belowBar ? ['below quality bar', ...rob.flags] : rob.flags,
        tone: belowBar ? 'red' : rob.tone,
      },
    };
    return { ...c, metrics };
  };
  const enriched = survivors.map((c) => enrich(c));

  // Objective comparator.
  const cmp = (a: OptimizerCombo, b: OptimizerCombo): number => {
    const sa = a.summary;
    const sb = b.summary;
    const ma = a.metrics!;
    const mb = b.metrics!;
    if (objective === 'profit') {
      return (
        sb.totalReturnPct - sa.totalReturnPct ||
        sb.sharpe - sa.sharpe ||
        sa.maxDrawdownPct - sb.maxDrawdownPct ||
        mb.profitFactorCapped - ma.profitFactorCapped ||
        sb.trades - sa.trades ||
        sb.winRate - sa.winRate ||
        cfgCompare(a, b)
      );
    }
    if (objective === 'accuracy') {
      return (
        sb.winRate - sa.winRate ||
        mb.expectancyPct - ma.expectancyPct ||
        sb.trades - sa.trades ||
        mb.profitFactorCapped - ma.profitFactorCapped ||
        sb.totalReturnPct - sa.totalReturnPct ||
        sa.maxDrawdownPct - sb.maxDrawdownPct ||
        cfgCompare(a, b)
      );
    }
    // balanced
    return (
      mb.qualityScore - ma.qualityScore ||
      sb.sharpe - sa.sharpe ||
      sa.maxDrawdownPct - sb.maxDrawdownPct ||
      sb.trades - sa.trades ||
      cfgCompare(a, b)
    );
  };

  enriched.sort(cmp);
  enriched.forEach((c, i) => {
    c.metrics!.rank = i + 1;
  });

  const top = enriched.slice(0, topN);
  const passed = enriched.length;

  // Honest empty-result note: name the filter(s) that ACTUALLY removed combos, largest
  // first — never blame the win-rate floor when profitability guards did the killing
  // (the old message could claim "no setting met win rate ≥ 10%" while reporting a best
  // win rate of 40%, because it always attributed an empty result to the floor).
  let note: string | undefined;
  let fallbackCombos: OptimizerCombo[] | undefined;
  if (passed === 0) {
    const unprofitable = filtered.degeneratePf + filtered.nonPositiveExpectancy;
    const reasons: Array<[number, string]> = [
      [
        filtered.belowWinRate,
        minWinRate != null
          ? `${filtered.belowWinRate} below your ${(minWinRate * 100).toFixed(0)}% win rate floor (best seen ${(bestWinRateSeen * 100).toFixed(0)}%)`
          : '',
      ],
      [unprofitable, `${unprofitable} unprofitable (PF < ${minPF} or negative expectancy) — this setup may simply not work on this data/timeframe`],
      [filtered.belowMinTrades, `${filtered.belowMinTrades} with fewer than ${minTrades} trades`],
      [filtered.exceededMaxDd, `${filtered.exceededMaxDd} beyond ${maxDd}% drawdown`],
      [filtered.zeroLoss, `${filtered.zeroLoss} with zero losing trades (suspicious)`],
    ];
    const named = reasons.filter(([n, t]) => n > 0 && t).sort((a, b) => b[0] - a[0]);
    note =
      named.length > 0
        ? `No setting met the quality bar: ${named.map(([, t]) => t).join('; ')}.`
        : `No setting passed the robustness guards (trades ≥ ${minTrades}, PF ≥ ${minPF}, DD ≤ ${maxDd}%).`;

    // Never dead-end (the MetaTrader pass table always shows results): rank the closest
    // candidates by the SAME objective and return them clearly flagged 'below quality
    // bar' — shown as candidates, never celebrated as winners.
    const candidates = pool.filter((c) => c.summary.trades >= minTrades);
    const fb = (candidates.length > 0 ? candidates : pool.slice()).map((c) => enrich(c, true));
    fb.sort(cmp);
    fb.forEach((c, i) => {
      c.metrics!.rank = i + 1;
    });
    fallbackCombos = fb.slice(0, topN);
  } else if (passed < topN) {
    note = `Only ${passed} setting${passed === 1 ? '' : 's'} met your filters.`;
  }

  return {
    combos: top,
    evaluated: pool.length,
    qualifying: passed,
    objective,
    appliedMinTrades: minTrades,
    filtered,
    floor: { minWinRate, passed, bestWinRate: bestWinRateSeen },
    note,
    ...(fallbackCombos ? { fallbackCombos } : {}),
  };
}

export function runOptimizer(
  candles: ReadonlyArray<Candle>,
  base: MaCrossAlertConfig,
  interval: string,
  req: OptimizeRequest = {},
): OptimizeResult {
  const objective = req.objective;
  const ddPenalty = req.ddPenalty ?? 0.02;
  const fastLengths = req.fastLengths ?? DEFAULT_FAST_LENGTHS;
  const slowLengths = req.slowLengths ?? DEFAULT_SLOW_LENGTHS;
  const hasRsi = !!base.rsiFilter;
  const rsiBuy = hasRsi ? (req.rsiBuyBelow ?? DEFAULT_RSI_BUY_BELOW) : [base.rsiFilter?.buyBelow ?? 0];
  const rsiSell = hasRsi ? (req.rsiSellAbove ?? DEFAULT_RSI_SELL_ABOVE) : [base.rsiFilter?.sellAbove ?? 0];

  // Realism pass-through — forwarded to every per-combo backtest, never ranked on.
  // `undefined` (the default) keeps each backtest on the byte-identical legacy path.
  const realism: BacktestRealismOptions | undefined =
    req.commissionPct != null || req.slippagePct != null || req.stopLossPct != null || req.takeProfitPct != null
      ? {
          commissionPct: req.commissionPct,
          slippagePct: req.slippagePct,
          stopLossPct: req.stopLossPct,
          takeProfitPct: req.takeProfitPct,
        }
      : undefined;

  // Single grid sweep → every evaluated combo with its real backtest summary + legacy composite.
  const all: OptimizerCombo[] = [];
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
          const result = runMaCrossBacktest(candles, cfg, interval, realism);
          const score = result.summary.sharpe - ddPenalty * result.summary.maxDrawdownPct;
          all.push({ config: cfg, summary: result.summary, score });
        }
      }
    }
  }

  if (!objective) {
    // LEGACY path — byte-for-byte as before (walk-forward + original modal depend on this).
    const topN = req.topN ?? 12;
    const minTrades = req.minTrades ?? 5;
    const combos = all.filter((c) => c.summary.trades >= minTrades).sort((a, b) => b.score - a.score);
    return { combos: combos.slice(0, topN), evaluated, qualifying: combos.length };
  }

  // PEAK PERFORMANCE path.
  return { ...rankPeak(all, { ...req, objective }), evaluated };
}
