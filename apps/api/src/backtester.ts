import type { Candle, MaCrossAlertConfig } from '@supercharts/types';
import { computeMaCross, pickSource, rsi as rsiSeries } from '@supercharts/chart-core/pure';

/**
 * MA-cross alert backtester.
 *
 * v1 trade model — deliberately simple so users can sanity-check live alerts before
 * trusting them with capital:
 *
 *   - On every crossover bar that passes the alert's `rsiFilter` (when set), open a
 *     virtual position at the bar's close. Side matches the cross side.
 *   - Hold until the next OPPOSITE crossover (also gated by rsiFilter), at which point
 *     we close at that bar's close AND flip into the new side.
 *   - At end-of-data, close the still-open position at the last close.
 *   - PnL% per trade = (exit - entry) / entry × 100 for BUY, mirrored for SELL.
 *   - Equity is a multiplicative compound of (1 + pnl%/100) starting at 100.
 *
 * v1 NOT included (intentional): leverage, fractional sizing, cooldowns,
 * multi-position, max-trades-per-day.
 *
 * REALISM options (opt-in, all OFF by default — see `BacktestRealismOptions`): when ANY
 * of commission / slippage / SL / TP is set, the trade walk switches to an extended
 * model. When none is set, the walk is the exact v1 path above, so results stay
 * byte-identical to the legacy backtester (regression-tested).
 */

export type BacktestExitReason = 'cross' | 'stop' | 'target' | 'end';

/**
 * Optional realism layer. Every field defaults to OFF (undefined); non-finite or <= 0
 * values are treated as OFF too, so garbage input can never flip the model silently.
 *
 *   - commissionPct: charged PER SIDE as % of notional → per-trade cost in % of entry
 *     equity is commissionPct × (1 + exit/entry).
 *   - slippagePct:   both fills move AGAINST the trade (buy entry/short exit pay more,
 *     buy exit/short entry receive less). Recorded entry/exit prices ARE the slipped
 *     fills so the trade table stays consistent with the P&L.
 *   - stopLossPct / takeProfitPct: % from the entry fill, checked INTRABAR against the
 *     candle high/low from the bar AFTER entry (entries fill at the close, so the entry
 *     bar itself can't stop out). Conservative assumptions: if one bar's range spans
 *     both levels, the STOP is assumed to fill first; a stop that gaps past its level
 *     fills at the bar's open (worse), while a target always fills at its level (never
 *     better).
 */
export interface BacktestRealismOptions {
  /** Commission per side, % of notional (e.g. 0.05 = 0.05% on entry AND on exit). */
  commissionPct?: number;
  /** Slippage %, applied against the trade on both the entry and exit fill. */
  slippagePct?: number;
  /** Stop loss, % below (buy) / above (sell) the entry fill. Intrabar exit. */
  stopLossPct?: number;
  /** Take profit, % above (buy) / below (sell) the entry fill. Intrabar exit. */
  takeProfitPct?: number;
}

export interface BacktestTrade {
  side: 'buy' | 'sell';
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  /** Holding period in bars. */
  bars: number;
  pnlPercent: number;
  /** RSI at entry — only set when rsiFilter is configured. */
  rsiAtEntry?: number;
  /** Why the trade closed — present ONLY when realism options are active. */
  exitReason?: BacktestExitReason;
}

export interface BacktestEquityPoint {
  time: number;
  equity: number;
  drawdown: number;
}

export interface BacktestSummary {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  /** Final equity (starts at 100). */
  finalEquity: number;
  /** Total return in % (finalEquity - 100). */
  totalReturnPct: number;
  /** Peak-to-trough drawdown in %. */
  maxDrawdownPct: number;
  /** Annualized Sharpe approx (mean(returns) / stddev(returns) × √barsPerYear). */
  sharpe: number;
  /** Sum of winning trade returns / abs(sum of losing trade returns). */
  profitFactor: number;
  /** Mean winning trade return in %. */
  avgWinPct: number;
  /** Mean losing trade return in %. */
  avgLossPct: number;
  /** Mean bars held per trade. */
  avgBars: number;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  equity: BacktestEquityPoint[];
  summary: BacktestSummary;
}

/**
 * `intervalsPerYear` is used to scale Sharpe to an annual figure. Defaults assume
 * 24/7 markets — caller should pass the right value when known (e.g. forex is 24/5).
 */
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

/** Clamp a realism % to a usable range; undefined / non-finite / <= 0 ⇒ OFF. */
function sanitizePct(v: number | undefined, max: number): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return undefined;
  return Math.min(v, max);
}

interface ActiveRealism {
  commissionPct: number; // 0 = no commission
  slippagePct: number; // 0 = no slippage
  stopLossPct?: number;
  takeProfitPct?: number;
}

/** Null unless at least one realism field is genuinely active — the legacy-path gate. */
function normalizeRealism(opts?: BacktestRealismOptions): ActiveRealism | null {
  if (!opts) return null;
  // Commission/slippage above 50%/side and SL/TP at/above 100% are nonsense — clamp so
  // extreme input can't produce negative fill prices or >100% single-trade losses.
  const commissionPct = sanitizePct(opts.commissionPct, 50);
  const slippagePct = sanitizePct(opts.slippagePct, 50);
  const stopLossPct = sanitizePct(opts.stopLossPct, 99);
  const takeProfitPct = sanitizePct(opts.takeProfitPct, 99);
  if (commissionPct == null && slippagePct == null && stopLossPct == null && takeProfitPct == null) {
    return null;
  }
  return { commissionPct: commissionPct ?? 0, slippagePct: slippagePct ?? 0, stopLossPct, takeProfitPct };
}

export function runMaCrossBacktest(
  candles: ReadonlyArray<Candle>,
  config: MaCrossAlertConfig,
  interval: string,
  options?: BacktestRealismOptions,
): BacktestResult {
  if (candles.length < Math.max(config.ma.length, config.crossWith?.length ?? 0) + 5) {
    return emptyResult();
  }

  const { ma, crosses } = computeMaCross(candles, {
    ...config.ma,
    crossWith: config.crossWith,
  });
  void ma; // unused at the trade level — RSI series handled below

  // Pre-compute RSI series once if filter is configured.
  const rsiVals = config.rsiFilter
    ? rsiSeries(candles.map((c) => c.close), config.rsiFilter.length)
    : null;

  // Apply RSI gate to the cross list (skip bars that wouldn't fire live).
  const gated = crosses.filter((c) => {
    if (!config.rsiFilter || !rsiVals) return true;
    const v = rsiVals[c.index];
    if (!Number.isFinite(v!)) return false;
    if (c.side === 'buy') return v! <= config.rsiFilter.buyBelow;
    return v! >= config.rsiFilter.sellAbove;
  });

  // Trade walk. Realism OFF (the default) takes the UNTOUCHED v1 path so legacy
  // results stay byte-identical; realism ON takes the extended walk.
  const realism = normalizeRealism(options);
  const trades: BacktestTrade[] = realism
    ? buildRealismTrades(candles, config.ma.source, gated, rsiVals, realism)
    : buildLegacyTrades(candles, config.ma.source, gated, rsiVals);

  return buildResult(trades, interval);
}

/**
 * Strategy-signal backtester — the PulseScript Strategy Tester core. Takes an arbitrary
 * ordered list of {bar index, side} entry signals (e.g. a script's `mark buy` / `mark sell`
 * output) and runs the EXACT same trade model as the MA-cross backtester: enter at the
 * signal bar's close, exit + flip on the next opposite signal, ignore same-side re-entries,
 * close at end-of-data; optional realism layer (commission / slippage / SL / TP) identical
 * to `runMaCrossBacktest`'s. Fills use the bar CLOSE (marks may carry a label price like
 * the bar low — that's where the label draws, not where an order would fill).
 */
export interface StrategySignal {
  index: number;
  side: 'buy' | 'sell';
}

export function runSignalBacktest(
  candles: ReadonlyArray<Candle>,
  signals: ReadonlyArray<StrategySignal>,
  interval: string,
  options?: BacktestRealismOptions,
): BacktestResult {
  if (candles.length === 0) return emptyResult();
  const gated: GatedCross[] = signals
    .filter((s) => Number.isInteger(s.index) && s.index >= 0 && s.index < candles.length)
    .slice()
    .sort((a, b) => a.index - b.index);
  if (gated.length === 0) return emptyResult();

  const realism = normalizeRealism(options);
  const trades: BacktestTrade[] = realism
    ? buildRealismTrades(candles, 'close', gated, null, realism)
    : buildLegacyTrades(candles, 'close', gated, null);

  return buildResult(trades, interval);
}

/** Equity compounding + summary stats shared by every backtest entry point. */
function buildResult(trades: BacktestTrade[], interval: string): BacktestResult {
  // Compound equity from a base of 100.
  const equity: BacktestEquityPoint[] = [];
  let cur = 100;
  let peak = 100;
  let maxDd = 0;
  for (const t of trades) {
    cur *= 1 + t.pnlPercent / 100;
    if (cur > peak) peak = cur;
    const dd = ((peak - cur) / peak) * 100;
    if (dd > maxDd) maxDd = dd;
    equity.push({ time: t.exitTime, equity: cur, drawdown: dd });
  }

  // Summary stats. Sharpe uses per-trade returns (not per-bar), so we scale by
  // (BARS_PER_YEAR / avgBarsPerTrade) for an annual figure.
  const wins = trades.filter((t) => t.pnlPercent > 0);
  const losses = trades.filter((t) => t.pnlPercent < 0);
  const grossWin = wins.reduce((acc, t) => acc + t.pnlPercent, 0);
  const grossLoss = losses.reduce((acc, t) => acc + Math.abs(t.pnlPercent), 0);
  const returns = trades.map((t) => t.pnlPercent);
  const mean = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance =
    returns.length > 1
      ? returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1)
      : 0;
  const stddev = Math.sqrt(variance);
  const avgBars = trades.length > 0 ? trades.reduce((a, t) => a + t.bars, 0) / trades.length : 0;
  const barsPerYear = BARS_PER_YEAR[interval] ?? 365;
  const tradesPerYear = avgBars > 0 ? barsPerYear / avgBars : 0;
  const sharpe = stddev > 0 ? (mean / stddev) * Math.sqrt(tradesPerYear) : 0;

  return {
    trades,
    equity,
    summary: {
      trades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: trades.length > 0 ? wins.length / trades.length : 0,
      finalEquity: cur,
      totalReturnPct: cur - 100,
      maxDrawdownPct: maxDd,
      sharpe,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
      avgWinPct: wins.length > 0 ? grossWin / wins.length : 0,
      avgLossPct: losses.length > 0 ? -grossLoss / losses.length : 0,
      avgBars,
    },
  };
}

/** The slice of a `computeMaCross` cross point the trade walks need. */
interface GatedCross {
  index: number;
  side: 'buy' | 'sell';
}

/**
 * v1 trade walk — UNCHANGED legacy behavior (extracted verbatim from the original
 * inline loop). Walk gated crosses and pair entries with the next OPPOSITE-side cross
 * as exit. A same-side cross while a position is open is ignored — the position is
 * already capturing that direction.
 */
function buildLegacyTrades(
  candles: ReadonlyArray<Candle>,
  source: MaCrossAlertConfig['ma']['source'],
  gated: ReadonlyArray<GatedCross>,
  rsiVals: Float64Array | null,
): BacktestTrade[] {
  const trades: BacktestTrade[] = [];
  let open: { side: 'buy' | 'sell'; entryIdx: number; entryPrice: number; rsi?: number } | null = null;

  for (const c of gated) {
    const bar = candles[c.index];
    if (!bar) continue;
    if (open && open.side === c.side) continue; // ignore re-entries
    const price = pickSource(bar, source);
    if (open) {
      // Opposite cross — close the prior trade.
      const entry = candles[open.entryIdx]!;
      const pnl =
        open.side === 'buy'
          ? ((price - open.entryPrice) / open.entryPrice) * 100
          : ((open.entryPrice - price) / open.entryPrice) * 100;
      trades.push({
        side: open.side,
        entryTime: entry.openTime,
        entryPrice: open.entryPrice,
        exitTime: bar.openTime,
        exitPrice: price,
        bars: c.index - open.entryIdx,
        pnlPercent: pnl,
        rsiAtEntry: open.rsi,
      });
    }
    // Open a fresh position on this cross (`open` is unconditionally reassigned here).
    open = {
      side: c.side,
      entryIdx: c.index,
      entryPrice: price,
      // rsiVals is non-null only when the caller configured an RSI filter.
      rsi: rsiVals ? rsiVals[c.index] : undefined,
    };
  }

  // Close any still-open position at the last candle to keep stats honest.
  if (open) {
    const last = candles[candles.length - 1]!;
    const lastPrice = pickSource(last, source);
    const entry = candles[open.entryIdx]!;
    const pnl =
      open.side === 'buy'
        ? ((lastPrice - open.entryPrice) / open.entryPrice) * 100
        : ((open.entryPrice - lastPrice) / open.entryPrice) * 100;
    trades.push({
      side: open.side,
      entryTime: entry.openTime,
      entryPrice: open.entryPrice,
      exitTime: last.openTime,
      exitPrice: lastPrice,
      bars: candles.length - 1 - open.entryIdx,
      pnlPercent: pnl,
      rsiAtEntry: open.rsi,
    });
  }
  return trades;
}

/**
 * Realism trade walk. Same signal semantics as v1 (enter on a gated cross, exit on the
 * next opposite cross, same-side re-entries ignored, end-of-data close) PLUS:
 *
 *   - Entry/exit fills move against the trade by `slippagePct` (recorded prices ARE
 *     the fills, so the trade table reconciles with the P&L).
 *   - `commissionPct` per side of notional is deducted from each trade's P&L%:
 *     cost% = commissionPct × (1 + exitFill/entryFill).
 *   - SL/TP levels are % from the entry FILL and are checked intrabar (high/low) on
 *     every bar AFTER the entry bar — conservative ordering: the stop is checked
 *     before the target, so a bar spanning both books a stop-out; a stop that gaps
 *     past its level fills at the bar open (worse); a target fills exactly at level.
 *   - After an SL/TP exit the book is flat, so the NEXT gated cross of either side
 *     opens a fresh position (live alerts would still be firing on those crosses).
 */
function buildRealismTrades(
  candles: ReadonlyArray<Candle>,
  source: MaCrossAlertConfig['ma']['source'],
  gated: ReadonlyArray<GatedCross>,
  rsiVals: Float64Array | null,
  r: ActiveRealism,
): BacktestTrade[] {
  const trades: BacktestTrade[] = [];
  const slip = r.slippagePct / 100;

  type Open = { side: 'buy' | 'sell'; entryIdx: number; entryFill: number; sl?: number; tp?: number; rsi?: number };
  let open: Open | null = null;

  const close = (o: Open, exitIdx: number, rawExit: number, reason: BacktestExitReason): void => {
    // Exit slippage works against the trade: a buy exits (sells) lower, a sell exits (buys back) higher.
    const fill = o.side === 'buy' ? rawExit * (1 - slip) : rawExit * (1 + slip);
    const gross =
      o.side === 'buy'
        ? ((fill - o.entryFill) / o.entryFill) * 100
        : ((o.entryFill - fill) / o.entryFill) * 100;
    const pnl = gross - r.commissionPct * (1 + fill / o.entryFill);
    trades.push({
      side: o.side,
      entryTime: candles[o.entryIdx]!.openTime,
      entryPrice: o.entryFill,
      exitTime: candles[exitIdx]!.openTime,
      exitPrice: fill,
      bars: exitIdx - o.entryIdx,
      pnlPercent: pnl,
      rsiAtEntry: o.rsi,
      exitReason: reason,
    });
  };

  let gi = 0;
  for (let i = 0; i < candles.length; i += 1) {
    const bar = candles[i]!;

    // 1) Intrabar SL/TP — only from the bar AFTER entry (entries fill at the close).
    //    Conservative: stop checked before target, so a both-hit bar is a stop-out.
    if (open && i > open.entryIdx) {
      if (open.side === 'buy') {
        if (open.sl != null && bar.low <= open.sl) {
          close(open, i, Math.min(open.sl, bar.open), 'stop'); // gap-through fills at the open
          open = null;
        } else if (open.tp != null && bar.high >= open.tp) {
          close(open, i, open.tp, 'target');
          open = null;
        }
      } else {
        if (open.sl != null && bar.high >= open.sl) {
          close(open, i, Math.max(open.sl, bar.open), 'stop');
          open = null;
        } else if (open.tp != null && bar.low <= open.tp) {
          close(open, i, open.tp, 'target');
          open = null;
        }
      }
    }

    // 2) Cross signal(s) landing on this bar (fires at the close, after intrabar exits).
    while (gi < gated.length && gated[gi]!.index === i) {
      const c = gated[gi]!;
      gi += 1;
      if (open && open.side === c.side) continue; // ignore re-entries (matches v1)
      const raw = pickSource(bar, source);
      if (open) {
        close(open, i, raw, 'cross');
        open = null;
      }
      // Entry slippage works against the trade: a buy fills higher, a sell fills lower.
      const entryFill = c.side === 'buy' ? raw * (1 + slip) : raw * (1 - slip);
      open = {
        side: c.side,
        entryIdx: i,
        entryFill,
        sl:
          r.stopLossPct != null
            ? c.side === 'buy'
              ? entryFill * (1 - r.stopLossPct / 100)
              : entryFill * (1 + r.stopLossPct / 100)
            : undefined,
        tp:
          r.takeProfitPct != null
            ? c.side === 'buy'
              ? entryFill * (1 + r.takeProfitPct / 100)
              : entryFill * (1 - r.takeProfitPct / 100)
            : undefined,
        rsi: rsiVals ? rsiVals[i] : undefined,
      };
    }
  }

  // Close any still-open position at the last candle to keep stats honest.
  if (open) {
    const lastIdx = candles.length - 1;
    close(open, lastIdx, pickSource(candles[lastIdx]!, source), 'end');
  }
  return trades;
}

function emptyResult(): BacktestResult {
  return {
    trades: [],
    equity: [],
    summary: {
      trades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      finalEquity: 100,
      totalReturnPct: 0,
      maxDrawdownPct: 0,
      sharpe: 0,
      profitFactor: 0,
      avgWinPct: 0,
      avgLossPct: 0,
      avgBars: 0,
    },
  };
}
