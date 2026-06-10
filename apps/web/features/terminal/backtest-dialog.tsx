'use client';

import { useState } from 'react';
import { FlaskConical, Play, Loader2, LineChart, EyeOff, TrendingUp, TrendingDown, ChevronRight, Trophy, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { toast } from '@/components/use-toast';
import { formatSymbolLabel } from '@/lib/format';
import { useTerminalStore } from './terminal-store';

interface BacktestTrade {
  side: 'buy' | 'sell';
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  bars: number;
  pnlPercent: number;
  /** Present only when realism options were applied. */
  exitReason?: 'cross' | 'stop' | 'target' | 'end';
}
interface RealismOptions {
  commissionPct?: number;
  slippagePct?: number;
  stopLossPct?: number;
  takeProfitPct?: number;
}
interface BacktestSummary {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  finalEquity: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  sharpe: number;
  profitFactor: number;
  avgWinPct: number;
  avgLossPct: number;
  avgBars: number;
}
interface BacktestResponse {
  symbol: string;
  interval: string;
  barsTested: number;
  /** Echoed by the API only when realism options were applied to the run. */
  realism?: RealismOptions;
  trades: BacktestTrade[];
  equity: Array<{ time: number; equity: number; drawdown: number }>;
  summary: BacktestSummary;
}

/** One pass of the standalone optimizer sweep (POST /api/optimize). */
interface OptimizeCombo {
  config: { ma: { type: string; length: number }; crossWith?: { length: number } };
  summary: BacktestSummary;
  metrics?: {
    expectancyPct: number;
    profitFactorCapped: number;
    qualityScore: number;
    rank: number;
    robustness: { flags: string[]; tone: 'green' | 'amber' | 'red' };
  };
}
interface OptimizeResponse {
  symbol: string;
  interval: string;
  maType: string;
  barsTested: number;
  sweepMs: number;
  evaluated: number;
  qualifying: number;
  combos: OptimizeCombo[];
  /** Present only when combos is empty: closest candidates, flagged 'below quality bar'. */
  fallbackCombos?: OptimizeCombo[];
  note?: string;
  floor?: { minWinRate: number; passed: number; bestWinRate: number };
}

const fmtPct = (n: number, dp = 1): string => `${n >= 0 ? '+' : ''}${n.toFixed(dp)}%`;
const fmtPf = (n: number): string => (Number.isFinite(n) ? n.toFixed(2) : '∞');
const fmtMoney = (n: number): string => {
  const a = Math.abs(n);
  const s = a >= 1000 ? `$${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}K` : `$${a.toFixed(0)}`;
  return `${n < 0 ? '-' : ''}${s}`;
};
/** Trim float noise on modeled fills (slippage math) without touching clean candle prices. */
const fmtPrice = (n: number): string => String(Number(n.toPrecision(10)));

/**
 * Strategy Tester — backtest an MA-cross setup on the ACTIVE chart's symbol/interval on demand.
 * Calls POST /api/backtest (the same runMaCrossBacktest the live alerts + optimizer use) so every
 * number is a real backtest of real candles. "Plot on chart" pins the run's BUY/SELL onto the live
 * candles via the store so the client can verify the exact entries. No fabricated data, no $ stored.
 */
export function BacktestDialog() {
  const pane = useTerminalStore((s) => s.panes.find((p) => p.id === s.activePaneId) ?? s.panes[0]!);
  const setBacktestPreview = useTerminalStore((s) => s.setBacktestPreview);
  const backtestPreview = useTerminalStore((s) => s.backtestPreview);

  const [open, setOpen] = useState(false);
  const [maType, setMaType] = useState<'ema' | 'sma'>('ema');
  const [fast, setFast] = useState(9);
  const [slow, setSlow] = useState(21);
  const [account, setAccount] = useState(10000);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResponse | null>(null);

  // Realism layer — every field blank = OFF = the plain v1 model (byte-identical results).
  const [showRealism, setShowRealism] = useState(false);
  const [commission, setCommission] = useState('');
  const [slippage, setSlippage] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');

  // Optimizer mode — MetaTrader-style parameter sweep over the active chart.
  const [mode, setMode] = useState<'test' | 'optimize'>('test');
  const [objective, setObjective] = useState<'profit' | 'accuracy' | 'balanced'>('balanced');
  const [minWinPct, setMinWinPct] = useState(0);
  const [fastRange, setFastRange] = useState({ from: 2, step: 1, to: 35 });
  const [slowRange, setSlowRange] = useState({ from: 5, step: 3, to: 110 });
  const [optRunning, setOptRunning] = useState(false);
  const [optResult, setOptResult] = useState<OptimizeResponse | null>(null);
  const [optError, setOptError] = useState<string | null>(null);

  const comboEstimate = (() => {
    let n = 0;
    for (let f = fastRange.from; f <= fastRange.to; f += Math.max(1, fastRange.step))
      for (let sl = slowRange.from; sl <= slowRange.to; sl += Math.max(1, slowRange.step)) if (sl > f) n += 1;
    return n;
  })();

  const runOptimize = async (obj = objective, minWin = minWinPct): Promise<void> => {
    setOptRunning(true);
    setOptError(null);
    try {
      const r = await api<OptimizeResponse>('/optimize', {
        method: 'POST',
        body: JSON.stringify({
          symbol: pane.symbol,
          interval: pane.interval,
          maType,
          objective: obj,
          minWinRate: minWin > 0 ? minWin / 100 : undefined,
          topN: 20,
          fastRange,
          slowRange,
          ...realismBody,
        }),
      });
      setOptResult(r);
    } catch (err) {
      setOptResult(null);
      setOptError(err instanceof Error ? err.message : String(err));
    } finally {
      setOptRunning(false);
    }
  };

  /** Adopt a swept setting: load it into single-test mode and plot its signals on the chart. */
  const useCombo = (c: OptimizeCombo): void => {
    const f = c.config.ma.length;
    const sl = c.config.crossWith?.length ?? f * 2;
    setFast(f);
    setSlow(sl);
    setBacktestPreview({ paneId: pane.id, maType, fast: f, slow: sl });
    toast({ title: `Using ${maType.toUpperCase()} ${f}×${sl}`, description: 'Signals plotted on the chart — run a single test to see the full trade list.', tone: 'success' });
  };

  const parsePct = (s: string): number | undefined => {
    const v = parseFloat(s);
    return Number.isFinite(v) && v > 0 ? v : undefined;
  };
  const realismBody: RealismOptions = {
    ...(parsePct(commission) != null ? { commissionPct: parsePct(commission) } : {}),
    ...(parsePct(slippage) != null ? { slippagePct: parsePct(slippage) } : {}),
    ...(parsePct(stopLoss) != null ? { stopLossPct: parsePct(stopLoss) } : {}),
    ...(parsePct(takeProfit) != null ? { takeProfitPct: parsePct(takeProfit) } : {}),
  };
  const realismActive = Object.keys(realismBody).length > 0;

  const plottedHere = backtestPreview?.paneId === pane.id;

  const run = async (): Promise<void> => {
    if (fast >= slow) {
      toast({ title: 'Fast length must be below slow', tone: 'error' });
      return;
    }
    setRunning(true);
    try {
      const r = await api<BacktestResponse>('/backtest', {
        method: 'POST',
        body: JSON.stringify({
          symbol: pane.symbol,
          interval: pane.interval,
          ma: { type: maType, length: fast },
          crossWith: { type: maType, length: slow },
          ...realismBody,
        }),
      });
      setResult(r);
    } catch (err) {
      toast({ title: 'Backtest failed', description: String(err), tone: 'error' });
    } finally {
      setRunning(false);
    }
  };

  const plotOnChart = (): void => {
    setBacktestPreview({ paneId: pane.id, maType, fast, slow });
    toast({ title: 'Signals plotted', description: `${maType.toUpperCase()} ${fast}×${slow} BUY/SELL on ${formatSymbolLabel(pane.symbol)}`, tone: 'success' });
  };
  const clearPlot = (): void => setBacktestPreview(null);

  const s = result?.summary;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground hover:text-foreground">
          <FlaskConical className="h-3.5 w-3.5" /> Backtest
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[88vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="flex flex-row items-center gap-2 border-b border-border px-4 py-2.5">
          <FlaskConical className="h-4 w-4 text-accent" />
          <DialogTitle className="text-sm">Strategy Tester</DialogTitle>
          <Badge tone="muted" className="text-[9px]">{formatSymbolLabel(pane.symbol)} · {pane.interval}</Badge>
          {plottedHere ? <Badge tone="accent" className="text-[9px]">plotted on chart</Badge> : null}
        </DialogHeader>

        {/* Mode tabs — single test vs the MetaTrader-style sweep. */}
        <div className="flex border-b border-border">
          {(
            [
              ['test', 'Single test', <Play key="i" className="h-3 w-3" />],
              ['optimize', `Optimizer · ${comboEstimate.toLocaleString()} combinations`, <Trophy key="i" className="h-3 w-3" />],
            ] as const
          ).map(([m, label, icon]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex items-center gap-1.5 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                mode === m ? 'border-b-2 border-accent text-accent' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {icon} {label}
            </button>
          ))}
        </div>

        {/* Controls */}
        <div className={`flex-wrap items-end gap-3 border-b border-border px-4 py-3 ${mode === 'test' ? 'flex' : 'hidden'}`}>
          <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            MA type
            <Select value={maType} onValueChange={(v) => setMaType(v as 'ema' | 'sma')}>
              <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ema">EMA</SelectItem>
                <SelectItem value="sma">SMA</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Fast
            <Input type="number" min={1} value={fast} onChange={(e) => setFast(Math.max(1, +e.target.value || 1))} className="h-8 w-20 text-xs" />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Slow
            <Input type="number" min={2} value={slow} onChange={(e) => setSlow(Math.max(2, +e.target.value || 2))} className="h-8 w-20 text-xs" />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Account $
            <Input type="number" min={0} value={account} onChange={(e) => setAccount(Math.max(0, +e.target.value || 0))} className="h-8 w-28 text-xs" />
          </label>
          <Button size="sm" className="h-8 gap-1.5" onClick={() => void run()} disabled={running}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Run backtest
          </Button>
        </div>

        {/* Optimizer controls — MetaTrader-style from/step/to per parameter. */}
        <div className={`flex-wrap items-end gap-3 border-b border-border px-4 py-3 ${mode === 'optimize' ? 'flex' : 'hidden'}`}>
          <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            MA type
            <Select value={maType} onValueChange={(v) => setMaType(v as 'ema' | 'sma')}>
              <SelectTrigger className="h-8 w-20 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ema">EMA</SelectItem>
                <SelectItem value="sma">SMA</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {(
            [
              ['Fast', fastRange, setFastRange],
              ['Slow', slowRange, setSlowRange],
            ] as const
          ).map(([label, range, set]) => (
            <div key={label} className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label} · from / step / to</span>
              <div className="flex gap-1">
                {(['from', 'step', 'to'] as const).map((k) => (
                  <Input
                    key={k}
                    type="number"
                    min={1}
                    value={range[k]}
                    onChange={(e) => set({ ...range, [k]: Math.max(1, Math.round(+e.target.value || 1)) })}
                    className="h-8 w-16 text-xs"
                  />
                ))}
              </div>
            </div>
          ))}
          <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Optimise for
            <div className="flex overflow-hidden rounded-md border border-border">
              {(
                [
                  ['profit', '💰 Profit'],
                  ['accuracy', '🎯 Accuracy'],
                  ['balanced', '⚖️ Balanced'],
                ] as const
              ).map(([o, label]) => (
                <button
                  key={o}
                  onClick={() => { setObjective(o); if (optResult) void runOptimize(o); }}
                  className={`px-2.5 py-1.5 text-xs transition-colors ${objective === o ? 'bg-accent/20 font-medium text-accent' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Min win rate ≥ {minWinPct}%
            <input
              type="range"
              min={0}
              max={90}
              step={5}
              value={minWinPct}
              onChange={(e) => setMinWinPct(+e.target.value)}
              onPointerUp={() => { if (optResult) void runOptimize(); }}
              className="h-8 w-28 accent-[hsl(var(--accent))]"
            />
          </label>
          <Button size="sm" className="h-8 gap-1.5" onClick={() => void runOptimize()} disabled={optRunning || comboEstimate === 0 || comboEstimate > 5000}>
            {optRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trophy className="h-3.5 w-3.5" />}
            Find best settings
          </Button>
          {comboEstimate > 5000 ? <span className="text-[10px] text-bear">Over the 5000-combination cap — raise the steps.</span> : null}
        </div>

        {/* Realism — optional fees / slippage / SL-TP. All blank = off = the plain v1 model. */}
        <div className="border-b border-border px-4 py-2">
          <button
            type="button"
            onClick={() => setShowRealism((v) => !v)}
            aria-expanded={showRealism}
            className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className={`h-3 w-3 transition-transform ${showRealism ? 'rotate-90' : ''}`} />
            Realism · fees / slippage / SL-TP
            {realismActive ? <Badge tone="accent" className="text-[9px]">on</Badge> : <span className="text-[9px] normal-case tracking-normal text-muted-foreground/60">off</span>}
          </button>
          {showRealism ? (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Commission %/side
                  <Input type="number" min={0} step="0.01" placeholder="off" value={commission} onChange={(e) => setCommission(e.target.value)} className="h-8 w-28 text-xs" />
                </label>
                <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Slippage %
                  <Input type="number" min={0} step="0.01" placeholder="off" value={slippage} onChange={(e) => setSlippage(e.target.value)} className="h-8 w-24 text-xs" />
                </label>
                <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Stop loss %
                  <Input type="number" min={0} step="0.1" placeholder="off" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} className="h-8 w-24 text-xs" />
                </label>
                <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Take profit %
                  <Input type="number" min={0} step="0.1" placeholder="off" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} className="h-8 w-24 text-xs" />
                </label>
              </div>
              <p className="leading-relaxed text-[10px] text-muted-foreground/70">
                Commission is charged per side as % of notional; slippage moves both fills against the trade.
                SL/TP exit intrabar off the candle high/low — when one bar&apos;s range spans both levels the <strong>stop is assumed to fill first</strong> (worst case), and a stop that gaps past its level fills at the bar open. Blank fields stay off.
              </p>
            </div>
          ) : null}
        </div>

        {/* Results */}
        <div className="min-h-0 flex-1 overflow-auto scroll-thin p-4">
          {mode === 'optimize' ? (
            <OptimizerResults
              result={optResult}
              error={optError}
              running={optRunning}
              account={account}
              maType={maType}
              symbol={pane.symbol}
              interval={pane.interval}
              onUse={useCombo}
            />
          ) : !s ? (
            <div className="flex h-40 items-center justify-center text-center text-xs text-muted-foreground">
              Set the fast/slow MA and press <span className="mx-1 font-medium text-foreground">Run backtest</span> to test {maType.toUpperCase()} {fast}×{slow} on {formatSymbolLabel(pane.symbol)} {pane.interval}.
            </div>
          ) : (
            <div className="space-y-4">
              {/* Stat grid */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Net return" value={fmtPct(s.totalReturnPct)} sub={fmtMoney((s.totalReturnPct / 100) * account)} tone={s.totalReturnPct >= 0 ? 'pos' : 'neg'} />
                <Stat label="Win rate" value={`${(s.winRate * 100).toFixed(0)}%`} sub={`${s.wins}W / ${s.losses}L`} />
                <Stat label="Trades" value={String(s.trades)} sub={`avg ${s.avgBars.toFixed(0)} bars`} />
                <Stat label="Profit factor" value={fmtPf(s.profitFactor)} sub={`Sharpe ${s.sharpe.toFixed(2)}`} />
                <Stat label="Max drawdown" value={fmtPct(-s.maxDrawdownPct)} tone="neg" />
                <Stat label="Avg win" value={fmtPct(s.avgWinPct)} tone="pos" />
                <Stat label="Avg loss" value={fmtPct(s.avgLossPct)} tone="neg" />
                <Stat label="Bars tested" value={String(result.barsTested)} sub="real candles" />
              </div>

              {/* Equity curve */}
              <EquityCurve points={result.equity} />

              {/* Plot controls */}
              <div className="flex items-center gap-2">
                {plottedHere ? (
                  <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={clearPlot}>
                    <EyeOff className="h-3.5 w-3.5" /> Hide signals on chart
                  </Button>
                ) : (
                  <Button size="sm" className="h-8 gap-1.5" onClick={plotOnChart}>
                    <LineChart className="h-3.5 w-3.5" /> Plot BUY/SELL on chart
                  </Button>
                )}
                <span className="text-[11px] text-muted-foreground">Verify the entries against the real candles behind this dialog.</span>
              </div>

              {/* Trade list */}
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-surface-raised/60 text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5">#</th>
                      <th className="px-2 py-1.5">Side</th>
                      <th className="px-2 py-1.5">Entry</th>
                      <th className="px-2 py-1.5">Exit</th>
                      <th className="px-2 py-1.5 text-right">Bars</th>
                      <th className="px-2 py-1.5 text-right">P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.slice(-50).reverse().map((t, i) => (
                      <tr key={`${t.entryTime}-${i}`} className="border-t border-border/60">
                        <td className="px-2 py-1 text-muted-foreground">{result.trades.length - i}</td>
                        <td className="px-2 py-1">
                          <span className={`inline-flex items-center gap-1 ${t.side === 'buy' ? 'text-bull' : 'text-bear'}`}>
                            {t.side === 'buy' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                            {t.side.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-2 py-1 tabular-nums text-muted-foreground">{new Date(t.entryTime).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })} @ {fmtPrice(t.entryPrice)}</td>
                        <td className="px-2 py-1 tabular-nums text-muted-foreground">
                          {new Date(t.exitTime).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })} @ {fmtPrice(t.exitPrice)}
                          {t.exitReason === 'stop' ? <span className="ml-1 text-bear">SL</span> : null}
                          {t.exitReason === 'target' ? <span className="ml-1 text-bull">TP</span> : null}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{t.bars}</td>
                        <td className={`px-2 py-1 text-right tabular-nums font-medium ${t.pnlPercent >= 0 ? 'text-bull' : 'text-bear'}`}>{fmtPct(t.pnlPercent, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {result.realism ? (
                <p className="leading-relaxed text-[10px] text-muted-foreground/70">
                  Real backtest of the last {result.barsTested} closed candles of {formatSymbolLabel(pane.symbol)} {pane.interval}, with realism applied:{' '}
                  {[
                    result.realism.commissionPct != null ? `commission ${result.realism.commissionPct}%/side of notional` : null,
                    result.realism.slippagePct != null ? `slippage ${result.realism.slippagePct}% against the trade on both fills` : null,
                    result.realism.stopLossPct != null ? `stop loss ${result.realism.stopLossPct}%` : null,
                    result.realism.takeProfitPct != null ? `take profit ${result.realism.takeProfitPct}%` : null,
                  ].filter(Boolean).join(' · ')}
                  . SL/TP exits use <strong>worst-case intrabar ordering</strong> — when one bar hits both levels the stop fills first, and a gapped stop fills at the bar open. Entry/exit prices shown are the modeled fills. Compounded from a base of 100; <strong>no leverage / position sizing</strong>. The $ figure is the return % applied to your account size — illustrative only, not stored or ranked.
                </p>
              ) : (
                <p className="leading-relaxed text-[10px] text-muted-foreground/70">
                  Real backtest of the last {result.barsTested} closed candles of {formatSymbolLabel(pane.symbol)} {pane.interval}. v1 trade model — enter on each cross, exit on the next opposite cross; compounded from a base of 100; <strong>no fees / slippage / leverage / SL-TP / position sizing</strong> (expand the Realism row above to add them). The $ figure is the return % applied to your account size — illustrative only, not stored or ranked.
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OptimizerResults({
  result,
  error,
  running,
  account,
  maType,
  symbol,
  interval,
  onUse,
}: {
  result: OptimizeResponse | null;
  error: string | null;
  running: boolean;
  account: number;
  maType: string;
  symbol: string;
  interval: string;
  onUse: (c: OptimizeCombo) => void;
}) {
  if (running && !result) {
    return (
      <div className="flex h-40 items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Backtesting every combination on real candles…
      </div>
    );
  }
  if (error) {
    return <div className="rounded-lg border border-bear/40 bg-bear/10 p-3 text-xs text-bear">{error}</div>;
  }
  if (!result) {
    return (
      <div className="flex h-40 items-center justify-center text-center text-xs text-muted-foreground">
        Set the from/step/to ranges and press <span className="mx-1 font-medium text-foreground">Find best settings</span> — every combination is a real backtest of {formatSymbolLabel(symbol)} {interval}, ranked by your objective.
      </div>
    );
  }
  const isFallback = result.combos.length === 0 && (result.fallbackCombos?.length ?? 0) > 0;
  const rows = isFallback ? result.fallbackCombos! : result.combos;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="font-semibold text-foreground">{result.evaluated.toLocaleString()} combinations tested</span>
        <span>· {result.qualifying} qualified</span>
        <span>· {result.barsTested} real candles</span>
        <span>· {result.sweepMs} ms</span>
      </div>
      {result.note ? <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-200">{result.note}</div> : null}
      {isFallback ? (
        <div className="rounded-md border border-border bg-surface-raised/60 p-2 text-[11px] text-muted-foreground">
          Showing the <span className="font-medium text-foreground">closest candidates</span> ranked by your objective — none meets the
          quality bar, so treat these as a map of the landscape, <span className="font-medium text-foreground">not</span> tradeable
          settings. A higher timeframe usually helps.
        </div>
      ) : null}
      {rows.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-surface-raised/60 text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5">#</th>
                <th className="px-2 py-1.5">Setting</th>
                <th className="px-2 py-1.5 text-right">Profit</th>
                <th className="px-2 py-1.5 text-right">Win %</th>
                <th className="px-2 py-1.5 text-right">Trades</th>
                <th className="px-2 py-1.5 text-right">Max DD</th>
                <th className="px-2 py-1.5 text-right">PF</th>
                <th className="px-2 py-1.5">Quality</th>
                <th className="px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const cs = c.summary;
                const m = c.metrics;
                const tone = m?.robustness.tone ?? 'amber';
                return (
                  <tr key={`${c.config.ma.length}-${c.config.crossWith?.length}`} className="border-t border-border/60">
                    <td className="px-2 py-1 text-muted-foreground">{m?.rank}</td>
                    <td className="px-2 py-1 font-medium text-foreground">{maType.toUpperCase()} {c.config.ma.length}×{c.config.crossWith?.length}</td>
                    <td className={`px-2 py-1 text-right tabular-nums font-medium ${cs.totalReturnPct >= 0 ? 'text-bull' : 'text-bear'}`}>
                      {fmtMoney((cs.totalReturnPct / 100) * account)}
                      <span className="ml-1 text-[9px] text-muted-foreground">{fmtPct(cs.totalReturnPct)}</span>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{(cs.winRate * 100).toFixed(0)}%</td>
                    <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{cs.trades}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-bear">-{cs.maxDrawdownPct.toFixed(1)}%</td>
                    <td className="px-2 py-1 text-right tabular-nums">{m ? m.profitFactorCapped.toFixed(2) : fmtPf(cs.profitFactor)}</td>
                    <td className="px-2 py-1">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${
                          tone === 'green' ? 'bg-bull/15 text-bull' : tone === 'red' ? 'bg-bear/15 text-bear' : 'bg-amber-500/15 text-amber-300'
                        }`}
                        title={m?.robustness.flags.join(' · ')}
                      >
                        {m?.robustness.flags[0] ?? '—'}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-right">
                      <Button size="sm" variant="outline" className="h-6 gap-1 px-2 text-[10px]" onClick={() => onUse(c)}>
                        <Check className="h-3 w-3" /> Use
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface-raised/40 p-4 text-center text-xs text-muted-foreground">
          No combination met the filters{result.floor ? ` (best win rate seen: ${(result.floor.bestWinRate * 100).toFixed(0)}%)` : ''} — lower the win-rate floor or widen the ranges.
        </div>
      )}
      <p className="leading-relaxed text-[10px] text-muted-foreground/70">
        Every row is a real backtest of the last {result.barsTested} closed candles of {formatSymbolLabel(symbol)} {interval} — same trade model as the single test (and your Realism settings apply here too). Flashy settings with too few trades, no losing trade, deep drawdown or a lone-spike neighbourhood are filtered or flagged, not celebrated. <strong>Use</strong> loads a setting into Single test and plots its BUY/SELL on the chart so you can verify the entries. Past performance ≠ future results.
      </p>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="rounded-lg border border-border bg-surface-raised/40 px-3 py-2">
      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${tone === 'pos' ? 'text-bull' : tone === 'neg' ? 'text-bear' : 'text-foreground'}`}>{value}</div>
      {sub ? <div className="text-[9px] text-muted-foreground/80">{sub}</div> : null}
    </div>
  );
}

function EquityCurve({ points }: { points: Array<{ equity: number }> }) {
  if (points.length < 2) {
    return <div className="rounded-lg border border-border bg-surface-raised/40 px-3 py-6 text-center text-[11px] text-muted-foreground">Not enough trades to draw an equity curve.</div>;
  }
  const eq = points.map((p) => p.equity);
  const min = Math.min(100, ...eq);
  const max = Math.max(100, ...eq);
  const W = 600;
  const H = 96;
  const span = max - min || 1;
  const path = eq
    .map((v, i) => `${(i / (eq.length - 1)) * W},${H - ((v - min) / span) * H}`)
    .join(' ');
  const last = eq[eq.length - 1]!;
  const up = last >= 100;
  const baseY = H - ((100 - min) / span) * H;
  return (
    <div className="rounded-lg border border-border bg-surface-raised/40 p-3">
      <div className="mb-1 flex items-center justify-between text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <span>Equity curve (base 100)</span>
        <span className={up ? 'text-bull' : 'text-bear'}>{last.toFixed(1)}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-24 w-full">
        <line x1={0} y1={baseY} x2={W} y2={baseY} stroke="currentColor" className="text-border" strokeWidth={1} strokeDasharray="3 3" />
        <polyline points={path} fill="none" stroke="currentColor" className={up ? 'text-bull' : 'text-bear'} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}
