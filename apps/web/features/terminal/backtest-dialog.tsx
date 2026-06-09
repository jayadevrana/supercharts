'use client';

import { useState } from 'react';
import { FlaskConical, Play, Loader2, LineChart, EyeOff, TrendingUp, TrendingDown } from 'lucide-react';
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
  trades: BacktestTrade[];
  equity: Array<{ time: number; equity: number; drawdown: number }>;
  summary: BacktestSummary;
}

const fmtPct = (n: number, dp = 1): string => `${n >= 0 ? '+' : ''}${n.toFixed(dp)}%`;
const fmtPf = (n: number): string => (Number.isFinite(n) ? n.toFixed(2) : '∞');
const fmtMoney = (n: number): string => {
  const a = Math.abs(n);
  const s = a >= 1000 ? `$${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}K` : `$${a.toFixed(0)}`;
  return `${n < 0 ? '-' : ''}${s}`;
};

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

        {/* Controls */}
        <div className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
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

        {/* Results */}
        <div className="min-h-0 flex-1 overflow-auto scroll-thin p-4">
          {!s ? (
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
                        <td className="px-2 py-1 tabular-nums text-muted-foreground">{new Date(t.entryTime).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })} @ {t.entryPrice}</td>
                        <td className="px-2 py-1 tabular-nums text-muted-foreground">{new Date(t.exitTime).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })} @ {t.exitPrice}</td>
                        <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{t.bars}</td>
                        <td className={`px-2 py-1 text-right tabular-nums font-medium ${t.pnlPercent >= 0 ? 'text-bull' : 'text-bear'}`}>{fmtPct(t.pnlPercent, 2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="leading-relaxed text-[10px] text-muted-foreground/70">
                Real backtest of the last {result.barsTested} closed candles of {formatSymbolLabel(pane.symbol)} {pane.interval}. v1 trade model — enter on each cross, exit on the next opposite cross; compounded from a base of 100; <strong>no fees / slippage / leverage / SL-TP / position sizing</strong>. The $ figure is the return % applied to your account size — illustrative only, not stored or ranked.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
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
