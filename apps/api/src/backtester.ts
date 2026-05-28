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
 * v1 NOT included (intentional): leverage, slippage, fees, SL/TP, fractional sizing,
 * cooldowns, multi-position, max-trades-per-day. Those land in Phase 1 #3+ once the
 * basic shape proves out.
 */

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

export function runMaCrossBacktest(
  candles: ReadonlyArray<Candle>,
  config: MaCrossAlertConfig,
  interval: string,
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

  // Walk gated crosses and pair entries with the next OPPOSITE-side cross as exit.
  // A same-side cross while a position is open is ignored — the position is already
  // capturing that direction.
  const trades: BacktestTrade[] = [];
  let open: { side: 'buy' | 'sell'; entryIdx: number; entryPrice: number; rsi?: number } | null = null;

  for (const c of gated) {
    const bar = candles[c.index];
    if (!bar) continue;
    if (open && open.side === c.side) continue; // ignore re-entries
    const price = pickSource(bar, config.ma.source);
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
      open = null;
    }
    open = {
      side: c.side,
      entryIdx: c.index,
      entryPrice: price,
      rsi: config.rsiFilter && rsiVals ? rsiVals[c.index] : undefined,
    };
  }

  // Close any still-open position at the last candle to keep stats honest.
  if (open) {
    const last = candles[candles.length - 1]!;
    const lastPrice = pickSource(last, config.ma.source);
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
