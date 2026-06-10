import type { Candle } from '@supercharts/types';
import { runScript } from '@supercharts/script-lang';
import {
  runSignalBacktest,
  type BacktestRealismOptions,
  type BacktestSummary,
} from './backtester';
import {
  expectancyPct,
  profitFactorCapped,
  qualityScore,
  robustnessFlags,
  type ComboMetrics,
  type OptimizeObjective,
} from './optimizer';

/**
 * PulseScript input optimizer — the MetaTrader "optimize my EA's inputs" feature for
 * CODED strategies. The user picks which of their script's `input.num` parameters to
 * sweep (from/step/to each); every combination re-runs the script over the SAME real
 * candles, backtests its mark buy/sell output via runSignalBacktest, and the pool is
 * ranked with the same hard filters / metrics / objectives as the MA-cross optimizer.
 *
 * Script runs cost ~25ms per 1000 bars, so the sweep is TIME-BUDGETED: combos are
 * visited in a deterministic shuffled order (fixed-seed LCG, so truncation samples the
 * whole space instead of one corner) and the sweep stops honestly at the budget,
 * reporting evaluated/planned. Same inputs ⇒ same order ⇒ same results, every run.
 */

export interface ScriptSweepRange {
  from: number;
  step: number;
  to: number;
}

export interface ScriptOptimizeRequest {
  objective?: OptimizeObjective;
  /** Accuracy floor 0..1. */
  minWinRate?: number;
  topN?: number;
  minTrades?: number;
  maxDdPct?: number;
  /** Wall-clock sweep budget; the sweep stops honestly when exceeded. */
  timeBudgetMs?: number;
  realism?: BacktestRealismOptions;
}

export interface ScriptOptimizeCombo {
  /** The swept input values for this pass (base inputs are merged at run time). */
  inputs: Record<string, number>;
  summary: BacktestSummary;
  metrics?: ComboMetrics;
}

export interface ScriptOptimizeResult {
  combos: ScriptOptimizeCombo[];
  /** Grid size implied by the ranges. */
  planned: number;
  /** How many combos actually ran (≤ planned when the time budget hits). */
  evaluated: number;
  qualifying: number;
  truncated: boolean;
  objective: OptimizeObjective;
  appliedMinTrades: number;
  scriptErrors: number;
  filtered: {
    belowMinTrades: number;
    belowWinRate: number;
    nonPositiveExpectancy: number;
    exceededMaxDd: number;
    degeneratePf: number;
    zeroLoss: number;
  };
  floor?: { minWinRate?: number; passed: number; bestWinRate: number };
  note?: string;
  fallbackCombos?: ScriptOptimizeCombo[];
}

export const SCRIPT_SWEEP_MAX_COMBOS = 1000;
const MAX_SWEPT_INPUTS = 4;
const PER_RUN_TIMEOUT_MS = 300;

/** Expand a from/step/to range into explicit values (caps defend the grid size). */
function expandRange(r: ScriptSweepRange): number[] {
  const from = Number(r.from);
  const to = Number(r.to);
  const step = Number(r.step);
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(step) || step <= 0 || to < from) return [];
  const out: number[] = [];
  // Float-safe stepping (e.g. 0.5 steps): round to the step's precision.
  const decimals = Math.min(6, (String(step).split('.')[1] ?? '').length);
  for (let v = from; v <= to + step / 1e6 && out.length <= 200; v += step) {
    out.push(Number(v.toFixed(decimals)));
  }
  return out;
}

/** Deterministic order spread across the grid — fixed-seed LCG permutation. */
function deterministicOrder(n: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  let seed = 0x9e3779b9 ^ n;
  const rand = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  return idx;
}

export function optimizeScript(
  candles: ReadonlyArray<Candle>,
  source: string,
  baseInputs: Record<string, number | boolean | string>,
  ranges: Record<string, ScriptSweepRange>,
  interval: string,
  req: ScriptOptimizeRequest = {},
): ScriptOptimizeResult {
  const objective: OptimizeObjective = req.objective ?? 'balanced';
  const topN = Math.min(50, Math.max(1, Math.round(req.topN ?? 20)));
  const minTrades = Math.max(1, Math.round(req.minTrades ?? 10));
  const maxDd = req.maxDdPct ?? 60;
  const minWinRate = typeof req.minWinRate === 'number' && req.minWinRate > 0 ? req.minWinRate : undefined;
  const budget = Math.min(20_000, Math.max(1_000, req.timeBudgetMs ?? 10_000));
  const enforcePF = objective !== 'accuracy';
  const requirePosExp = objective !== 'accuracy';

  const sweptIds = Object.keys(ranges).slice(0, MAX_SWEPT_INPUTS);
  const axes = sweptIds.map((id) => ({ id, values: expandRange(ranges[id]!) }));
  if (axes.some((a) => a.values.length === 0) || axes.length === 0) {
    throw new RangeError('Each swept input needs a valid from/step/to range (step > 0, to ≥ from).');
  }
  const planned = axes.reduce((acc, a) => acc * a.values.length, 1);
  if (planned > SCRIPT_SWEEP_MAX_COMBOS) {
    throw new RangeError(`${planned} combinations exceeds the ${SCRIPT_SWEEP_MAX_COMBOS} cap — raise the step sizes.`);
  }

  // Enumerate the full cartesian grid.
  const grid: Record<string, number>[] = [];
  const build = (i: number, acc: Record<string, number>): void => {
    if (i === axes.length) {
      grid.push({ ...acc });
      return;
    }
    for (const v of axes[i]!.values) {
      acc[axes[i]!.id] = v;
      build(i + 1, acc);
    }
  };
  build(0, {});

  // Time-budgeted sweep in deterministic shuffled order.
  const started = Date.now();
  const pool: ScriptOptimizeCombo[] = [];
  let scriptErrors = 0;
  let truncated = false;
  for (const gi of deterministicOrder(grid.length)) {
    if (Date.now() - started > budget) {
      truncated = true;
      break;
    }
    const combo = grid[gi]!;
    try {
      const run = runScript(source, candles, {
        inputs: { ...baseInputs, ...combo },
        timeoutMs: PER_RUN_TIMEOUT_MS,
      });
      const signals = run.marks
        .filter((m): m is typeof m & { kind: 'buy' | 'sell' } => m.kind === 'buy' || m.kind === 'sell')
        .map((m) => ({ index: m.bar, side: m.kind }));
      const result = runSignalBacktest(candles, signals, interval, req.realism);
      pool.push({ inputs: combo, summary: result.summary });
    } catch {
      scriptErrors += 1; // a combo that crashes/times out is skipped, never faked
    }
  }

  // ── Ranking: same hard-filter semantics as the MA-cross optimizer ──
  const filtered = {
    belowMinTrades: 0,
    belowWinRate: 0,
    nonPositiveExpectancy: 0,
    exceededMaxDd: 0,
    degeneratePf: 0,
    zeroLoss: 0,
  };
  const survivors: ScriptOptimizeCombo[] = [];
  let bestWinRateSeen = 0;
  for (const c of pool) {
    const s = c.summary;
    if (s.trades < minTrades) { filtered.belowMinTrades += 1; continue; }
    bestWinRateSeen = Math.max(bestWinRateSeen, s.winRate);
    if (minWinRate != null && s.winRate < minWinRate) { filtered.belowWinRate += 1; continue; }
    if (s.losses === 0) { filtered.zeroLoss += 1; continue; }
    if (enforcePF && Number.isFinite(s.profitFactor) && s.profitFactor < 1) { filtered.degeneratePf += 1; continue; }
    if (requirePosExp && expectancyPct(s) <= 0) { filtered.nonPositiveExpectancy += 1; continue; }
    if (s.maxDrawdownPct > maxDd) { filtered.exceededMaxDd += 1; continue; }
    survivors.push(c);
  }

  const comboKey = (c: ScriptOptimizeCombo): string => sweptIds.map((id) => c.inputs[id]).join('|');
  const byKey = new Map(pool.map((c) => [comboKey(c), c.summary.totalReturnPct]));

  // Robustness neighbours: ±1 step along EACH swept axis (generic N-dimensional).
  const neighbourStats = (c: ScriptOptimizeCombo): { checked: number; pass: number } => {
    let checked = 0;
    let pass = 0;
    for (const a of axes) {
      const i = a.values.indexOf(c.inputs[a.id]!);
      for (const ni of [i - 1, i + 1]) {
        const nv = a.values[ni];
        if (nv == null) continue;
        const key = sweptIds.map((id) => (id === a.id ? nv : c.inputs[id])).join('|');
        const ret = byKey.get(key);
        if (ret == null) continue; // may be unevaluated under a truncated sweep
        checked += 1;
        if (ret > 0) pass += 1;
      }
    }
    return { checked, pass };
  };

  const enrich = (c: ScriptOptimizeCombo, belowBar = false): ScriptOptimizeCombo => {
    const nb = neighbourStats(c);
    const passFrac = nb.checked > 0 ? nb.pass / nb.checked : 0;
    const rob = robustnessFlags(c.summary, nb.checked, passFrac);
    const metrics: ComboMetrics = {
      expectancyPct: expectancyPct(c.summary),
      profitFactorCapped: profitFactorCapped(c.summary),
      qualityScore: qualityScore(c.summary, minTrades),
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

  const keyCompare = (a: ScriptOptimizeCombo, b: ScriptOptimizeCombo): number =>
    comboKey(a) < comboKey(b) ? -1 : comboKey(a) > comboKey(b) ? 1 : 0;
  const cmp = (a: ScriptOptimizeCombo, b: ScriptOptimizeCombo): number => {
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
        keyCompare(a, b)
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
        keyCompare(a, b)
      );
    }
    return (
      mb.qualityScore - ma.qualityScore ||
      sb.sharpe - sa.sharpe ||
      sa.maxDrawdownPct - sb.maxDrawdownPct ||
      sb.trades - sa.trades ||
      keyCompare(a, b)
    );
  };

  const enriched = survivors.map((c) => enrich(c));
  enriched.sort(cmp);
  enriched.forEach((c, i) => {
    c.metrics!.rank = i + 1;
  });
  const passed = enriched.length;

  let note: string | undefined;
  let fallbackCombos: ScriptOptimizeCombo[] | undefined;
  if (passed === 0) {
    const unprofitable = filtered.degeneratePf + filtered.nonPositiveExpectancy;
    const reasons: Array<[number, string]> = [
      [
        filtered.belowWinRate,
        minWinRate != null
          ? `${filtered.belowWinRate} below your ${(minWinRate * 100).toFixed(0)}% win rate floor (best seen ${(bestWinRateSeen * 100).toFixed(0)}%)`
          : '',
      ],
      [unprofitable, `${unprofitable} unprofitable (PF < 1 or negative expectancy) — these settings may simply not work on this data/timeframe`],
      [filtered.belowMinTrades, `${filtered.belowMinTrades} with fewer than ${minTrades} trades`],
      [filtered.exceededMaxDd, `${filtered.exceededMaxDd} beyond ${maxDd}% drawdown`],
      [filtered.zeroLoss, `${filtered.zeroLoss} with zero losing trades (suspicious)`],
    ];
    const named = reasons.filter(([n, t]) => n > 0 && t).sort((a, b) => b[0] - a[0]);
    note =
      named.length > 0
        ? `No setting met the quality bar: ${named.map(([, t]) => t).join('; ')}.`
        : pool.length === 0
          ? 'The sweep produced no usable runs — check the script and ranges.'
          : `No setting passed the robustness guards (trades ≥ ${minTrades}, PF ≥ 1, DD ≤ ${maxDd}%).`;
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
  if (truncated) {
    note = `${note ? `${note} ` : ''}Time budget hit: evaluated ${pool.length + scriptErrors} of ${planned} combinations (sampled evenly) — raise the steps for full coverage.`;
  }

  return {
    combos: enriched.slice(0, topN),
    planned,
    evaluated: pool.length,
    qualifying: passed,
    truncated,
    objective,
    appliedMinTrades: minTrades,
    scriptErrors,
    filtered,
    floor: { minWinRate, passed, bestWinRate: bestWinRateSeen },
    note,
    ...(fallbackCombos ? { fallbackCombos } : {}),
  };
}
