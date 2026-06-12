'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BellRing,
  Plus,
  Power,
  Send,
  Trash2,
  Loader2,
  Check,
  X as XIcon,
  History,
  SatelliteDish,
  Wand2,
  Layers as LayersIcon,
  ListPlus,
  ChevronLeft,
  ChevronRight,
  Star,
  Pencil,
  Zap,
  Activity,
  Sliders,
  Shuffle,
  ClipboardList,
  Calculator,
  Flame,
  PieChart,
  ShieldAlert,
} from 'lucide-react';
import type { PaperPortfolio, PaperTrade } from '@supercharts/types';
import { bulkSubscribeSignals } from '@/lib/signals';
import { useMT5Store } from './mt5-store';
import { useTerminalStore } from './terminal-store';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  bulkSubscribeAlerts,
  clearAlertEvents,
  createAlert,
  createTelegramBot,
  createWatchlist,
  deleteAlert,
  deleteAlertEvent,
  deleteTelegramBot,
  deleteWatchlist,
  discoverTelegramChatsForBot,
  fetchAlertEvents,
  fetchAlerts,
  fetchTelegramBots,
  fetchWatchlists,
  fetchPaperPortfolio,
  fetchPaperTrades,
  fetchPortfolioHeat,
  type PortfolioHeatResponse,
  fetchPortfolioAttribution,
  type PnlAttributionResponse,
  fetchPortfolioReport,
  sendPortfolioReport,
  type StatReportResponse,
  fetchBreaker,
  configureBreaker,
  resumeBreaker,
  type BreakerStatus,
  resetPaperTrades,
  runBacktest,
  runOptimize,
  runSizerPreview,
  runWalkForward,
  type BacktestResponse,
  type OptimizeResponse,
  type OptimizerCombo,
  type OptimizeObjective,
  type SizerPreviewBody,
  type SizerPreviewResponse,
  type WalkForwardResponse,
  MA_SOURCE_OPTIONS,
  MA_TYPE_OPTIONS,
  testTelegramBot,
  TIMEZONE_OPTIONS,
  toggleAlert,
  updateAlert,
  updateTelegramBot,
  updateWatchlist,
  type DiscoveredChat,
  type Watchlist,
} from '@/lib/alerts';
import type { TelegramBot } from '@supercharts/types';
import { toast } from '@/components/use-toast';
import type {
  AlertDefinition,
  AlertEvent,
  Interval,
  MaCrossAlertConfig,
  TelegramConfig,
} from '@supercharts/types';
import { INTERVALS, SYMBOL_CATALOG, CATEGORY_LABEL, CATEGORY_ORDER, getCatalogSymbol } from '@supercharts/types';
import { formatPrice, formatRelativeTime, formatSymbolLabel } from '@/lib/format';

const DEFAULT_CONFIG: MaCrossAlertConfig = {
  ma: { type: 'ema', length: 20, source: 'close' },
  labels: { buy: 'BUY', sell: 'SELL' },
  delivery: { web: true, telegram: false },
  timezone: 'UTC',
};

type DraftAlert = {
  symbol: string;
  interval: Interval;
  enabled: boolean;
  config: MaCrossAlertConfig;
};

export function AlertsDialog({ activeSymbol }: { activeSymbol?: string }) {
  const [open, setOpen] = useState(false);
  // Open on request from other surfaces (chart context menu "Create alert…").
  const dialogRequest = useTerminalStore((s) => s.dialogRequest);
  useEffect(() => {
    if (dialogRequest?.kind === 'alerts') setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogRequest?.token]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground hover:text-foreground">
          <BellRing className="h-3.5 w-3.5" /> Alerts
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-accent" /> Alerts &amp; Telegram
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            MA crossover alerts on any FX / crypto / commodity / index pair. Fires on closed bars only.
          </p>
        </DialogHeader>
        <Tabs defaultValue="active" className="px-4 pb-2">
          <TabsList className="grid w-full grid-cols-7">
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="create">New</TabsTrigger>
            <TabsTrigger value="heat">
              <span className="inline-flex items-center gap-1.5">
                <Flame className="h-3 w-3" /> Heat
              </span>
            </TabsTrigger>
            <TabsTrigger value="pnl">
              <span className="inline-flex items-center gap-1.5">
                <PieChart className="h-3 w-3" /> P&amp;L
              </span>
            </TabsTrigger>
            <TabsTrigger value="lists">
              <span className="inline-flex items-center gap-1.5">
                <Star className="h-3 w-3" /> Lists
              </span>
            </TabsTrigger>
            <TabsTrigger value="history">
              <span className="inline-flex items-center gap-1.5">
                <History className="h-3 w-3" /> Logs
              </span>
            </TabsTrigger>
            <TabsTrigger value="telegram">
              <span className="inline-flex items-center gap-1.5">
                <SatelliteDish className="h-3 w-3" /> Telegram
              </span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="active" className="max-h-[60vh] overflow-y-auto scroll-thin">
            <ActiveAlertsList />
          </TabsContent>
          <TabsContent value="create" className="max-h-[60vh] overflow-y-auto scroll-thin">
            <CreateAlertForm
              initialSymbol={activeSymbol ?? 'BINANCE:BTCUSDT'}
              onCreated={() => setOpen(false)}
            />
          </TabsContent>
          <TabsContent value="heat" className="max-h-[60vh] overflow-y-auto scroll-thin">
            <PortfolioHeatPanel />
          </TabsContent>
          <TabsContent value="pnl" className="max-h-[60vh] overflow-y-auto scroll-thin">
            <BreakerCard />
            <StatReportCard />
            <PnlAttributionPanel />
          </TabsContent>
          <TabsContent value="lists" className="max-h-[60vh] overflow-y-auto scroll-thin">
            <WatchlistsManager />
          </TabsContent>
          <TabsContent value="history" className="max-h-[60vh] overflow-y-auto scroll-thin">
            <EventHistory />
          </TabsContent>
          <TabsContent value="telegram" className="max-h-[60vh] overflow-y-auto scroll-thin">
            <TelegramSetup />
          </TabsContent>
        </Tabs>
        <DialogFooter className="border-t border-border/60 px-5 py-3 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Closes on the candle — no signal will fire mid-bar.
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ──────────────────────────────────────────────────────── Portfolio heat */

function heatCellColor(v: number | null): string {
  if (v === null) return 'transparent';
  const a = Math.min(1, Math.abs(v));
  // Red = positive correlation (moves together), blue = negative (offsets).
  return v >= 0 ? `rgba(239,68,68,${0.1 + a * 0.62})` : `rgba(59,130,246,${0.1 + a * 0.62})`;
}

function compactTag(symbol: string): string {
  const raw = symbol.includes(':') ? symbol.split(':')[1]! : symbol;
  return raw.replace('_', '');
}

const HEAT_INTERVALS: Interval[] = ['1d', '4h', '1h'];
const HEAT_LOOKBACKS = [60, 120, 250];

function PortfolioHeatPanel() {
  const [data, setData] = useState<PortfolioHeatResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [lookback, setLookback] = useState(120);
  const [tf, setTf] = useState<Interval>('1d');
  const [basketBusy, setBasketBusy] = useState(false);

  const load = useCallback(
    async (symbols?: string) => {
      setLoading(true);
      try {
        setData(await fetchPortfolioHeat({ symbols, lookback, interval: tf }));
      } catch (e) {
        toast({
          title: 'Heat failed',
          description: e instanceof Error ? e.message : String(e),
          tone: 'error',
        });
      } finally {
        setLoading(false);
      }
    },
    [lookback, tf],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const analyseActiveAlerts = useCallback(async () => {
    setBasketBusy(true);
    try {
      const alerts = await fetchAlerts();
      const syms = [...new Set(alerts.filter((a) => a.enabled).map((a) => a.symbol))].slice(0, 12);
      if (syms.length < 2) {
        toast({ title: 'Need at least 2 distinct symbols' });
        return;
      }
      await load(syms.join(','));
    } finally {
      setBasketBusy(false);
    }
  }, [load]);

  const concColor =
    data?.concentrationLabel === 'High'
      ? 'text-red-400'
      : data?.concentrationLabel === 'Moderate'
        ? 'text-amber-400'
        : 'text-emerald-400';

  const symbols = data?.symbols ?? [];
  const matrix = data?.matrix ?? [];

  return (
    <div className="space-y-4 px-1 py-2">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border/60 bg-card/40 p-3">
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Timeframe</label>
          <Select value={tf} onValueChange={(v) => setTf(v as Interval)}>
            <SelectTrigger className="h-8 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HEAT_INTERVALS.map((i) => (
                <SelectItem key={i} value={i} className="text-xs">
                  {i}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Lookback</label>
          <Select value={String(lookback)} onValueChange={(v) => setLookback(Number(v))}>
            <SelectTrigger className="h-8 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HEAT_LOOKBACKS.map((n) => (
                <SelectItem key={n} value={String(n)} className="text-xs">
                  {n} bars
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={analyseActiveAlerts} disabled={basketBusy || loading}>
          {basketBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Activity className="h-3 w-3" />}
          Analyse active alerts
        </Button>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <BellRing className="h-3 w-3" />}
          Open positions
        </Button>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Computing correlations…
        </div>
      ) : data?.empty ? (
        <div className="rounded-lg border border-dashed border-border/60 bg-card/30 px-4 py-10 text-center text-sm text-muted-foreground">
          {data.reason === 'no_open_positions' ? (
            <>
              <Flame className="mx-auto mb-2 h-5 w-5 opacity-50" />
              No open paper positions yet. Heat needs ≥2 to map correlation —
              <br />
              enable paper-trading on a few alerts, or click{' '}
              <span className="font-medium text-foreground">Analyse active alerts</span> to map your watched basket.
            </>
          ) : (
            <>Need at least 2 distinct symbols to compute a correlation matrix.</>
          )}
        </div>
      ) : data ? (
        <>
          {/* Concentration headline */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-border/60 bg-card/40 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Risk concentration</div>
              <div className={`mt-1 text-2xl font-semibold ${concColor}`}>{data.concentrationLabel}</div>
              <div className="text-[11px] text-muted-foreground">
                directional score {(data.concentration ?? 0).toFixed(2)}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-card/40 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg |correlation|</div>
              <div className="mt-1 text-2xl font-semibold text-foreground">{(data.avgAbsCorr ?? 0).toFixed(2)}</div>
              <div className="text-[11px] text-muted-foreground">{symbols.length} symbols · {data.interval} · {data.lookback} bars</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-card/40 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Stacked pairs</div>
              <div className="mt-1 text-2xl font-semibold text-foreground">
                {(data.pairs ?? []).filter((p) => p.stacked).length}
              </div>
              <div className="text-[11px] text-muted-foreground">|corr| ≥ {data.threshold ?? 0.6}, same direction</div>
            </div>
          </div>

          {/* Warnings */}
          {(data.warnings ?? []).length > 0 && (
            <div className="space-y-1.5">
              {data.warnings!.map((w, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  <Flame className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* Correlation matrix */}
          {symbols.length >= 2 && (
            <div className="rounded-lg border border-border/60 bg-card/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">Correlation matrix</span>
                <span className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'rgba(239,68,68,0.7)' }} /> together
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'rgba(59,130,246,0.7)' }} /> offset
                </span>
              </div>
              <div className="overflow-x-auto scroll-thin">
                <table className="border-collapse text-[10px]">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 bg-card/40 p-1" />
                      {symbols.map((s) => (
                        <th key={s} className="p-1 font-medium text-muted-foreground" title={data.labels?.[s] ?? s}>
                          <div className="w-10 truncate">{compactTag(s)}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {symbols.map((rowSym, r) => (
                      <tr key={rowSym}>
                        <td className="sticky left-0 z-10 whitespace-nowrap bg-card/40 pr-2 font-medium text-muted-foreground" title={data.labels?.[rowSym] ?? rowSym}>
                          {compactTag(rowSym)}
                        </td>
                        {symbols.map((colSym, c) => {
                          const v = matrix[r]?.[c] ?? null;
                          const diag = r === c;
                          return (
                            <td
                              key={colSym}
                              className="h-9 w-10 border border-border/30 text-center tabular-nums"
                              style={{ backgroundColor: diag ? 'rgba(148,163,184,0.12)' : heatCellColor(v) }}
                            >
                              {diag ? '—' : v === null ? '·' : v.toFixed(2)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Exposure */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border/60 bg-card/40 p-3">
              <div className="mb-2 text-xs font-medium text-foreground">Asset-class exposure</div>
              {(data.assetClasses ?? []).length === 0 ? (
                <div className="text-[11px] text-muted-foreground">No positions.</div>
              ) : (
                <div className="space-y-1.5">
                  {data.assetClasses!.map((b) => {
                    const max = Math.max(...data.assetClasses!.map((x) => x.count), 1);
                    return (
                      <div key={b.category} className="flex items-center gap-2 text-[11px]">
                        <span className="w-20 shrink-0 truncate text-muted-foreground">{b.label}</span>
                        <div className="h-3 flex-1 overflow-hidden rounded-sm bg-muted/30">
                          <div className="h-full bg-accent/70" style={{ width: `${(b.count / max) * 100}%` }} />
                        </div>
                        <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
                          {b.longs}L / {b.shorts}S
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="rounded-lg border border-border/60 bg-card/40 p-3">
              <div className="mb-2 text-xs font-medium text-foreground">Net currency exposure</div>
              {(data.currencies ?? []).length === 0 ? (
                <div className="text-[11px] text-muted-foreground">No decodable currencies.</div>
              ) : (
                <div className="space-y-1.5">
                  {data.currencies!.slice(0, 8).map((c) => {
                    const max = Math.max(...data.currencies!.map((x) => Math.abs(x.net)), 1);
                    const pct = (Math.abs(c.net) / max) * 100;
                    const long = c.net >= 0;
                    return (
                      <div key={c.currency} className="flex items-center gap-2 text-[11px]">
                        <span className="w-12 shrink-0 font-medium text-muted-foreground">{c.currency}</span>
                        <div className="flex h-3 flex-1 items-center">
                          <div className="flex h-full w-1/2 justify-end">
                            {!long && <div className="h-full rounded-sm bg-red-500/70" style={{ width: `${pct}%` }} />}
                          </div>
                          <div className="h-full w-px bg-border" />
                          <div className="flex h-full w-1/2">
                            {long && <div className="h-full rounded-sm bg-emerald-500/70" style={{ width: `${pct}%` }} />}
                          </div>
                        </div>
                        <span className={`w-10 shrink-0 text-right tabular-nums ${long ? 'text-emerald-400' : 'text-red-400'}`}>
                          {c.net > 0 ? '+' : ''}
                          {c.net}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Correlations from real {data.interval} returns. Exposure is equal-weight per position (paper trades carry no lot size).
          </p>
        </>
      ) : null}
    </div>
  );
}

/* ──────────────────────────────────────────────────── Max-drawdown breaker */

function BreakerCard() {
  const [s, setS] = useState<BreakerStatus | null>(null);
  const [limit, setLimit] = useState('5');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetchBreaker();
      setS(r);
      setLimit(String(r.limitPct));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  const apply = useCallback(async (patch: { enabled?: boolean; limitPct?: number }) => {
    setBusy(true);
    try {
      setS(await configureBreaker(patch));
    } catch (e) {
      toast({ title: 'Breaker update failed', description: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }, []);

  const resume = useCallback(async () => {
    setBusy(true);
    try {
      setS(await resumeBreaker());
      toast({ title: 'Automation resumed' });
    } catch (e) {
      toast({ title: 'Resume failed', description: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }, []);

  if (!s) return null;
  return (
    <div className={`mb-4 rounded-lg border p-3 ${s.halted ? 'border-red-500/50 bg-red-500/10' : 'border-border/60 bg-card/40'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className={`h-4 w-4 ${s.halted ? 'text-red-400' : 'text-muted-foreground'}`} />
          <span className="text-xs font-medium text-foreground">Max-drawdown breaker</span>
          {s.halted && <Badge tone="bear">HALTED</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">Enabled</span>
          <Switch checked={s.enabled} onCheckedChange={(v) => void apply({ enabled: v })} disabled={busy} />
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-3 text-[11px]">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Today P&amp;L</div>
          <div className={`text-base font-semibold ${pctClass(s.dailyPnlPct)}`}>{fmtPct(s.dailyPnlPct)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Halt at −%</div>
          <div className="mt-0.5 flex items-center gap-1">
            <Input value={limit} onChange={(e) => setLimit(e.target.value)} className="h-7 w-14 text-xs" />
            <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => void apply({ limitPct: Number(limit) })} disabled={busy || !(Number(limit) > 0)}>
              Set
            </Button>
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Status</div>
          <div className={`text-sm font-semibold ${s.halted ? 'text-red-400' : s.enabled ? 'text-emerald-400' : 'text-muted-foreground'}`}>
            {s.halted ? 'Paused' : s.enabled ? 'Armed' : 'Off'}
          </div>
        </div>
      </div>
      {s.halted && (
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-red-500/30 pt-2 text-[11px] text-red-200">
          <span className="truncate">{s.reason} — new automation paused.</span>
          <Button variant="outline" size="sm" className="h-7 shrink-0 gap-1 text-[11px]" onClick={() => void resume()} disabled={busy}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Resume
          </Button>
        </div>
      )}
      <p className="mt-2 text-[10px] text-muted-foreground">
        Pauses MT5 signal recipes when today&apos;s paper P&amp;L ≤ −limit. Auto-resets at UTC midnight.
      </p>
    </div>
  );
}

/* ─────────────────────────────────────────────────────── Stat report card */

function StatReportCard() {
  const [period, setPeriod] = useState<'daily' | 'weekly'>('daily');
  const [data, setData] = useState<StatReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async (p: 'daily' | 'weekly') => {
    setLoading(true);
    try {
      setData(await fetchPortfolioReport(p));
    } catch (e) {
      toast({ title: 'Report failed', description: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [load, period]);

  const send = useCallback(async () => {
    setSending(true);
    try {
      await sendPortfolioReport(period);
      toast({ title: `${period === 'daily' ? 'Daily' : 'Weekly'} report sent to Telegram` });
    } catch (e) {
      toast({ title: 'Telegram send failed', description: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally {
      setSending(false);
    }
  }, [period]);

  return (
    <div className="mb-4 rounded-lg border border-border/60 bg-card/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">Summary report</span>
        <div className="flex items-center gap-1">
          {(['daily', 'weekly'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded px-2 py-0.5 text-[11px] capitalize ${period === p ? 'bg-accent/20 text-accent' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {p}
            </button>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="ml-2 h-7 gap-1.5 text-[11px]"
            onClick={() => void send()}
            disabled={sending || !data}
          >
            {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Telegram
          </Button>
        </div>
      </div>
      {loading && !data ? (
        <div className="py-4 text-center text-muted-foreground">
          <Loader2 className="mx-auto h-4 w-4 animate-spin" />
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-3 text-[11px] sm:grid-cols-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Signals</div>
              <div className="text-base font-semibold text-foreground">{data.fires.total}</div>
              <div className="text-muted-foreground">{data.fires.buy} buy / {data.fires.sell} sell</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Paper P&amp;L</div>
              <div className={`text-base font-semibold ${pctClass(data.paper.totalPct)}`}>{fmtPct(data.paper.totalPct)}</div>
              <div className="text-muted-foreground">real {fmtPct(data.paper.realisedPct)} · open {fmtPct(data.paper.unrealizedPct)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Closed</div>
              <div className="text-base font-semibold text-foreground">{data.paper.closedTrades}</div>
              <div className="text-muted-foreground">win {(data.paper.winRate * 100).toFixed(0)}%</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Active alerts</div>
              <div className="text-base font-semibold text-foreground">{data.activeAlerts}</div>
              <div className="text-muted-foreground">{period} window</div>
            </div>
          </div>
          {(data.best.length > 0 || data.worst.length > 0) && (
            <div className="mt-2 space-y-0.5 border-t border-border/40 pt-2 text-[11px]">
              {[...data.best, ...data.worst].map((l, i) => (
                <div key={i} className="flex justify-between gap-2">
                  <span className="truncate text-muted-foreground">{l.label}</span>
                  <span className={`shrink-0 tabular-nums ${pctClass(l.realisedPct)}`}>{fmtPct(l.realisedPct)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

/* ─────────────────────────────────────────────────────── P&L attribution */

function pctClass(n: number): string {
  return n > 0 ? 'text-emerald-400' : n < 0 ? 'text-red-400' : 'text-muted-foreground';
}
function fmtPct(n: number): string {
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function PnlAttributionPanel() {
  const [data, setData] = useState<PnlAttributionResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchPortfolioAttribution());
    } catch (e) {
      toast({ title: 'P&L load failed', description: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 5_000);
    return () => clearInterval(id);
  }, [load]);

  const t = data?.totals;
  const rows = data?.rows ?? [];
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.totalPct)), 0.0001);

  return (
    <div className="space-y-4 px-1 py-2">
      {loading && !data ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading attribution…
        </div>
      ) : !data || rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 bg-card/30 px-4 py-10 text-center text-sm text-muted-foreground">
          <PieChart className="mx-auto mb-2 h-5 w-5 opacity-50" />
          No paper trades yet. Enable paper-trading on a few alerts (ClipboardList icon on the
          <br />
          Active tab) — once they fire and flip, realised P&amp;L attributes here by strategy.
        </div>
      ) : (
        <>
          {/* Headline */}
          <div className="grid grid-cols-4 gap-3">
            <div className="rounded-lg border border-border/60 bg-card/40 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total P&amp;L</div>
              <div className={`mt-1 text-2xl font-semibold ${pctClass(t!.totalPct)}`}>{fmtPct(t!.totalPct)}</div>
              <div className="text-[11px] text-muted-foreground">
                realised {fmtPct(t!.realisedPct)} · open {fmtPct(t!.unrealizedPct)}
              </div>
            </div>
            <div className="rounded-lg border border-border/60 bg-card/40 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Win rate</div>
              <div className="mt-1 text-2xl font-semibold text-foreground">{(t!.winRate * 100).toFixed(0)}%</div>
              <div className="text-[11px] text-muted-foreground">{t!.wins}/{t!.closedTrades} closed</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-card/40 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Strategies</div>
              <div className="mt-1 text-2xl font-semibold text-foreground">{t!.strategies}</div>
              <div className="text-[11px] text-muted-foreground">{rows.length} instances · {t!.openPositions} open</div>
            </div>
            <div className="rounded-lg border border-border/60 bg-card/40 p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Best / worst</div>
              <div className={`mt-1 text-sm font-semibold ${pctClass(t!.bestRow?.totalPct ?? 0)}`}>
                {t!.bestRow ? `${fmtPct(t!.bestRow.totalPct)}` : '—'}
              </div>
              <div className={`text-sm font-semibold ${pctClass(t!.worstRow?.totalPct ?? 0)}`}>
                {t!.worstRow ? `${fmtPct(t!.worstRow.totalPct)}` : '—'}
              </div>
            </div>
          </div>

          {/* Per-instance table */}
          <div className="rounded-lg border border-border/60 bg-card/40 p-3">
            <div className="mb-2 text-xs font-medium text-foreground">By strategy instance</div>
            <div className="overflow-x-auto scroll-thin">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-1 pr-2 text-left">Strategy</th>
                    <th className="px-1 text-right">Trades</th>
                    <th className="px-1 text-right">Win%</th>
                    <th className="px-1 text-right">Realised</th>
                    <th className="px-1 text-right">Open</th>
                    <th className="px-1 text-right">Total</th>
                    <th className="w-20" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.alertId} className="border-t border-border/30">
                      <td className="py-1.5 pr-2">
                        <div className="font-medium text-foreground">{r.label}</div>
                        <div className="text-[10px] text-muted-foreground">{r.signature}</div>
                      </td>
                      <td className="px-1 text-right tabular-nums text-muted-foreground">{r.closedTrades}</td>
                      <td className="px-1 text-right tabular-nums text-muted-foreground">{(r.winRate * 100).toFixed(0)}</td>
                      <td className={`px-1 text-right tabular-nums ${pctClass(r.realisedPct)}`}>{fmtPct(r.realisedPct)}</td>
                      <td className={`px-1 text-right tabular-nums ${pctClass(r.unrealizedPct)}`}>
                        {r.openSide ? fmtPct(r.unrealizedPct) : '—'}
                      </td>
                      <td className={`px-1 text-right font-semibold tabular-nums ${pctClass(r.totalPct)}`}>{fmtPct(r.totalPct)}</td>
                      <td className="pl-2">
                        <div className="flex h-2.5 items-center">
                          <div className="flex h-full w-1/2 justify-end">
                            {r.totalPct < 0 && (
                              <div className="h-full rounded-sm bg-red-500/70" style={{ width: `${(Math.abs(r.totalPct) / maxAbs) * 100}%` }} />
                            )}
                          </div>
                          <div className="h-full w-px bg-border" />
                          <div className="flex h-full w-1/2">
                            {r.totalPct >= 0 && (
                              <div className="h-full rounded-sm bg-emerald-500/70" style={{ width: `${(Math.abs(r.totalPct) / maxAbs) * 100}%` }} />
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Rollups */}
          <div className="grid gap-3 sm:grid-cols-2">
            <RollupCard title="By recipe (signature)" rollups={data.byStrategy} />
            <RollupCard title="By asset class" rollups={data.byCategory} />
          </div>
          <p className="text-[10px] text-muted-foreground">
            Return attribution — equal-weight per trade, percentage-based (paper trades carry no lot size). Refreshes every 5s.
          </p>
        </>
      )}
    </div>
  );
}

function RollupCard({ title, rollups }: { title: string; rollups: PnlAttributionResponse['byStrategy'] }) {
  const max = Math.max(...rollups.map((r) => Math.abs(r.totalPct)), 0.0001);
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-3">
      <div className="mb-2 text-xs font-medium text-foreground">{title}</div>
      {rollups.length === 0 ? (
        <div className="text-[11px] text-muted-foreground">No data.</div>
      ) : (
        <div className="space-y-1.5">
          {rollups.map((r) => (
            <div key={r.key} className="flex items-center gap-2 text-[11px]">
              <span className="w-28 shrink-0 truncate text-muted-foreground" title={r.label}>{r.label}</span>
              <div className="h-3 flex-1 overflow-hidden rounded-sm bg-muted/30">
                <div
                  className={`h-full ${r.totalPct >= 0 ? 'bg-emerald-500/70' : 'bg-red-500/70'}`}
                  style={{ width: `${(Math.abs(r.totalPct) / max) * 100}%` }}
                />
              </div>
              <span className={`w-16 shrink-0 text-right tabular-nums ${pctClass(r.totalPct)}`}>{fmtPct(r.totalPct)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────── Active list */

function ActiveAlertsList() {
  const [alerts, setAlerts] = useState<AlertDefinition[] | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [portfolio, setPortfolio] = useState<PaperPortfolio | null>(null);
  const reload = useCallback(async () => {
    try {
      setAlerts(await fetchAlerts());
    } catch (err) {
      toast({ title: 'Could not load alerts', description: String(err), tone: 'error' });
    }
  }, []);
  const reloadPortfolio = useCallback(async () => {
    try {
      setPortfolio(await fetchPaperPortfolio());
    } catch {
      /* paper not yet configured — leave banner hidden */
    }
  }, []);
  useEffect(() => {
    void reload();
    void reloadPortfolio();
    // Live-poll portfolio every 3s for TradingView-style equity ticking.
    const id = setInterval(() => void reloadPortfolio(), 3_000);
    return () => clearInterval(id);
  }, [reload, reloadPortfolio]);

  const handleBulkSubscribe = async () => {
    if (
      !window.confirm(
        'Create a 1d EMA(5) × EMA(10) MA-cross alert for ALL catalog symbols (48)?\n\n' +
          'Existing alerts on the same (symbol, 1d) will be skipped. ' +
          'Telegram + web delivery will both be enabled.',
      )
    )
      return;
    setBulkBusy(true);
    try {
      const r = await bulkSubscribeAlerts({
        interval: '1d',
        config: {
          ma: { type: 'ema', length: 5, source: 'close' },
          crossWith: { type: 'ema', length: 10 },
          labels: { buy: 'BUY', sell: 'SELL' },
          delivery: { web: true, telegram: true },
          timezone: 'UTC',
        },
      });
      toast({
        title: `Subscribed ${r.created} symbols`,
        description:
          r.skipped > 0
            ? `${r.skipped} already had a 1d alert (skipped).`
            : 'All catalog symbols armed at 1d EMA(5) × EMA(10) close.',
        tone: 'success',
      });
      await reload();
    } catch (err) {
      toast({ title: 'Bulk subscribe failed', description: String(err), tone: 'error' });
    } finally {
      setBulkBusy(false);
    }
  };

  const showPortfolio = portfolio && (portfolio.closedTrades > 0 || portfolio.openPositions > 0);
  const PortfolioBanner = showPortfolio ? (
    <div className="border-b border-border/60 bg-surface-raised/40 px-4 py-2.5">
      <div className="flex items-center justify-between gap-3 text-xs">
        <div>
          <div className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
            Paper portfolio · {portfolio.openPositions} open · {portfolio.closedTrades} closed ·{' '}
            {(portfolio.winRate * 100).toFixed(0)}% win
          </div>
          <div className="mt-0.5 flex items-center gap-3 tabular-nums">
            <span className="text-[10px] text-muted-foreground">realised</span>
            <span
              className={`text-sm font-semibold ${
                portfolio.realisedPct >= 0 ? 'text-bull' : 'text-bear'
              }`}
            >
              {portfolio.realisedPct >= 0 ? '+' : ''}
              {portfolio.realisedPct.toFixed(2)}%
            </span>
            <span className="text-[10px] text-muted-foreground">unrealized</span>
            <span
              className={`text-sm font-semibold ${
                portfolio.unrealizedPct >= 0 ? 'text-bull' : 'text-bear'
              }`}
            >
              {portfolio.unrealizedPct >= 0 ? '+' : ''}
              {portfolio.unrealizedPct.toFixed(2)}%
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
            Total equity
          </div>
          <div
            className={`text-2xl font-bold tabular-nums ${
              portfolio.totalPct >= 0 ? 'text-bull' : 'text-bear'
            }`}
          >
            {portfolio.totalPct >= 0 ? '+' : ''}
            {portfolio.totalPct.toFixed(2)}%
          </div>
        </div>
      </div>
    </div>
  ) : null;
  const BulkBar = (
    <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2 text-xs">
      <div className="text-muted-foreground">
        {alerts ? `${alerts.length} active` : 'Loading…'}
      </div>
      <Button
        size="sm"
        variant="subtle"
        onClick={handleBulkSubscribe}
        disabled={bulkBusy}
        className="gap-1"
      >
        {bulkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LayersIcon className="h-3.5 w-3.5" />}
        Subscribe all · 1d EMA(5) × EMA(10)
      </Button>
    </div>
  );

  if (!alerts) {
    return (
      <>
        {PortfolioBanner}
        {BulkBar}
        <div className="flex h-32 items-center justify-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      </>
    );
  }
  if (alerts.length === 0) {
    return (
      <>
        {PortfolioBanner}
        {BulkBar}
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <div className="rounded-full bg-accent/10 p-3"><BellRing className="h-5 w-5 text-accent" /></div>
          <div className="text-sm font-medium">No alerts yet</div>
          <div className="text-xs text-muted-foreground">
            Create one from the "New" tab, or click "Subscribe all" above.
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      {PortfolioBanner}
      {BulkBar}
      <div className="divide-y divide-border/60">
        {alerts.map((a) => (
          <AlertRow key={a.id} alert={a} onChange={reload} />
        ))}
      </div>
    </>
  );
}

function AlertRow({ alert, onChange }: { alert: AlertDefinition; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [backtest, setBacktest] = useState<BacktestResponse | null>(null);
  const [btOpen, setBtOpen] = useState(false);
  const [btRunning, setBtRunning] = useState(false);
  const [optOpen, setOptOpen] = useState(false);
  const [wfResult, setWfResult] = useState<WalkForwardResponse | null>(null);
  const [wfOpen, setWfOpen] = useState(false);
  const [wfRunning, setWfRunning] = useState(false);
  const [paperOpen, setPaperOpen] = useState(false);
  const [sizerOpen, setSizerOpen] = useState(false);

  const handleBacktest = async () => {
    setBtRunning(true);
    setBtOpen(true);
    try {
      const r = await runBacktest(alert.id);
      setBacktest(r);
    } catch (err) {
      toast({ title: 'Backtest failed', description: String(err), tone: 'error' });
      setBtOpen(false);
    } finally {
      setBtRunning(false);
    }
  };

  const handleWalkForward = async () => {
    setWfRunning(true);
    setWfOpen(true);
    try {
      // 250 train / 60 test is a sensible default for 1d (~1y train, ~2mo test) and
      // scales fine for lower TFs since we ask the route for 1500 bars regardless.
      const r = await runWalkForward(alert.id, { trainBars: 250, testBars: 60 });
      setWfResult(r);
    } catch (err) {
      toast({ title: 'Walk-forward failed', description: String(err), tone: 'error' });
      setWfOpen(false);
    } finally {
      setWfRunning(false);
    }
  };

  const handleTogglePaper = async () => {
    if (alert.type !== 'ma_cross') return; // paper-toggle via PUT is ma_cross-only
    const next = !alert.config.delivery.paper;
    try {
      await updateAlert(alert.id, {
        config: {
          ...alert.config,
          delivery: { ...alert.config.delivery, paper: next },
        },
      });
      toast({
        title: next ? 'Paper-trading on' : 'Paper-trading off',
        description: next
          ? 'Virtual positions will open on the next cross.'
          : 'Existing virtual positions stay; new fires skip paper book-keeping.',
        tone: 'success',
      });
      onChange();
    } catch (err) {
      toast({ title: 'Toggle failed', description: String(err), tone: 'error' });
    }
  };

  const handleApplyCombo = async (combo: OptimizerCombo) => {
    if (!window.confirm(
      `Replace this alert's config with the optimized combo?\n\n` +
        `${combo.config.ma.type.toUpperCase()}(${combo.config.ma.length}) × ${combo.config.crossWith?.type.toUpperCase()}(${combo.config.crossWith?.length})\n` +
        `Backtest: +${combo.summary.totalReturnPct.toFixed(1)}% return · ${(combo.summary.winRate * 100).toFixed(0)}% win · DD -${combo.summary.maxDrawdownPct.toFixed(1)}% · ${combo.summary.trades} trades`,
    )) return;
    try {
      await updateAlert(alert.id, { config: combo.config });
      toast({ title: 'Alert config updated', tone: 'success' });
      setOptOpen(false);
      onChange();
    } catch (err) {
      toast({ title: 'Apply failed', description: String(err), tone: 'error' });
    }
  };

  const handleToggle = async () => {
    setBusy(true);
    try {
      await toggleAlert(alert.id);
      toast({ title: alert.enabled ? 'Alert paused' : 'Alert started', tone: 'success' });
      onChange();
    } catch (err) {
      toast({ title: 'Failed', description: String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const handleDelete = async () => {
    const desc = alert.type === 'ma_cross'
      ? `${alert.config.labels.buy}/${alert.config.labels.sell}`
      : alert.config.label;
    if (!window.confirm(`Delete alert "${desc}" on ${formatSymbolLabel(alert.symbol)}?`)) return;
    setBusy(true);
    try {
      await deleteAlert(alert.id);
      toast({ title: 'Alert deleted', tone: 'success' });
      onChange();
    } catch (err) {
      toast({ title: 'Failed', description: String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">{formatSymbolLabel(alert.symbol)}</span>
          <Badge tone={alert.enabled ? 'bull' : 'muted'}>{alert.enabled ? 'LIVE' : 'PAUSED'}</Badge>
          <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {alert.interval} ·{' '}
            {alert.type === 'ma_cross'
              ? alert.config.crossWith
                ? `${alert.config.ma.type.toUpperCase()}(${alert.config.ma.length}) × ${alert.config.crossWith.type.toUpperCase()}(${alert.config.crossWith.length})`
                : `${alert.config.ma.type.toUpperCase()}(${alert.config.ma.length}) ${alert.config.ma.source}`
              : 'indicator'}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
          {alert.type === 'ma_cross' ? (
            <>
              <span>🟢 {alert.config.labels.buy}</span>
              <span>·</span>
              <span>🔴 {alert.config.labels.sell}</span>
              <span>·</span>
            </>
          ) : (
            <>
              <span>{alert.config.side === 'buy' ? '🟢' : '🔴'} {alert.config.label}</span>
              <span>·</span>
            </>
          )}
          <span>{alert.config.timezone}</span>
          {alert.config.delivery.telegram ? <Badge tone="accent">telegram</Badge> : null}
          {alert.config.delivery.web ? <Badge tone="muted">web</Badge> : null}
          {alert.lastFiredAt ? (
            <span className="ml-2">last fire {formatRelativeTime(alert.lastFiredAt)}</span>
          ) : (
            <span className="ml-2">no fires yet</span>
          )}
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy || btRunning}
        onClick={handleBacktest}
        title="Run backtest"
        className="px-2"
      >
        {btRunning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Activity className="h-3.5 w-3.5 text-accent" />
        )}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => setOptOpen(true)}
        title="Peak performance — best settings"
        className="px-2"
      >
        <Sliders className="h-3.5 w-3.5 text-accent" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy || wfRunning}
        onClick={handleWalkForward}
        title="Walk-forward analysis"
        className="px-2"
      >
        {wfRunning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Shuffle className="h-3.5 w-3.5 text-accent" />
        )}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => setPaperOpen(true)}
        title={alert.config.delivery.paper ? 'Paper trades (on)' : 'Paper trades (off)'}
        className="px-2"
      >
        <ClipboardList
          className={`h-3.5 w-3.5 ${
            alert.config.delivery.paper ? 'text-bull' : 'text-muted-foreground'
          }`}
        />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => setSizerOpen(true)}
        title="Position sizer"
        className="px-2"
      >
        <Calculator className="h-3.5 w-3.5 text-accent" />
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={handleToggle} title={alert.enabled ? 'Pause' : 'Start'}>
        <Power className={`h-3.5 w-3.5 ${alert.enabled ? 'text-bull' : 'text-muted-foreground'}`} />
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={handleDelete} title="Delete">
        <Trash2 className="h-3.5 w-3.5 text-bear" />
      </Button>
      <BacktestModal
        open={btOpen}
        onOpenChange={setBtOpen}
        running={btRunning}
        result={backtest}
        alert={alert}
      />
      <OptimizerModal
        open={optOpen}
        onOpenChange={setOptOpen}
        alert={alert}
        onApply={handleApplyCombo}
      />
      <WalkForwardModal
        open={wfOpen}
        onOpenChange={setWfOpen}
        running={wfRunning}
        result={wfResult}
        alert={alert}
      />
      <PaperTradesModal
        open={paperOpen}
        onOpenChange={setPaperOpen}
        alert={alert}
        onToggle={handleTogglePaper}
      />
      <SizerModal open={sizerOpen} onOpenChange={setSizerOpen} alert={alert} />
    </div>
  );
}

/* ────────────────────────────────────────────────────────── Position sizer modal */

function SizerModal({
  open,
  onOpenChange,
  alert,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  alert: AlertDefinition;
}) {
  // Sensible defaults: $10k balance, 1% risk, 30 SL pips, $10/pip (standard-lot EURUSD).
  const [balance, setBalance] = useState(10000);
  const [riskPercent, setRiskPercent] = useState(1);
  const [riskAmount, setRiskAmount] = useState(100);
  const [slPips, setSlPips] = useState(30);
  const [pipValue, setPipValue] = useState(10);
  const [fixedLots, setFixedLots] = useState(0.1);
  const [result, setResult] = useState<SizerPreviewResponse | null>(null);
  const [busy, setBusy] = useState(false);

  const runPreview = useCallback(async () => {
    setBusy(true);
    try {
      const body: SizerPreviewBody = {
        balance,
        riskPercent,
        riskAmount,
        slPips,
        pipValue,
        fixedLots,
      };
      const r = await runSizerPreview(alert.id, body);
      setResult(r);
    } catch (err) {
      toast({ title: 'Sizer failed', description: String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }, [alert.id, balance, riskPercent, riskAmount, slPips, pipValue, fixedLots]);

  // Auto-run on first open and whenever the user adjusts inputs.
  useEffect(() => {
    if (!open) return;
    void runPreview();
  }, [open, runPreview]);

  const fmt = (n: number, d = 2) => n.toFixed(d);
  const TONES: Record<string, 'bull' | 'bear' | 'accent' | 'muted'> = {
    fixed_lots: 'muted',
    risk_percent: 'accent',
    cash_risk: 'accent',
    kelly: 'bull',
    atr_scaled: 'muted',
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-4 w-4 text-accent" />
            Position sizer · {formatSymbolLabel(alert.symbol)} · {alert.interval}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Lot size recommendations across sizing modes. Kelly uses the backtest's
            win-rate × payoff. Adjust the inputs and the preview updates live.
          </p>
        </DialogHeader>
        <div className="px-5 pb-4 text-xs">
          <div className="grid grid-cols-3 gap-2">
            <Field label="Balance ($)">
              <Input
                type="number"
                value={balance}
                onChange={(e) => setBalance(Number(e.target.value) || 0)}
              />
            </Field>
            <Field label="Risk %">
              <Input
                type="number"
                step={0.1}
                value={riskPercent}
                onChange={(e) => setRiskPercent(Number(e.target.value) || 0)}
              />
            </Field>
            <Field label="Risk $">
              <Input
                type="number"
                value={riskAmount}
                onChange={(e) => setRiskAmount(Number(e.target.value) || 0)}
              />
            </Field>
            <Field label="SL pips">
              <Input
                type="number"
                value={slPips}
                onChange={(e) => setSlPips(Number(e.target.value) || 0)}
              />
            </Field>
            <Field label="$ / pip / lot">
              <Input
                type="number"
                value={pipValue}
                onChange={(e) => setPipValue(Number(e.target.value) || 0)}
              />
            </Field>
            <Field label="Fixed lots">
              <Input
                type="number"
                step={0.01}
                value={fixedLots}
                onChange={(e) => setFixedLots(Number(e.target.value) || 0)}
              />
            </Field>
          </div>
          {result ? (
            <>
              <div className="mt-3 grid grid-cols-4 gap-2">
                <Stat label="Trades" value={String(result.backtest.trades)} />
                <Stat label="Win rate" value={`${(result.backtest.winRate * 100).toFixed(1)}%`} />
                <Stat
                  label="Avg win"
                  value={`+${fmt(result.backtest.avgWinPct)}%`}
                  tone="bull"
                />
                <Stat
                  label="Avg loss"
                  value={`${fmt(result.backtest.avgLossPct)}%`}
                  tone="bear"
                />
              </div>
              <div className="mt-3 overflow-y-auto rounded-md border border-border/70 scroll-thin">
                <table className="w-full text-[11px] tabular-nums">
                  <thead className="sticky top-0 bg-surface text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1 text-left">Mode</th>
                      <th className="px-2 py-1 text-right">Lots</th>
                      <th className="px-2 py-1 text-right">Risk $</th>
                      <th className="px-2 py-1 text-left">Formula / note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row) => (
                      <tr key={row.mode} className="border-t border-border/40 align-top">
                        <td className="px-2 py-1.5">
                          <Badge tone={TONES[row.mode] ?? 'muted'}>
                            {row.mode.replace('_', ' ')}
                          </Badge>
                        </td>
                        <td className="px-2 py-1.5 text-right font-semibold">
                          {row.unavailable ? '—' : row.lots.toFixed(2)}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {row.unavailable ? '—' : `$${row.riskAmount.toFixed(2)}`}
                        </td>
                        <td className="px-2 py-1.5 text-[10px] text-muted-foreground">
                          {row.unavailable ? (
                            <span className="text-warn">{row.unavailable}</span>
                          ) : (
                            row.formula
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[10px] text-muted-foreground">
                Kelly uses fractional 0.25 — drop full Kelly into a live account at your
                own risk. ATR-scaled assumes 4-decimal forex pip step (will undershoot
                on crypto/JPY; pick a different mode for those).
              </p>
            </>
          ) : busy ? (
            <div className="mt-4 flex h-32 items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ────────────────────────────────────────────────────────── Paper trades modal */

function PaperTradesModal({
  open,
  onOpenChange,
  alert,
  onToggle,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  alert: AlertDefinition;
  onToggle: () => void | Promise<void>;
}) {
  const [trades, setTrades] = useState<PaperTrade[] | null>(null);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    try {
      setTrades(await fetchPaperTrades(alert.id, 100));
    } catch {
      setTrades([]);
    }
  }, [alert.id]);
  useEffect(() => {
    if (!open) return;
    void reload();
    // 3s gives a TradingView-ish live feel without hammering the API. Mark-to-market
    // is cheap (one cache read per open position) so this scales fine.
    const id = setInterval(() => void reload(), 3_000);
    return () => clearInterval(id);
  }, [open, reload]);

  const handleReset = async (wipe: boolean) => {
    const msg = wipe
      ? 'Wipe ALL paper trade history for this alert?\n\nClosed + open positions deleted. Cannot undo.'
      : 'Close every open paper position for this alert at break-even (pnl = 0)?\n\nClosed history is preserved.';
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      await resetPaperTrades(alert.id, wipe);
      await reload();
      toast({ title: wipe ? 'Paper history wiped' : 'Open positions closed', tone: 'success' });
    } catch (err) {
      toast({ title: 'Failed', description: String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const openTrade = trades?.find((t) => t.status === 'open');
  const closed = trades?.filter((t) => t.status === 'closed') ?? [];
  const wins = closed.filter((t) => (t.pnlPercent ?? 0) > 0).length;
  const losses = closed.filter((t) => (t.pnlPercent ?? 0) <= 0).length;
  const totalReturn = closed.reduce((acc, t) => acc + (t.pnlPercent ?? 0), 0);
  const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0;
  const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-accent" />
            Paper trades · {formatSymbolLabel(alert.symbol)} · {alert.interval}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Virtual positions auto-opened by the engine on each cross fire. No real orders,
            no MT5 — pure book-keeping so you can sanity-check this alert's live edge.
          </p>
        </DialogHeader>
        <div className="px-5 pb-4 text-xs">
          <div className="mb-3 flex items-center justify-between rounded-md border border-border/70 bg-surface-raised px-3 py-2">
            <div>
              <div className="font-semibold">
                Paper-trading{' '}
                <Badge tone={alert.config.delivery.paper ? 'bull' : 'muted'}>
                  {alert.config.delivery.paper ? 'ON' : 'OFF'}
                </Badge>
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                Toggle to start/stop virtual position book-keeping on this alert's fires.
              </div>
            </div>
            <Switch
              checked={!!alert.config.delivery.paper}
              onCheckedChange={() => void onToggle()}
            />
          </div>

          {trades == null ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-2">
                <Stat label="Closed" value={String(closed.length)} />
                <Stat label="Win rate" value={`${winRate.toFixed(1)}%`} />
                <Stat
                  label="Total return"
                  value={fmtPct(totalReturn)}
                  tone={totalReturn >= 0 ? 'bull' : 'bear'}
                />
                <Stat
                  label="W / L"
                  value={`${wins} / ${losses}`}
                />
              </div>
              {openTrade ? (
                <LiveOpenPositionCard trade={openTrade} />
              ) : (
                <div className="mt-3 rounded-md border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
                  No open position. Fires until the next cross.
                </div>
              )}
              <div className="mt-3">
                <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Closed trades ({closed.length})
                </div>
                <div className="max-h-[260px] overflow-y-auto rounded-md border border-border/70 scroll-thin">
                  <table className="w-full text-[11px] tabular-nums">
                    <thead className="sticky top-0 bg-surface text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1 text-left">Side</th>
                        <th className="px-2 py-1 text-right">Entry</th>
                        <th className="px-2 py-1 text-right">Exit</th>
                        <th className="px-2 py-1 text-right">PnL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {closed.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-2 py-3 text-center text-muted-foreground">
                            None yet.
                          </td>
                        </tr>
                      ) : (
                        closed.slice(0, 50).map((t) => (
                          <tr key={t.id} className="border-t border-border/40">
                            <td className="px-2 py-1">
                              <Badge tone={t.side === 'buy' ? 'bull' : 'bear'}>
                                {t.side.toUpperCase()}
                              </Badge>
                            </td>
                            <td className="px-2 py-1 text-right">{t.entryPrice.toFixed(4)}</td>
                            <td className="px-2 py-1 text-right">
                              {t.exitPrice ? t.exitPrice.toFixed(4) : '—'}
                            </td>
                            <td
                              className={`px-2 py-1 text-right ${
                                (t.pnlPercent ?? 0) >= 0 ? 'text-bull' : 'text-bear'
                              }`}
                            >
                              {fmtPct(t.pnlPercent ?? 0)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void handleReset(false)}
                  className="gap-1"
                >
                  Close open
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void handleReset(true)}
                  className="gap-1 text-bear"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Wipe history
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Live-PnL open-position card. The parent polls every 3s and re-renders this with
 * fresh `trade` props; we flash the row briefly on each tick so the user gets the
 * TradingView "blink on update" cue.
 */
function LiveOpenPositionCard({ trade }: { trade: PaperTrade }) {
  // Pulse hint: changes every render so the CSS keyframe re-fires on each tick.
  const pulseKey = `${trade.currentPrice ?? trade.entryPrice}-${trade.markedAt ?? 0}`;
  const upnl = trade.unrealizedPct ?? 0;
  const tone = upnl >= 0 ? 'bull' : 'bear';
  const cur = trade.currentPrice ?? trade.entryPrice;
  const sinceMs = Date.now() - trade.entryTime;
  const ageMin = Math.floor(sinceMs / 60_000);
  const ageHr = Math.floor(ageMin / 60);
  const ageStr = ageHr > 0 ? `${ageHr}h ${ageMin % 60}m` : `${ageMin}m`;
  return (
    <div
      key={pulseKey}
      className={`mt-3 rounded-md border px-3 py-2.5 transition-colors duration-300 ${
        tone === 'bull'
          ? 'border-bull/50 bg-bull/10'
          : 'border-bear/50 bg-bear/10'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge tone={trade.side === 'buy' ? 'bull' : 'bear'}>
            {trade.side.toUpperCase()} · OPEN
          </Badge>
          <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            held {ageStr}
          </span>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-semibold tabular-nums ${tone === 'bull' ? 'text-bull' : 'text-bear'}`}>
            {upnl >= 0 ? '+' : ''}
            {upnl.toFixed(2)}%
          </div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            unrealized
          </div>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <div className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Entry</div>
          <div className="tabular-nums">{trade.entryPrice.toFixed(4)}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">Mark</div>
          <div className="tabular-nums">{cur.toFixed(4)}</div>
        </div>
        <div>
          <div className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
            Move
          </div>
          <div className={`tabular-nums ${tone === 'bull' ? 'text-bull' : 'text-bear'}`}>
            {(cur - trade.entryPrice >= 0 ? '+' : '') + (cur - trade.entryPrice).toFixed(4)}
          </div>
        </div>
      </div>
      <div className="mt-1 text-[9px] text-muted-foreground">
        entered {new Date(trade.entryTime).toLocaleString()}
        {trade.markedAt ? ` · marked ${new Date(trade.markedAt).toLocaleTimeString()}` : ''}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── Walk-forward modal */

function WalkForwardModal({
  open,
  onOpenChange,
  running,
  result,
  alert,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  running: boolean;
  result: WalkForwardResponse | null;
  alert: AlertDefinition;
}) {
  const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
  const a = result?.aggregate;
  // Robustness tone: ≥0.7 = strong (bull), 0.3-0.7 = ok (muted), <0.3 = curve-fit (bear).
  const robustnessTone =
    a == null
      ? 'muted'
      : a.robustness >= 0.7
        ? 'bull'
        : a.robustness >= 0.3
          ? 'warn'
          : 'bear';
  const robustnessLabel =
    a == null
      ? ''
      : a.robustness >= 0.7
        ? 'Generalises'
        : a.robustness >= 0.3
          ? 'Marginal'
          : 'Curve-fit';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shuffle className="h-4 w-4 text-accent" />
            Walk-forward · {formatSymbolLabel(alert.symbol)} · {alert.interval}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Train on a 250-bar lookback, lock the optimizer's pick, apply to the next
            60 bars. Repeat across the history. Robustness = OOS Sharpe ÷ mean train Sharpe.
          </p>
        </DialogHeader>
        <div className="px-5 pb-4 text-xs">
          {running || !result || !a ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-2">
                <Stat label="Windows" value={String(a.windows)} />
                <Stat
                  label="OOS return"
                  value={fmtPct(a.oosReturnPct)}
                  tone={a.oosReturnPct >= 0 ? 'bull' : 'bear'}
                />
                <Stat label="OOS trades" value={String(a.oosTrades)} />
                <Stat label="OOS win" value={`${(a.oosWinRate * 100).toFixed(1)}%`} />
                <Stat
                  label="OOS max DD"
                  value={`-${a.oosMaxDrawdownPct.toFixed(1)}%`}
                  tone="bear"
                />
                <Stat label="OOS Sharpe" value={a.oosSharpe.toFixed(2)} />
                <Stat label="Mean train Sharpe" value={a.meanTrainSharpe.toFixed(2)} />
                <Stat
                  label={`Robustness · ${robustnessLabel}`}
                  value={a.robustness.toFixed(2)}
                  tone={robustnessTone === 'warn' ? undefined : (robustnessTone as 'bull' | 'bear')}
                />
              </div>
              <div className="mt-3 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {result.barsTested} bars tested
              </div>
              <div className="mt-2 max-h-[300px] overflow-y-auto rounded-md border border-border/70 scroll-thin">
                <table className="w-full text-[11px] tabular-nums">
                  <thead className="sticky top-0 bg-surface text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1 text-left">#</th>
                      <th className="px-2 py-1 text-left">Picked</th>
                      <th className="px-2 py-1 text-right">Train Sharpe</th>
                      <th className="px-2 py-1 text-right">Test ret</th>
                      <th className="px-2 py-1 text-right">Test trades</th>
                      <th className="px-2 py-1 text-right">Test DD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.windows.map((w, i) => (
                      <tr key={i} className="border-t border-border/40">
                        <td className="px-2 py-1 text-muted-foreground">{i + 1}</td>
                        <td className="px-2 py-1">
                          {w.pickedConfig.ma.type.toUpperCase()}({w.pickedConfig.ma.length}) ×{' '}
                          {w.pickedConfig.crossWith?.type.toUpperCase()}(
                          {w.pickedConfig.crossWith?.length})
                        </td>
                        <td className="px-2 py-1 text-right">
                          {w.trainSummary.sharpe.toFixed(2)}
                        </td>
                        <td
                          className={`px-2 py-1 text-right ${
                            w.testSummary.totalReturnPct >= 0 ? 'text-bull' : 'text-bear'
                          }`}
                        >
                          {fmtPct(w.testSummary.totalReturnPct)}
                        </td>
                        <td className="px-2 py-1 text-right">{w.testSummary.trades}</td>
                        <td className="px-2 py-1 text-right text-bear">
                          -{w.testSummary.maxDrawdownPct.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[10px] text-muted-foreground">
                Robustness ≥ 0.7 = generalises; 0.3-0.7 = marginal; &lt; 0.3 = curve-fit.
                v1 fixes 250/60 split.
              </p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ────────────────────────────────────────────────────────── Optimizer modal */

const OBJECTIVES: { key: OptimizeObjective; label: string; help: string }[] = [
  { key: 'profit', label: '💰 Profit', help: 'Ranked by total return (most money first).' },
  { key: 'accuracy', label: '🎯 Accuracy', help: 'Ranked by win rate, then per-trade expectancy.' },
  { key: 'balanced', label: '⚖️ Balanced', help: 'Risk-adjusted blend of return, edge, drawdown & hit-rate.' },
];

function fmtMoney(n: number): string {
  const sign = n < 0 ? '−' : '+';
  const a = Math.abs(n);
  const body = a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(1)}K` : `$${a.toFixed(0)}`;
  return sign + body;
}

/**
 * Peak Performance — finds the best parameter settings for this MA-cross strategy on REAL candles.
 * Pick an objective (profit / accuracy / balanced) + an accuracy floor; the server grid-sweeps,
 * backtests each combo for real, applies robustness guards, and returns the ranked top-10. $ is
 * derived client-side from the real % return × your account size — never fabricated, never ranked on.
 */
function OptimizerModal({
  open,
  onOpenChange,
  alert,
  onApply,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  alert: AlertDefinition;
  onApply: (combo: OptimizerCombo) => void | Promise<void>;
}) {
  const [objective, setObjective] = useState<OptimizeObjective>('balanced');
  const [minWinPct, setMinWinPct] = useState(0);
  const [accountSize, setAccountSize] = useState(10000);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<OptimizeResponse | null>(null);

  useEffect(() => {
    try {
      const v = Number(localStorage.getItem('sc.optAccountSize.v1'));
      if (Number.isFinite(v) && v > 0) setAccountSize(v);
    } catch {
      /* ignore */
    }
  }, []);

  const run = async (obj: OptimizeObjective = objective, minWin: number = minWinPct): Promise<void> => {
    setRunning(true);
    try {
      const r = await runOptimize(alert.id, {
        objective: obj,
        minWinRate: minWin > 0 ? minWin / 100 : undefined,
        topN: 10,
      });
      setResult(r);
    } catch (err) {
      toast({ title: 'Could not find peak settings', description: String(err), tone: 'error' });
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    if (open && !result && !running) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const setSize = (v: number): void => {
    setAccountSize(v);
    try {
      localStorage.setItem('sc.optAccountSize.v1', String(v));
    } catch {
      /* ignore */
    }
  };

  const fmtPct = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
  const objHelp = OBJECTIVES.find((o) => o.key === objective)?.help ?? '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-accent" />
            Peak Performance · {formatSymbolLabel(alert.symbol)} · {alert.interval}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Real backtest of every fast/slow MA setting on the last available candles. {objHelp}
          </p>
        </DialogHeader>
        <div className="space-y-3 px-5 pb-4 text-xs">
          {/* Controls */}
          <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Optimise for</div>
              <div className="inline-flex rounded-md border border-border bg-surface-sunken p-0.5">
                {OBJECTIVES.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => {
                      setObjective(o.key);
                      void run(o.key, minWinPct);
                    }}
                    className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      objective === o.key ? 'bg-surface-raised text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="min-w-[180px]">
              <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Min win rate ≥ <span className="text-foreground">{minWinPct}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={90}
                step={5}
                value={minWinPct}
                onChange={(e) => setMinWinPct(Number(e.target.value))}
                onPointerUp={() => void run()}
                className="w-full accent-accent"
              />
            </div>
            <label className="block">
              <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Account size</div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">$</span>
                <input
                  type="number"
                  min={0}
                  step={1000}
                  value={accountSize}
                  onChange={(e) => setSize(Math.max(0, Number(e.target.value) || 0))}
                  className="h-7 w-28 rounded-md border border-border bg-surface-sunken px-2 text-xs tabular-nums"
                />
              </div>
            </label>
            <Button size="sm" className="h-8 px-3" onClick={() => void run()} disabled={running}>
              {running ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Find peak settings
            </Button>
          </div>

          {running && !result ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : result ? (
            <>
              <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {result.evaluated} settings tested · {result.qualifying} qualified
                {result.appliedMinTrades ? ` · ≥${result.appliedMinTrades} trades` : ''}
                {result.barsTested ? ` · ${result.barsTested} bars` : ''}
              </div>
              {result.note ? (
                <div className="rounded-md border border-warn/40 bg-warn/10 px-2 py-1.5 text-[11px] text-warn">
                  {result.note}
                </div>
              ) : null}
              {result.combos.length > 0 ? (
                <div className="max-h-[400px] overflow-y-auto rounded-md border border-border/70 scroll-thin">
                  <table className="w-full text-[11px] tabular-nums">
                    <thead className="sticky top-0 bg-surface text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1 text-left">#</th>
                        <th className="px-2 py-1 text-left">Setting</th>
                        <th className="px-2 py-1 text-right">Profit</th>
                        <th className="px-2 py-1 text-right">Win %</th>
                        <th className="px-2 py-1 text-right">Trades</th>
                        <th className="px-2 py-1 text-right">Max DD</th>
                        <th className="px-2 py-1 text-right">PF</th>
                        <th className="px-2 py-1 text-right">Exp/trade</th>
                        <th className="px-2 py-1 text-left">Quality</th>
                        <th className="px-2 py-1"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.combos.map((c, i) => {
                        const cur = alert.type === 'ma_cross' ? alert.config : null;
                        const isCurrent =
                          !!cur && c.config.ma.length === cur.ma.length && c.config.crossWith?.length === cur.crossWith?.length;
                        const m = c.metrics;
                        const dollars = (accountSize * c.summary.totalReturnPct) / 100;
                        const tone = m?.robustness.tone ?? 'green';
                        const chip =
                          tone === 'red' ? 'bg-bear/15 text-bear' : tone === 'amber' ? 'bg-warn/15 text-warn' : 'bg-bull/15 text-bull';
                        const flag = m?.robustness.flags[0] ?? (tone === 'green' ? 'robust' : '');
                        return (
                          <tr key={i} className={`border-t border-border/40 ${isCurrent ? 'bg-accent/10' : ''}`}>
                            <td className="px-2 py-1.5 text-left font-semibold text-muted-foreground">{m?.rank ?? i + 1}</td>
                            <td className="px-2 py-1.5">
                              <span className="font-semibold">
                                {c.config.ma.type.toUpperCase()}({c.config.ma.length}) × {c.config.crossWith?.type.toUpperCase()}(
                                {c.config.crossWith?.length})
                              </span>
                              {c.config.rsiFilter ? (
                                <span className="ml-1 text-muted-foreground">
                                  RSI {c.config.rsiFilter.buyBelow}/{c.config.rsiFilter.sellAbove}
                                </span>
                              ) : null}
                              {isCurrent ? <Badge tone="accent" className="ml-2">current</Badge> : null}
                            </td>
                            <td className={`px-2 py-1 text-right font-semibold ${dollars >= 0 ? 'text-bull' : 'text-bear'}`}>
                              {fmtMoney(dollars)}
                              <span className="block text-[9px] font-normal opacity-80">{fmtPct(c.summary.totalReturnPct)}</span>
                            </td>
                            <td className="px-2 py-1 text-right">{(c.summary.winRate * 100).toFixed(0)}%</td>
                            <td className="px-2 py-1 text-right">{c.summary.trades}</td>
                            <td className="px-2 py-1 text-right text-bear">-{c.summary.maxDrawdownPct.toFixed(1)}%</td>
                            <td className="px-2 py-1 text-right" title={Number.isFinite(c.summary.profitFactor) ? '' : 'No losing trades — capped; likely overfit/small sample'}>
                              {Number.isFinite(c.summary.profitFactor) ? c.summary.profitFactor.toFixed(2) : '∞*'}
                            </td>
                            <td className={`px-2 py-1 text-right ${(m?.expectancyPct ?? 0) >= 0 ? '' : 'text-bear'}`}>
                              {m ? `${m.expectancyPct >= 0 ? '+' : ''}${m.expectancyPct.toFixed(2)}%` : '—'}
                            </td>
                            <td className="px-2 py-1">
                              {flag ? (
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${chip}`}
                                  title={m?.robustness.flags.join(' · ') || 'no robustness concerns'}
                                >
                                  {flag}
                                </span>
                              ) : null}
                            </td>
                            <td className="px-2 py-1 text-right">
                              <Button
                                size="sm"
                                variant={isCurrent ? 'ghost' : 'subtle'}
                                onClick={() => void onApply(c)}
                                disabled={isCurrent}
                                className="h-6 px-2 text-[10px]"
                              >
                                {isCurrent ? 'Active' : 'Apply'}
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Hypothetical on <span className="text-foreground">${accountSize.toLocaleString('en-US')}</span> — compounded, NO
                fees / slippage / leverage / SL-TP / position sizing (v1 trade model). Numbers are a real backtest on the last{' '}
                {result.barsTested ?? '—'} closed candles of {formatSymbolLabel(alert.symbol)} {alert.interval}. After{' '}
                <strong>Apply</strong>, the chart redraws that setting&apos;s actual BUY/SELL crossover labels so you can verify
                the signals before trusting capital. ∞* = no losing trades (capped, usually overfit).
              </p>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ────────────────────────────────────────────────────────── Backtest modal */

function BacktestModal({
  open,
  onOpenChange,
  running,
  result,
  alert,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  running: boolean;
  result: BacktestResponse | null;
  alert: AlertDefinition;
}) {
  const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
  const fmtNum = (n: number, d = 2) => n.toFixed(d);
  const s = result?.summary;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-accent" />
            Backtest · {formatSymbolLabel(alert.symbol)} · {alert.interval}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            {alert.type === 'ma_cross' ? (
              <>
                {alert.config.crossWith
                  ? `${alert.config.ma.type.toUpperCase()}(${alert.config.ma.length}) × ${alert.config.crossWith.type.toUpperCase()}(${alert.config.crossWith.length})`
                  : `${alert.config.ma.type.toUpperCase()}(${alert.config.ma.length}) on ${alert.config.ma.source}`}
                {alert.config.rsiFilter
                  ? ` · RSI(${alert.config.rsiFilter.length}) ≤${alert.config.rsiFilter.buyBelow} / ≥${alert.config.rsiFilter.sellAbove}`
                  : ''}
              </>
            ) : null}
          </p>
        </DialogHeader>
        <div className="px-5 pb-4 text-xs">
          {running || !result ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : s ? (
            <>
              <div className="grid grid-cols-4 gap-2">
                <Stat label="Trades" value={String(s.trades)} />
                <Stat label="Win rate" value={`${(s.winRate * 100).toFixed(1)}%`} />
                <Stat
                  label="Total return"
                  value={fmtPct(s.totalReturnPct)}
                  tone={s.totalReturnPct >= 0 ? 'bull' : 'bear'}
                />
                <Stat
                  label="Max DD"
                  value={`-${fmtNum(s.maxDrawdownPct)}%`}
                  tone="bear"
                />
                <Stat label="Sharpe" value={fmtNum(s.sharpe)} />
                <Stat
                  label="Profit factor"
                  value={Number.isFinite(s.profitFactor) ? fmtNum(s.profitFactor) : '∞'}
                />
                <Stat label="Avg win" value={fmtPct(s.avgWinPct)} tone="bull" />
                <Stat label="Avg loss" value={fmtPct(s.avgLossPct)} tone="bear" />
              </div>
              <div className="mt-3 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {result.barsTested} bars · avg hold {fmtNum(s.avgBars, 1)} bars · {s.wins}W /{' '}
                {s.losses}L
              </div>
              <div className="mt-3">
                <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Recent trades
                </div>
                <div className="max-h-[260px] overflow-y-auto rounded-md border border-border/70 scroll-thin">
                  <table className="w-full text-[11px] tabular-nums">
                    <thead className="sticky top-0 bg-surface text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1 text-left">Side</th>
                        <th className="px-2 py-1 text-right">Entry</th>
                        <th className="px-2 py-1 text-right">Exit</th>
                        <th className="px-2 py-1 text-right">Bars</th>
                        <th className="px-2 py-1 text-right">PnL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.trades
                        .slice(-25)
                        .reverse()
                        .map((t, i) => (
                          <tr key={i} className="border-t border-border/40">
                            <td className="px-2 py-1">
                              <Badge tone={t.side === 'buy' ? 'bull' : 'bear'}>
                                {t.side.toUpperCase()}
                              </Badge>
                            </td>
                            <td className="px-2 py-1 text-right">{t.entryPrice.toFixed(4)}</td>
                            <td className="px-2 py-1 text-right">{t.exitPrice.toFixed(4)}</td>
                            <td className="px-2 py-1 text-right">{t.bars}</td>
                            <td
                              className={`px-2 py-1 text-right ${
                                t.pnlPercent >= 0 ? 'text-bull' : 'text-bear'
                              }`}
                            >
                              {fmtPct(t.pnlPercent)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <p className="mt-3 text-[10px] text-muted-foreground">
                v1 model: enter on cross (gated by RSI when configured), exit on reverse cross.
                No SL/TP, no fees, no slippage. Use this for shape — not as a backtest of record.
              </p>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'bull' | 'bear';
}) {
  const toneCls = tone === 'bull' ? 'text-bull' : tone === 'bear' ? 'text-bear' : 'text-foreground';
  return (
    <div className="rounded-md border border-border/70 bg-surface-raised/40 p-2">
      <div className="text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold ${toneCls}`}>{value}</div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── Create form */

function CreateAlertForm({ initialSymbol, onCreated }: { initialSymbol: string; onCreated: () => void }) {
  const [draft, setDraft] = useState<DraftAlert>({
    symbol: initialSymbol,
    interval: '1h',
    enabled: true,
    config: DEFAULT_CONFIG,
  });
  const [submitting, setSubmitting] = useState(false);

  const update = useCallback((patch: Partial<DraftAlert>) => {
    setDraft((d) => ({ ...d, ...patch }));
  }, []);
  const updateConfig = useCallback((patch: Partial<MaCrossAlertConfig>) => {
    setDraft((d) => ({ ...d, config: { ...d.config, ...patch } }));
  }, []);
  const updateMa = (patch: Partial<MaCrossAlertConfig['ma']>) => {
    setDraft((d) => ({ ...d, config: { ...d.config, ma: { ...d.config.ma, ...patch } } }));
  };
  const updateLabels = (patch: Partial<MaCrossAlertConfig['labels']>) => {
    setDraft((d) => ({ ...d, config: { ...d.config, labels: { ...d.config.labels, ...patch } } }));
  };
  const updateDelivery = (patch: Partial<MaCrossAlertConfig['delivery']>) => {
    setDraft((d) => ({ ...d, config: { ...d.config, delivery: { ...d.config.delivery, ...patch } } }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await createAlert({
        symbol: draft.symbol,
        interval: draft.interval,
        type: 'ma_cross',
        enabled: draft.enabled,
        config: draft.config,
      });
      toast({
        title: 'Alert created',
        description: `${formatSymbolLabel(draft.symbol)} · ${draft.config.ma.type.toUpperCase()}(${draft.config.ma.length}) · ${draft.interval}`,
        tone: 'success',
      });
      onCreated();
    } catch (err) {
      toast({ title: 'Could not save alert', description: String(err), tone: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 px-4 py-4 text-xs">
      <Field label="Symbol">
        <SymbolPicker value={draft.symbol} onChange={(v) => update({ symbol: v })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Timeframe">
          <Select value={draft.interval} onValueChange={(v) => update({ interval: v as Interval })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {INTERVALS.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Timezone">
          <Select value={draft.config.timezone} onValueChange={(v) => updateConfig({ timezone: v })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIMEZONE_OPTIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="MA type">
          <Select value={draft.config.ma.type} onValueChange={(v) => updateMa({ type: v as MaCrossAlertConfig['ma']['type'] })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MA_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Length">
          <Input
            type="number"
            min={2}
            max={500}
            value={draft.config.ma.length}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 2 && v <= 500) updateMa({ length: v });
            }}
          />
        </Field>
        <Field label="Source">
          <Select value={draft.config.ma.source} onValueChange={(v) => updateMa({ source: v as MaCrossAlertConfig['ma']['source'] })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MA_SOURCE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Buy label">
          <Input value={draft.config.labels.buy} onChange={(e) => updateLabels({ buy: e.target.value })} />
        </Field>
        <Field label="Sell label">
          <Input value={draft.config.labels.sell} onChange={(e) => updateLabels({ sell: e.target.value })} />
        </Field>
      </div>
      <div className="flex items-center justify-between rounded-md border border-border/70 bg-surface-raised px-3 py-2">
        <div className="text-xs">
          <div className="font-semibold">Web alert</div>
          <div className="text-muted-foreground">Toast on screen + label on the chart.</div>
        </div>
        <Switch checked={draft.config.delivery.web} onCheckedChange={(v) => updateDelivery({ web: v })} />
      </div>
      <div className="flex items-center justify-between rounded-md border border-border/70 bg-surface-raised px-3 py-2">
        <div className="text-xs">
          <div className="font-semibold">Telegram</div>
          <div className="text-muted-foreground">Sends a formatted message to your configured chat.</div>
        </div>
        <Switch checked={draft.config.delivery.telegram} onCheckedChange={(v) => updateDelivery({ telegram: v })} />
      </div>
      <div className="flex items-center justify-between border-t border-border/60 pt-3">
        <div className="text-[10px] text-muted-foreground">
          Saving will start the alert immediately. Disable it from the Active tab any time.
        </div>
        <Button size="sm" onClick={handleSubmit} disabled={submitting} className="gap-1">
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Save alert
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function SymbolPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // Group the catalog into the user-facing buckets. Memoize so the dropdown
  // doesn't rebuild this on every keystroke.
  const grouped = useMemo(() => {
    const map = new Map<string, typeof SYMBOL_CATALOG>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const s of SYMBOL_CATALOG) {
      map.get(s.category)!.push(s);
    }
    return map;
  }, []);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full"><SelectValue placeholder="Pick a symbol" /></SelectTrigger>
      <SelectContent className="max-h-[420px]">
        {CATEGORY_ORDER.map((cat) => {
          const items = grouped.get(cat) ?? [];
          if (items.length === 0) return null;
          return (
            <div key={cat}>
              <div className="px-2 pb-1 pt-2 text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                {CATEGORY_LABEL[cat]}
              </div>
              {items.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
              ))}
            </div>
          );
        })}
      </SelectContent>
    </Select>
  );
}

/* ────────────────────────────────────────────────────────── History */

function EventHistory() {
  const [events, setEvents] = useState<AlertEvent[] | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const items = await fetchAlertEvents(200);
      setEvents(items);
    } catch {
      setEvents([]);
    }
  }, []);

  useEffect(() => {
    void reload();
    // Auto-refresh every 8s so new fires show up while the dialog is open.
    const id = setInterval(() => void reload(), 8_000);
    return () => clearInterval(id);
  }, [reload]);

  const handleDelete = async (id: string) => {
    setBusy(true);
    try {
      await deleteAlertEvent(id);
      setEvents((prev) => (prev ? prev.filter((e) => e.id !== id) : prev));
    } catch (err) {
      toast({ title: 'Could not delete', description: String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm('Delete ALL alert log entries?\n\nThe alerts themselves stay armed — only the fire history is wiped.')) return;
    setBusy(true);
    try {
      await clearAlertEvents();
      setEvents([]);
      toast({ title: 'Logs cleared', tone: 'success' });
    } catch (err) {
      toast({ title: 'Could not clear', description: String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const Header = (
    <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2 text-xs">
      <div className="text-muted-foreground">
        {events ? `${events.length} log entries` : 'Loading…'}
        <span className="ml-2 text-[10px] uppercase tracking-[0.14em]">auto-refresh 8s</span>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => void reload()} disabled={busy} className="gap-1">
          <Loader2 className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : 'hidden'}`} />
          Refresh
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleClearAll}
          disabled={busy || (events?.length ?? 0) === 0}
          className="gap-1 text-bear"
        >
          <Trash2 className="h-3.5 w-3.5" /> Clear all
        </Button>
      </div>
    </div>
  );

  if (!events) {
    return (
      <>
        {Header}
        <div className="flex h-32 items-center justify-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      </>
    );
  }
  if (events.length === 0) {
    return (
      <>
        {Header}
        <div className="py-10 text-center text-xs text-muted-foreground">No fires yet.</div>
      </>
    );
  }
  return (
    <>
      {Header}
      <div className="divide-y divide-border/60">
        {events.map((e) => {
          const cat = getCatalogSymbol(e.symbol)?.category;
          return (
            <div key={e.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-2 text-xs">
              <div>
                <div className="flex items-center gap-2">
                  <Badge tone={e.side === 'buy' ? 'bull' : 'bear'}>{e.side.toUpperCase()}</Badge>
                  <span className="font-semibold">{formatSymbolLabel(e.symbol)}</span>
                  <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{e.interval}</span>
                  {cat ? <span className="text-[10px] text-muted-foreground">{CATEGORY_LABEL[cat]}</span> : null}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {e.label} · {formatPrice(e.price)} · MA {formatPrice(e.maValue)}
                </div>
              </div>
              <div className="text-right text-[10px] text-muted-foreground">
                <div>{new Date(e.firedAt).toLocaleString()}</div>
                <div>{telegramBadge(e)}</div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void handleDelete(e.id)}
                disabled={busy}
                title="Delete this log entry"
                className="px-2"
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-bear" />
              </Button>
            </div>
          );
        })}
      </div>
    </>
  );
}

function telegramBadge(e: AlertEvent): React.ReactNode {
  if (e.telegram === 'sent') return <span className="text-bull">telegram sent</span>;
  if (e.telegram === 'failed') return <span className="text-bear" title={e.telegramError ?? ''}>telegram failed</span>;
  if (e.telegram === 'disabled') return <span className="text-muted-foreground">telegram off</span>;
  return null;
}

/* ────────────────────────────────────────────────────────── Telegram setup (multi-bot)
 *
 * Users may run several bots — one for swing alerts, another for scalp, etc. — and
 * route specific alert groups to specific bots. This panel lists saved bots and
 * surfaces an inline "+ Add bot" form. Per-bot Test / Toggle / Delete inline.
 *
 * The legacy single-bot `TelegramSetup` was deleted — backwards compat is handled at
 * the DB layer (migration backfills the legacy row into telegram_bots as "Default").
 */

function TelegramSetup() {
  const [bots, setBots] = useState<TelegramBot[] | null>(null);
  const [adding, setAdding] = useState(false);

  const reload = useCallback(async () => {
    try {
      const items = await fetchTelegramBots();
      setBots(items);
    } catch {
      setBots([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!bots) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3 px-4 py-3 text-xs">
      <div className="rounded-md border border-border/70 bg-surface-raised p-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground">
          How to add a bot
        </div>
        <ol className="ml-4 list-decimal space-y-1 text-[11px] text-muted-foreground">
          <li>Open Telegram and message <code className="text-foreground">@BotFather</code> → <code className="text-foreground">/newbot</code>.</li>
          <li>Copy the token. Start a chat with the new bot and send any message.</li>
          <li>Click "<strong>+ Add bot</strong>" below, paste the token, hit <strong>Auto-detect</strong>, name it (e.g. "Scalp", "Swing"), save.</li>
          <li>When creating an alert, pick which bot delivers it.</li>
        </ol>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {bots.length} bot{bots.length === 1 ? '' : 's'}
        </div>
        <Button size="sm" onClick={() => setAdding(true)} disabled={adding} className="gap-1">
          <Plus className="h-3.5 w-3.5" /> Add bot
        </Button>
      </div>

      {adding ? (
        <AddBotForm
          onClose={() => setAdding(false)}
          onCreated={async () => {
            await reload();
            setAdding(false);
          }}
        />
      ) : null}

      {bots.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <div className="rounded-full bg-accent/10 p-3">
            <SatelliteDish className="h-5 w-5 text-accent" />
          </div>
          <div className="text-sm font-medium">No Telegram bots yet</div>
          <div className="text-muted-foreground">
            Add one to start receiving alerts on your phone.
          </div>
        </div>
      ) : (
        <div className="divide-y divide-border/60 rounded-md border border-border/70">
          {bots.map((b) => (
            <BotRow key={b.id} bot={b} onChange={reload} />
          ))}
        </div>
      )}
    </div>
  );
}

function BotRow({ bot, onChange }: { bot: TelegramBot; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    setBusy(true);
    try {
      await updateTelegramBot(bot.id, { enabled: !bot.enabled });
      await onChange();
    } catch (err) {
      toast({ title: 'Toggle failed', description: String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      await testTelegramBot(bot.id);
      toast({ title: `${bot.label} · test sent`, description: 'Check your Telegram.', tone: 'success' });
    } catch (err) {
      toast({ title: `${bot.label} · test failed`, description: String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (
      !window.confirm(
        `Delete bot "${bot.label}"?\n\nAlerts routed to this bot will fall back to your first enabled bot.`,
      )
    )
      return;
    setBusy(true);
    try {
      await deleteTelegramBot(bot.id);
      await onChange();
      toast({ title: 'Bot deleted', tone: 'success' });
    } catch (err) {
      toast({ title: 'Delete failed', description: String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{bot.label}</span>
          <Badge tone={bot.enabled ? 'bull' : 'muted'}>{bot.enabled ? 'LIVE' : 'PAUSED'}</Badge>
        </div>
        <div className="text-[10px] text-muted-foreground">
          bot <code>•••{bot.botTokenSuffix}</code> · chat <code>{bot.chatId}</code>
        </div>
      </div>
      <Button size="sm" variant="ghost" onClick={test} disabled={busy} className="gap-1 px-2" title="Send test message">
        <Send className="h-3.5 w-3.5" />
      </Button>
      <Button size="sm" variant="ghost" onClick={toggle} disabled={busy} className="px-2" title={bot.enabled ? 'Pause' : 'Start'}>
        <Power className={`h-3.5 w-3.5 ${bot.enabled ? 'text-bull' : 'text-muted-foreground'}`} />
      </Button>
      <Button size="sm" variant="ghost" onClick={remove} disabled={busy} className="px-2" title="Delete">
        <Trash2 className="h-3.5 w-3.5 text-bear" />
      </Button>
    </div>
  );
}

function AddBotForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [busy, setBusy] = useState(false);

  const discover = async () => {
    if (botToken.length < 20) {
      toast({ title: 'Paste a bot token first', tone: 'warn' });
      return;
    }
    setBusy(true);
    try {
      const chats = await discoverTelegramChatsForBot(botToken);
      if (chats.length === 0) {
        toast({
          title: 'No chats yet',
          description: 'Send /start to the bot in Telegram first.',
          tone: 'warn',
          durationMs: 6000,
        });
      } else {
        // Single-chat case → fill directly; multi-chat → fill first and show picker.
        setChatId(chats[0]!.chatId);
        toast({
          title: chats.length === 1 ? 'Chat detected' : `${chats.length} chats found`,
          description: describeChat(chats[0]!),
          tone: 'success',
        });
      }
    } catch (err) {
      toast({ title: 'Auto-detect failed', description: String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!label.trim()) {
      toast({ title: 'Give the bot a label', tone: 'warn' });
      return;
    }
    if (botToken.length < 20) {
      toast({ title: 'Invalid bot token', tone: 'error' });
      return;
    }
    if (!chatId.trim()) {
      toast({ title: 'Chat ID required', tone: 'error' });
      return;
    }
    setBusy(true);
    try {
      await createTelegramBot({ label: label.trim(), botToken, chatId: chatId.trim(), enabled: true });
      toast({ title: 'Bot added', description: label, tone: 'success' });
      await onCreated();
    } catch (err) {
      toast({ title: 'Could not add bot', description: String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-accent/40 bg-accent/5 p-3">
      <div className="text-[10px] uppercase tracking-[0.14em] text-accent">Add bot</div>
      <Field label="Label (e.g. Default, Scalp, Swing)">
        <Input
          autoComplete="off"
          name={`bot-label-${Math.random().toString(36).slice(2, 7)}`}
          spellCheck={false}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Scalp"
        />
      </Field>
      <Field label="Bot token (@BotFather)">
        <Input
          type="password"
          autoComplete="off"
          name={`bot-token-${Math.random().toString(36).slice(2, 7)}`}
          spellCheck={false}
          value={botToken}
          onChange={(e) => setBotToken(e.target.value)}
          placeholder="123456:AABBCC…"
        />
      </Field>
      <Field label="Chat ID">
        <div className="flex gap-2">
          <Input
            autoComplete="off"
            name={`bot-chat-${Math.random().toString(36).slice(2, 7)}`}
            spellCheck={false}
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            placeholder="Auto-detect or paste"
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={discover}
            disabled={busy}
            className="shrink-0 gap-1 whitespace-nowrap"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            Auto-detect
          </Button>
        </div>
      </Field>
      <div className="flex items-center justify-end gap-2 pt-1">
        <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={busy} className="gap-1">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Save bot
        </Button>
      </div>
    </div>
  );
}


/* ────────────────────────────────────────────────────────── Watchlists */

type WatchlistsView = { mode: 'list' } | { mode: 'edit'; listId: string };

function WatchlistsManager() {
  const [lists, setLists] = useState<Watchlist[] | null>(null);
  const [view, setView] = useState<WatchlistsView>({ mode: 'list' });
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');

  const reload = useCallback(async () => {
    try {
      const items = await fetchWatchlists();
      setLists(items);
    } catch (err) {
      toast({ title: 'Could not load watchlists', description: String(err), tone: 'error' });
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (name.length < 1) {
      toast({ title: 'Name required', tone: 'warn' });
      return;
    }
    setBusy(true);
    try {
      const { id } = await createWatchlist(name);
      setNewName('');
      await reload();
      setView({ mode: 'edit', listId: id });
      toast({ title: 'List created', description: name, tone: 'success' });
    } catch (err) {
      toast({ title: 'Could not create list', description: String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (l: Watchlist) => {
    if (!window.confirm(`Delete watchlist "${l.name}"?\n\nAlerts already created from this list are NOT removed.`)) return;
    setBusy(true);
    try {
      await deleteWatchlist(l.id);
      await reload();
      toast({ title: 'List deleted', tone: 'success' });
    } catch (err) {
      toast({ title: 'Could not delete', description: String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  if (!lists) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (view.mode === 'edit') {
    const list = lists.find((l) => l.id === view.listId);
    if (!list) {
      return (
        <div className="px-4 py-6 text-xs text-muted-foreground">
          List not found.{' '}
          <button className="underline" onClick={() => setView({ mode: 'list' })}>
            Back
          </button>
        </div>
      );
    }
    return (
      <WatchlistEditor
        list={list}
        onSaved={async () => {
          await reload();
        }}
        onBack={() => setView({ mode: 'list' })}
      />
    );
  }

  return (
    <div className="px-4 py-3 text-xs">
      <div className="mb-3 flex items-center gap-2">
        <Input
          // Defeat Chrome's autofill, which loves to slam email addresses into any
          // free-form text input — especially inside a dialog.
          autoComplete="off"
          name={`wl-name-${Math.random().toString(36).slice(2, 7)}`}
          spellCheck={false}
          placeholder="New list name (e.g. Hedge fund FX, Crypto majors, Asia indices)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleCreate();
          }}
        />
        <Button size="sm" onClick={handleCreate} disabled={busy} className="shrink-0 gap-1 whitespace-nowrap">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Create
        </Button>
      </div>
      {lists.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <div className="rounded-full bg-accent/10 p-3">
            <Star className="h-5 w-5 text-accent" />
          </div>
          <div className="text-sm font-medium">No watchlists yet</div>
          <div className="text-muted-foreground">
            Create one above, add symbols, then bulk-subscribe MA cross alerts from inside the list.
          </div>
        </div>
      ) : (
        <div className="divide-y divide-border/60 rounded-md border border-border/70">
          {lists.map((l) => (
            <div key={l.id} className="flex items-center gap-2 px-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{l.name}</div>
                <div className="text-[10px] text-muted-foreground">
                  {l.symbols.length} symbols
                  {l.symbols.length > 0
                    ? ` · ${l.symbols.slice(0, 3).map((s) => formatSymbolLabel(s)).join(', ')}${l.symbols.length > 3 ? '…' : ''}`
                    : ' · empty'}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1"
                onClick={() => setView({ mode: 'edit', listId: l.id })}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleDelete(l)}
                title="Delete list"
              >
                <Trash2 className="h-3.5 w-3.5 text-bear" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WatchlistEditor({
  list,
  onSaved,
  onBack,
}: {
  list: Watchlist;
  onSaved: () => Promise<void>;
  onBack: () => void;
}) {
  const [name, setName] = useState(list.name);
  const [members, setMembers] = useState<Set<string>>(() => new Set(list.symbols));
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');

  const grouped = useMemo(() => {
    const map = new Map<string, typeof SYMBOL_CATALOG>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    const q = filter.trim().toLowerCase();
    for (const s of SYMBOL_CATALOG) {
      if (q && !s.label.toLowerCase().includes(q) && !s.id.toLowerCase().includes(q)) continue;
      map.get(s.category)!.push(s);
    }
    return map;
  }, [filter]);

  const toggle = (id: string) => {
    setMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectCategory = (cat: keyof typeof CATEGORY_LABEL) => {
    setMembers((prev) => {
      const next = new Set(prev);
      const items = grouped.get(cat) ?? [];
      const allIn = items.every((s) => next.has(s.id));
      for (const s of items) {
        if (allIn) next.delete(s.id);
        else next.add(s.id);
      }
      return next;
    });
  };

  const save = async (after?: 'close' | 'subscribe'): Promise<void> => {
    setBusy(true);
    try {
      await updateWatchlist(list.id, {
        name: name.trim() || list.name,
        symbols: [...members],
      });
      await onSaved();
      toast({ title: 'List saved', description: `${members.size} symbols`, tone: 'success' });
      if (after === 'close') onBack();
      if (after === 'subscribe') {
        await bulkSubscribeFromList([...members]);
      }
    } catch (err) {
      toast({ title: 'Save failed', description: String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const bulkSubscribeFromList = async (symbols: string[]): Promise<void> => {
    if (symbols.length === 0) {
      toast({ title: 'List is empty', tone: 'warn' });
      return;
    }
    if (
      !window.confirm(
        `Create a 1d EMA(5) × EMA(10) MA-cross alert for ${symbols.length} symbol${symbols.length === 1 ? '' : 's'} from "${name}"?\n\n` +
          'Existing alerts on the same (symbol, 1d) will be skipped.\n' +
          'Telegram + web delivery will both be enabled.',
      )
    )
      return;
    try {
      const r = await bulkSubscribeAlerts({
        interval: '1d',
        symbols,
        config: {
          ma: { type: 'ema', length: 5, source: 'close' },
          crossWith: { type: 'ema', length: 10 },
          labels: { buy: 'BUY', sell: 'SELL' },
          delivery: { web: true, telegram: true },
          timezone: 'UTC',
        },
      });
      toast({
        title: `Subscribed ${r.created} symbols`,
        description: r.skipped > 0 ? `${r.skipped} already had a 1d alert (skipped).` : 'Alerts armed.',
        tone: 'success',
      });
    } catch (err) {
      toast({ title: 'Bulk subscribe failed', description: String(err), tone: 'error' });
    }
  };

  return (
    <div className="px-4 py-3 text-xs">
      <div className="mb-2 flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onBack} className="gap-1 px-2">
          <ChevronLeft className="h-3.5 w-3.5" /> Lists
        </Button>
        <Input
          autoComplete="off"
          name={`wl-rename-${Math.random().toString(36).slice(2, 7)}`}
          spellCheck={false}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="List name"
        />
        <div className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {members.size} selected
        </div>
      </div>
      <div className="mb-2">
        <Input
          autoComplete="off"
          name={`wl-filter-${Math.random().toString(36).slice(2, 7)}`}
          spellCheck={false}
          placeholder="Filter symbols (e.g. EUR, gold, NAS100)"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="rounded-md border border-border/70 bg-surface-raised/40">
        {CATEGORY_ORDER.map((cat) => {
          const items = grouped.get(cat) ?? [];
          if (items.length === 0) return null;
          const allIn = items.every((s) => members.has(s.id));
          const someIn = items.some((s) => members.has(s.id));
          return (
            <div key={cat} className="border-b border-border/40 last:border-b-0">
              <div className="flex items-center justify-between bg-surface/40 px-2 py-1.5">
                <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {CATEGORY_LABEL[cat]}
                </span>
                <button
                  onClick={() => selectCategory(cat)}
                  className="rounded-md border border-border/60 px-2 py-0.5 text-[10px] hover:border-accent/60"
                >
                  {allIn ? 'Clear all' : someIn ? 'Select all' : 'Select all'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1 p-2 md:grid-cols-3">
                {items.map((s) => {
                  const selected = members.has(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => toggle(s.id)}
                      className={`flex items-center justify-between rounded-md border px-2 py-1 text-left text-[11px] transition-colors ${
                        selected
                          ? 'border-accent/70 bg-accent/15 text-foreground'
                          : 'border-border/60 hover:border-accent/40'
                      }`}
                    >
                      <span className="truncate">{s.label}</span>
                      {selected ? <Check className="ml-1 h-3 w-3 shrink-0 text-accent" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-3">
        <Button size="sm" variant="ghost" onClick={() => save('close')} disabled={busy} className="gap-1">
          <Check className="h-3.5 w-3.5" /> Save &amp; close
        </Button>
        <Button size="sm" variant="subtle" onClick={() => save('subscribe')} disabled={busy} className="gap-1">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListPlus className="h-3.5 w-3.5" />}
          Alerts: 1d EMA(5)×(10)
        </Button>
        <MT5BulkAutomateButton
          listName={name}
          symbols={[...members]}
          onSaved={async () => {
            await onSaved();
          }}
        />
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Alerts only notify. MT5 automation actually places trades — review the settings each time.
      </p>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── MT5 bulk automation */

interface AutomatePayload {
  accountId: string;
  interval: Interval;
  ma: { type: 'sma' | 'ema' | 'rma' | 'wma'; length: number; source: 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' };
  sides: Array<'buy' | 'sell'>;
  lots: number;
  slPips?: number;
  tpPips?: number;
  cooldownSec: number;
  maxOpen: number;
  maxTradesPerDay?: number;
}

const DEFAULT_AUTOMATE: AutomatePayload = {
  accountId: '',
  interval: '1h',
  ma: { type: 'ema', length: 20, source: 'close' },
  sides: ['buy', 'sell'],
  lots: 0.01,
  slPips: 30,
  tpPips: 60,
  // 1h bar = 3600s. Default cooldown stays slightly under one bar so the engine
  // won't fire twice on the same swing inside the same bar.
  cooldownSec: 3000,
  maxOpen: 1,
  maxTradesPerDay: 6,
};

function MT5BulkAutomateButton({
  listName,
  symbols,
  onSaved,
}: {
  listName: string;
  symbols: string[];
  onSaved: () => Promise<void>;
}) {
  const accounts = useMT5Store((s) => s.accounts);
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<AutomatePayload>(() => ({
    ...DEFAULT_AUTOMATE,
    accountId: accounts[0]?.accountId ?? '',
  }));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!payload.accountId && accounts.length > 0) {
      setPayload((p) => ({ ...p, accountId: accounts[0]!.accountId }));
    }
  }, [accounts, payload.accountId]);

  const handleSubmit = async () => {
    if (!payload.accountId) {
      toast({
        title: 'Connect an MT5 account first',
        description: 'Use "Connect MT5" in the top bar to pair an account.',
        tone: 'error',
      });
      return;
    }
    if (symbols.length === 0) {
      toast({ title: 'List is empty — add symbols first', tone: 'warn' });
      return;
    }
    if (payload.sides.length === 0) {
      toast({ title: 'Pick at least one side (Buy / Sell)', tone: 'warn' });
      return;
    }
    if (
      !window.confirm(
        `Create LIVE MT5 automation recipes for ${symbols.length} symbol${symbols.length === 1 ? '' : 's'} × ${payload.sides.length} side${
          payload.sides.length === 1 ? '' : 's'
        } = ${symbols.length * payload.sides.length} recipes?\n\n` +
          `Account: ${payload.accountId}\n` +
          `Trigger: ${payload.ma.type.toUpperCase()}(${payload.ma.length}) ${payload.ma.source} cross on ${payload.interval} bar close\n` +
          `Size: ${payload.lots} lots · SL: ${payload.slPips ?? '—'} pips · TP: ${payload.tpPips ?? '—'} pips\n` +
          `Per-recipe cap: ${payload.maxOpen} open · ${payload.cooldownSec}s cooldown · ${payload.maxTradesPerDay ?? '∞'} trades/day\n\n` +
          'These recipes will place real orders via the connected EA. Continue?',
      )
    )
      return;
    setBusy(true);
    try {
      const r = await bulkSubscribeSignals({
        accountId: payload.accountId,
        interval: payload.interval,
        symbols,
        ma: payload.ma,
        sides: payload.sides,
        sizing: { mode: 'fixed_lots', lots: payload.lots },
        sl: payload.slPips ? { pips: payload.slPips } : undefined,
        tp: payload.tpPips ? { pips: payload.tpPips } : undefined,
        maxOpen: payload.maxOpen,
        cooldownSec: payload.cooldownSec,
        maxTradesPerDay: payload.maxTradesPerDay,
      });
      toast({
        title: `Armed ${r.created} MT5 recipes`,
        description: r.skipped > 0 ? `${r.skipped} duplicates skipped.` : 'Trades will fire on the next matching crossover.',
        tone: 'success',
      });
      await onSaved();
      setOpen(false);
    } catch (err) {
      toast({ title: 'MT5 bulk subscribe failed', description: String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const toggleSide = (side: 'buy' | 'sell') => {
    setPayload((p) => {
      const has = p.sides.includes(side);
      return { ...p, sides: has ? p.sides.filter((s) => s !== side) : [...p.sides, side] };
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1 bg-bear/80 text-white hover:bg-bear">
          <Zap className="h-3.5 w-3.5" /> Automate (MT5)
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-bear" /> MT5 bulk automation · {listName}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Places real trades on every MA crossover. Set hard caps below and review on every save.
          </p>
        </DialogHeader>
        <div className="space-y-3 px-4 pb-4 text-xs">
          <div className="rounded-md border border-bear/40 bg-bear/10 p-2 text-[11px]">
            <strong className="text-bear">Live trading</strong> — these recipes route orders to MT5 via the connected EA.
            Always test on a demo account first. Trade volume = {symbols.length * payload.sides.length} recipes.
          </div>
          <Field label="MT5 account">
            {accounts.length === 0 ? (
              <div className="rounded-md border border-warn/50 bg-warn/10 px-3 py-2 text-warn">
                No MT5 accounts paired. Use "Connect MT5" in the top bar first.
              </div>
            ) : (
              <Select
                value={payload.accountId}
                onValueChange={(v) => setPayload((p) => ({ ...p, accountId: v }))}
              >
                <SelectTrigger className="w-full"><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.accountId} value={a.accountId}>
                      {a.snapshot?.account.broker ?? '?'} · {a.snapshot?.account.login ?? a.accountId.split('@')[0]} ·{' '}
                      {a.snapshot?.account.currency ?? '—'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Timeframe">
              <Select
                value={payload.interval}
                onValueChange={(v) => setPayload((p) => ({ ...p, interval: v as Interval }))}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INTERVALS.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Sides">
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={payload.sides.includes('buy') ? 'subtle' : 'ghost'}
                  onClick={() => toggleSide('buy')}
                  className="flex-1 gap-1"
                >
                  <Check className={`h-3 w-3 ${payload.sides.includes('buy') ? 'opacity-100' : 'opacity-0'}`} /> Buy
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={payload.sides.includes('sell') ? 'subtle' : 'ghost'}
                  onClick={() => toggleSide('sell')}
                  className="flex-1 gap-1"
                >
                  <Check className={`h-3 w-3 ${payload.sides.includes('sell') ? 'opacity-100' : 'opacity-0'}`} /> Sell
                </Button>
              </div>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="MA type">
              <Select
                value={payload.ma.type}
                onValueChange={(v) => setPayload((p) => ({ ...p, ma: { ...p.ma, type: v as AutomatePayload['ma']['type'] } }))}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MA_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Length">
              <Input
                type="number"
                min={2}
                max={500}
                value={payload.ma.length}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= 2 && v <= 500) {
                    setPayload((p) => ({ ...p, ma: { ...p.ma, length: v } }));
                  }
                }}
              />
            </Field>
            <Field label="Source">
              <Select
                value={payload.ma.source}
                onValueChange={(v) => setPayload((p) => ({ ...p, ma: { ...p.ma, source: v as AutomatePayload['ma']['source'] } }))}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MA_SOURCE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Lots">
              <Input
                type="number"
                step={0.01}
                min={0.01}
                value={payload.lots}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v > 0) setPayload((p) => ({ ...p, lots: v }));
                }}
              />
            </Field>
            <Field label="SL pips">
              <Input
                type="number"
                value={payload.slPips ?? ''}
                onChange={(e) => {
                  const v = e.target.value === '' ? undefined : Number(e.target.value);
                  setPayload((p) => ({ ...p, slPips: v }));
                }}
              />
            </Field>
            <Field label="TP pips">
              <Input
                type="number"
                value={payload.tpPips ?? ''}
                onChange={(e) => {
                  const v = e.target.value === '' ? undefined : Number(e.target.value);
                  setPayload((p) => ({ ...p, tpPips: v }));
                }}
              />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Max open / recipe">
              <Input
                type="number"
                min={1}
                value={payload.maxOpen}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= 1) setPayload((p) => ({ ...p, maxOpen: v }));
                }}
              />
            </Field>
            <Field label="Cooldown (s)">
              <Input
                type="number"
                min={0}
                value={payload.cooldownSec}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= 0) setPayload((p) => ({ ...p, cooldownSec: v }));
                }}
              />
            </Field>
            <Field label="Max trades / day">
              <Input
                type="number"
                min={1}
                value={payload.maxTradesPerDay ?? ''}
                onChange={(e) => {
                  const v = e.target.value === '' ? undefined : Number(e.target.value);
                  setPayload((p) => ({ ...p, maxTradesPerDay: v }));
                }}
              />
            </Field>
          </div>
        </div>
        <DialogFooter className="flex items-center justify-end gap-2 border-t border-border/60 px-4 py-3">
          <Button variant="ghost" onClick={() => setOpen(false)} size="sm">Cancel</Button>
          <Button
            size="sm"
            className="gap-1 bg-bear/80 text-white hover:bg-bear"
            onClick={handleSubmit}
            disabled={busy || accounts.length === 0}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            Arm {symbols.length * payload.sides.length} recipes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function describeChat(c: DiscoveredChat): string {
  if (c.type === 'private') {
    const name = [c.firstName, c.lastName].filter(Boolean).join(' ');
    if (name && c.username) return `${name} · @${c.username}`;
    if (name) return name;
    if (c.username) return `@${c.username}`;
    return 'Private chat';
  }
  return c.title ? `${c.title} (${c.type})` : c.type;
}

 
const _unusedX: typeof XIcon = XIcon;
const _unused: typeof updateAlert = updateAlert;
 
