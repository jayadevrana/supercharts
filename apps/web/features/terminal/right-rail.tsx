'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDownRight, ArrowUpRight, Eye, EyeOff, LineChart, Newspaper, RefreshCw, Star, Wifi } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { formatCompact, formatPercent, formatPrice, formatRelativeTime, formatSymbolLabel } from '@/lib/format';
import { useTerminalStore, type PaneState } from './terminal-store';
import { OrderPanel } from './order-panel';
import { IndicatorPanel } from './indicator-panel';
import type { NewsItem, ProviderHealthStatus } from '@supercharts/types';
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  SYMBOL_CATALOG,
  getCatalogSymbol,
  type SymbolCategory,
} from '@supercharts/types';

interface TopMover {
  symbol: string;
  lastPrice: number;
  changePercent: number;
  quoteVolume: number;
}

export function RightRail() {
  const { panes, activePaneId, setPaneSymbol } = useTerminalStore();
  const activePane = panes.find((p) => p.id === activePaneId) ?? panes[0]!;

  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-border bg-surface/85">
      <Tabs defaultValue="trade" className="flex h-full flex-col">
        <TabsList className="mx-2 mt-3 grid w-auto grid-cols-6 self-stretch text-[10px]">
          <TabsTrigger value="trade">Trade</TabsTrigger>
          <TabsTrigger value="ind">Ind</TabsTrigger>
          <TabsTrigger value="watch">Watch</TabsTrigger>
          <TabsTrigger value="news">News</TabsTrigger>
          <TabsTrigger value="scanner">Scan</TabsTrigger>
          <TabsTrigger value="overlays">Layers</TabsTrigger>
        </TabsList>
        <div className="min-h-0 flex-1 overflow-hidden">
          <TabsContent value="trade" className="h-full overflow-y-auto scroll-thin">
            <OrderPanel pane={activePane} />
          </TabsContent>
          <TabsContent value="ind" className="h-full overflow-y-auto scroll-thin">
            <IndicatorPanel pane={activePane} />
          </TabsContent>
          <TabsContent value="watch" className="h-full overflow-y-auto scroll-thin">
            <WatchlistTab onPick={(s) => setPaneSymbol(activePane.id, s)} active={activePane.symbol} />
          </TabsContent>
          <TabsContent value="news" className="h-full overflow-y-auto scroll-thin">
            <NewsTab symbol={activePane.symbol} />
          </TabsContent>
          <TabsContent value="scanner" className="h-full overflow-y-auto scroll-thin">
            <ScannerTab onPick={(s) => setPaneSymbol(activePane.id, s)} />
          </TabsContent>
          <TabsContent value="overlays" className="h-full overflow-y-auto scroll-thin">
            <OverlaysTab pane={activePane} />
          </TabsContent>
        </div>
        <DataHealthFooter />
      </Tabs>
    </aside>
  );
}

function WatchlistTab({ active, onPick }: { active: string; onPick: (s: string) => void }) {
  // The watchlist is sourced from the shared symbol catalog so it stays in lockstep
  // with what the alerts builder and provider whitelist support. Each category gets
  // its own collapsible section.
  const allSymbols = useMemo(() => SYMBOL_CATALOG.map((s) => s.id), []);
  const [data, setData] = useState<Record<string, TopMover>>({});
  const [collapsed, setCollapsed] = useState<Set<SymbolCategory>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await api<{ items: TopMover[] }>('/quotes', {
          searchParams: { symbols: allSymbols.join(',') },
        });
        if (cancelled) return;
        const map: Record<string, TopMover> = {};
        for (const m of r.items) map[m.symbol] = m;
        setData(map);
      } catch {
        /* ignore */
      }
    };
    load();
    const id = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [allSymbols]);

  const grouped = useMemo(() => {
    const map = new Map<SymbolCategory, typeof SYMBOL_CATALOG>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const s of SYMBOL_CATALOG) map.get(s.category)!.push(s);
    return map;
  }, []);

  const toggle = (cat: SymbolCategory) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  return (
    <div>
      <div className="px-3 py-3">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Star className="h-3 w-3" /> Watchlist
          </span>
          <span>{SYMBOL_CATALOG.length} symbols · {CATEGORY_ORDER.length} groups</span>
        </div>
      </div>
      {CATEGORY_ORDER.map((cat) => {
        const items = grouped.get(cat) ?? [];
        if (items.length === 0) return null;
        const isCollapsed = collapsed.has(cat);
        return (
          <div key={cat} className="border-t border-border/60">
            <button
              onClick={() => toggle(cat)}
              className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-surface-raised"
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {CATEGORY_LABEL[cat]}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {items.length} · {isCollapsed ? '▸' : '▾'}
              </span>
            </button>
            {!isCollapsed
              ? items.map((s) => {
                  const live = data[s.id];
                  const isActive = s.id === active;
                  const isOanda = s.venue === 'OANDA';
                  return (
                    <button
                      key={s.id}
                      onClick={() => onPick(s.id)}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-surface-raised ${
                        isActive ? 'bg-accent/10' : ''
                      }`}
                    >
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-foreground">{s.label}</span>
                        <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          {s.venue}
                        </span>
                      </div>
                      <div className="text-right text-xs tabular-nums">
                        {live ? (
                          <>
                            <div className="text-foreground">{formatPrice(live.lastPrice)}</div>
                            <div className={live.changePercent >= 0 ? 'text-bull' : 'text-bear'}>
                              {formatPercent(live.changePercent)}
                            </div>
                          </>
                        ) : isOanda ? (
                          <div className="text-[10px] uppercase tracking-[0.14em] text-warn">configure OANDA</div>
                        ) : (
                          <Skeleton className="ml-auto h-3 w-16" />
                        )}
                      </div>
                    </button>
                  );
                })
              : null}
          </div>
        );
      })}
    </div>
  );
}

interface NewsWatchlist {
  id: string;
  name: string;
  symbols: string[];
}
type NewsScope = { kind: 'symbol' } | { kind: 'watchlist'; id: string; name: string };

function NewsTab({ symbol }: { symbol: string }) {
  const [scope, setScope] = useState<NewsScope>({ kind: 'symbol' });
  const [watchlists, setWatchlists] = useState<NewsWatchlist[]>([]);
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // Load the user's watchlists once so they can scope news to a whole list.
  useEffect(() => {
    let cancelled = false;
    api<{ items: NewsWatchlist[] }>('/watchlists')
      .then((r) => !cancelled && setWatchlists(r.items))
      .catch(() => !cancelled && setWatchlists([]));
    return () => {
      cancelled = true;
    };
  }, []);

  // If the selected watchlist is deleted elsewhere, fall back to symbol scope.
  useEffect(() => {
    if (scope.kind === 'watchlist' && watchlists.length > 0 && !watchlists.some((w) => w.id === scope.id)) {
      setScope({ kind: 'symbol' });
    }
  }, [watchlists, scope]);

  const isWatchlist = scope.kind === 'watchlist';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r =
        scope.kind === 'watchlist'
          ? await api<{ items: NewsItem[]; fetchedAt?: number }>(`/news/watchlist/${scope.id}`)
          : await api<{ items: NewsItem[]; fetchedAt?: number }>('/news/latest', {
              searchParams: { symbols: symbol, limit: 40 },
            });
      setItems(r.items);
      setFetchedAt(r.fetchedAt ?? Date.now());
    } catch {
      setItems([]);
      setFetchedAt(Date.now());
    } finally {
      setLoading(false);
    }
  }, [scope, symbol]);

  useEffect(() => {
    setItems(null);
    void load();
  }, [load]);

  const chipCls = (active: boolean): string =>
    `inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
      active
        ? 'border-accent/60 bg-accent/15 text-foreground'
        : 'border-border bg-surface-raised text-muted-foreground hover:text-foreground'
    }`;

  const scopeBar = (
    <div className="flex flex-wrap items-center gap-1 border-b border-border/60 px-2 py-2">
      <button onClick={() => setScope({ kind: 'symbol' })} className={chipCls(scope.kind === 'symbol')}>
        {formatSymbolLabel(symbol)}
      </button>
      {watchlists.map((w) => (
        <button
          key={w.id}
          onClick={() => setScope({ kind: 'watchlist', id: w.id, name: w.name })}
          className={chipCls(scope.kind === 'watchlist' && scope.id === w.id)}
          title={`Headlines scored for ${w.name} (${w.symbols.length} symbols)`}
        >
          <Star className="h-2.5 w-2.5" /> {w.name}
        </button>
      ))}
    </div>
  );

  const body = (() => {
    if (!items) {
      return (
        <div className="space-y-3 p-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      );
    }

    if (items.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
          <Newspaper className="h-6 w-6 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">
            {isWatchlist
              ? `No headlines match ${scope.name} right now. Items are scored against each symbol's keywords as they publish.`
              : 'No live news for this symbol right now. GDELT and CryptoPanic adapters surface headlines as they publish.'}
          </p>
          {fetchedAt ? (
            <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
              Last checked {formatRelativeTime(fetchedAt)}
            </p>
          ) : null}
          <button
            onClick={() => void load()}
            disabled={loading}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-raised px-3 py-1.5 text-xs text-foreground hover:border-accent/60 disabled:opacity-60"
          >
            {loading ? (
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-r-transparent" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            Refresh
          </button>
        </div>
      );
    }

    return (
      <div className="divide-y divide-border/60">
        {items.map((n) => (
          <a
            key={n.id}
            href={n.url}
            target="_blank"
            rel="noreferrer"
            className="block px-3 py-3 transition-colors hover:bg-surface-raised"
          >
            <div className="flex items-start gap-2">
              <span
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                  n.sentiment == null
                    ? 'bg-muted-foreground'
                    : n.sentiment >= 0.2
                      ? 'bg-bull'
                      : n.sentiment <= -0.2
                        ? 'bg-bear'
                        : 'bg-warn'
                }`}
              />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground">{n.title}</div>
                <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <span>{n.source}</span>
                  <span>·</span>
                  <span>{formatRelativeTime(n.publishedAt)}</span>
                </div>
                {isWatchlist ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="flex items-center gap-1.5">
                      <span className="h-1 w-14 overflow-hidden rounded-full bg-border">
                        <span
                          className="block h-full rounded-full bg-accent"
                          style={{ width: `${Math.max(6, Math.round(n.relevance * 100))}%` }}
                        />
                      </span>
                      <span className="text-[9px] tabular-nums text-muted-foreground">
                        {Math.round(n.relevance * 100)}% match
                      </span>
                    </span>
                    {n.symbols.slice(0, 3).map((s) => (
                      <Badge key={s} tone="muted" className="text-[9px]">
                        {getCatalogSymbol(s)?.label ?? formatSymbolLabel(s)}
                      </Badge>
                    ))}
                    {n.symbols.length > 3 ? (
                      <span className="text-[9px] text-muted-foreground">+{n.symbols.length - 3}</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </a>
        ))}
      </div>
    );
  })();

  return (
    <div className="flex h-full flex-col">
      {scopeBar}
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">{body}</div>
    </div>
  );
}

function ScannerTab({ onPick }: { onPick: (s: string) => void }) {
  const [items, setItems] = useState<TopMover[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await api<{ items: TopMover[] }>('/scanner/top-movers');
        if (!cancelled) setItems(r.items);
      } catch {
        if (!cancelled) setItems([]);
      }
    };
    load();
    const id = setInterval(load, 12_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!items) {
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="border-b border-border/60 px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        Top movers · last 24h · Binance USDT pairs
      </div>
      <div className="divide-y divide-border/60">
        {items.map((m) => {
          const up = m.changePercent >= 0;
          return (
            <button
              key={m.symbol}
              onClick={() => onPick(m.symbol)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-raised"
            >
              <div className="flex items-center gap-2">
                {up ? <ArrowUpRight className="h-3.5 w-3.5 text-bull" /> : <ArrowDownRight className="h-3.5 w-3.5 text-bear" />}
                <span className="text-sm font-medium">{formatSymbolLabel(m.symbol)}</span>
              </div>
              <div className="flex items-center gap-3 text-xs tabular-nums">
                <span className="text-muted-foreground">{formatCompact(m.quoteVolume)}</span>
                <span className={up ? 'text-bull' : 'text-bear'}>{formatPercent(m.changePercent)}</span>
                <span className="text-foreground">{formatPrice(m.lastPrice)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function OverlaysTab({ pane }: { pane: PaneState }) {
  const togglePaneOverlay = useTerminalStore((s) => s.togglePaneOverlay);
  const setHeatmapSetting = useTerminalStore((s) => s.setHeatmapSetting);
  const onToggle = (k: keyof PaneState['overlays']) => togglePaneOverlay(pane.id, k);
  return (
    <div className="space-y-5 p-3">
      <div>
        <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          <Activity className="h-3 w-3" /> Overlays
        </div>
        <OverlayRow
          label="Liquidity heatmap"
          description="Resting bids/asks behind price"
          checked={pane.overlays.heatmap}
          onChange={() => onToggle('heatmap')}
        />
        <OverlayRow
          label="Volume profile (VR)"
          description="POC / VAH / VAL on visible range"
          checked={pane.overlays.profile}
          onChange={() => onToggle('profile')}
        />
        <OverlayRow
          label="Deep-trade bubbles"
          description="Large prints, sized by notional"
          checked={pane.overlays.deepTrades}
          onChange={() => onToggle('deepTrades')}
        />
        <OverlayRow
          label="Footprint cells"
          description="Bid × ask split per row, imbalance outlined"
          checked={pane.overlays.footprint}
          onChange={() => onToggle('footprint')}
        />
        <OverlayRow
          label="Volume pane"
          description="Bar volume below price"
          checked={pane.overlays.volume}
          onChange={() => onToggle('volume')}
        />
        <OverlayRow
          label="Signals & Trend Score"
          description="MA cloud · ATR trail · Buy/Sell · MTF dashboards · SL/TP"
          checked={pane.overlays.signalsTrendScore}
          onChange={() => onToggle('signalsTrendScore')}
        />
      </div>
      <Separator />
      <StsSettingsBlock pane={pane} />
      <Separator />
      <SmcSettingsBlock pane={pane} />
      <Separator />
      <div>
        <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Heatmap intensity
        </div>
        <div className="space-y-4">
          <Field label={`Opacity · ${Math.round(pane.heatmapSettings.opacity * 100)}%`}>
            <Slider
              value={[Math.round(pane.heatmapSettings.opacity * 100)]}
              min={20}
              max={100}
              onValueChange={(v) => setHeatmapSetting(pane.id, 'opacity', (v[0] ?? 85) / 100)}
            />
          </Field>
          <Field label={`Depth · top ${pane.heatmapSettings.depth}`}>
            <Slider
              value={[pane.heatmapSettings.depth]}
              min={5}
              max={100}
              step={5}
              onValueChange={(v) => setHeatmapSetting(pane.id, 'depth', v[0] ?? 20)}
            />
          </Field>
          <Field label={`Time bucket · ${pane.heatmapSettings.timeBucketMs} ms`}>
            <Slider
              value={[pane.heatmapSettings.timeBucketMs]}
              min={250}
              max={5000}
              step={250}
              onValueChange={(v) => setHeatmapSetting(pane.id, 'timeBucketMs', v[0] ?? 1000)}
            />
          </Field>
        </div>
      </div>
      <Separator />
      <div className="space-y-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Provider</span>
          <Badge tone="accent">{pane.symbol.split(':')[0]}</Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Volume kind</span>
          <Badge tone={pane.symbol.startsWith('OANDA') ? 'warn' : 'bull'}>
            {pane.symbol.startsWith('OANDA') ? 'tick volume' : 'real volume'}
          </Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Order book</span>
          <Badge tone={pane.symbol.startsWith('OANDA') ? 'muted' : 'bull'}>
            {pane.symbol.startsWith('OANDA') ? 'unavailable' : 'top-20'}
          </Badge>
        </div>
      </div>
    </div>
  );
}

function OverlayRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md px-1.5 py-2">
      <div>
        <div className="flex items-center gap-2 text-sm text-foreground">
          {checked ? <Eye className="h-3.5 w-3.5 text-accent" /> : <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />}
          {label}
        </div>
        <div className="text-[11px] text-muted-foreground">{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}

function DataHealthFooter() {
  const [providers, setProviders] = useState<ProviderHealthStatus[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await api<{ providers: ProviderHealthStatus[] }>('/provider-health');
        if (!cancelled) setProviders(r.providers ?? []);
      } catch {
        /* ignore */
      }
    };
    load();
    const id = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="border-t border-border bg-surface-sunken/60 p-3 text-[11px]">
      <div className="mb-1.5 flex items-center gap-1.5 uppercase tracking-[0.16em] text-muted-foreground">
        <Wifi className="h-3 w-3" /> Data health
      </div>
      <div className="space-y-1">
        {providers.length === 0 ? (
          <span className="text-muted-foreground">No providers reporting yet.</span>
        ) : (
          providers.map((p) => (
            <div key={p.provider} className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    p.status === 'connected'
                      ? 'bg-bull'
                      : p.status === 'not_configured'
                        ? 'bg-muted-foreground/40'
                        : p.status === 'degraded'
                          ? 'bg-warn'
                          : 'bg-bear'
                  }`}
                />
                <span className="text-foreground">{p.provider}</span>
              </span>
              <span className="text-muted-foreground">{p.status}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Signals & Trend Score settings panel.
// Surfaces every Pine-script input that traders care about for the indicator.
// -----------------------------------------------------------------------------

function StsSettingsBlock({ pane }: { pane: PaneState }) {
  const setStsSetting = useTerminalStore((s) => s.setStsSetting);
  if (!pane.overlays.signalsTrendScore) {
    return (
      <div className="rounded-md border border-dashed border-border/70 px-3 py-2 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-2">
          <LineChart className="h-3.5 w-3.5" />
          <span>Signals &amp; Trend Score</span>
        </div>
        <div className="mt-1 text-[10px]">Toggle the indicator on above to access its settings.</div>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        <LineChart className="h-3 w-3" /> Signals &amp; Trend Score
      </div>
      <div className="space-y-2">
        <StsRow label="Show MA cloud">
          <Switch
            checked={pane.stsSettings.showMaCloud}
            onCheckedChange={(v) => setStsSetting(pane.id, 'showMaCloud', v)}
          />
        </StsRow>
        <StsRow label="Show ATR trail">
          <Switch
            checked={pane.stsSettings.showAtrTrail}
            onCheckedChange={(v) => setStsSetting(pane.id, 'showAtrTrail', v)}
          />
        </StsRow>
        <StsRow label="Show Buy/Sell labels">
          <Switch
            checked={pane.stsSettings.showSignals}
            onCheckedChange={(v) => setStsSetting(pane.id, 'showSignals', v)}
          />
        </StsRow>
        <StsRow label="Show SL / TP">
          <Switch
            checked={pane.stsSettings.showSlTp}
            onCheckedChange={(v) => setStsSetting(pane.id, 'showSlTp', v)}
          />
        </StsRow>
        <StsRow label="Bottom dashboard">
          <Switch
            checked={pane.stsSettings.showBottomDash}
            onCheckedChange={(v) => setStsSetting(pane.id, 'showBottomDash', v)}
          />
        </StsRow>
        <StsRow label="Up highlight">
          <Switch
            checked={pane.stsSettings.showUpHighlight}
            onCheckedChange={(v) => setStsSetting(pane.id, 'showUpHighlight', v)}
          />
        </StsRow>
        <StsRow label="Down highlight">
          <Switch
            checked={pane.stsSettings.showDownHighlight}
            onCheckedChange={(v) => setStsSetting(pane.id, 'showDownHighlight', v)}
          />
        </StsRow>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <StsNumber label="MA length" value={pane.stsSettings.maLength} min={1} max={200}
          onChange={(v) => setStsSetting(pane.id, 'maLength', v)} />
        <StsNumber label="ATR period" value={pane.stsSettings.atrPeriod} min={1} max={100}
          onChange={(v) => setStsSetting(pane.id, 'atrPeriod', v)} />
        <StsNumber label="ATR multiplier" value={pane.stsSettings.atrMultiplier} step={0.1} min={0.1} max={10}
          onChange={(v) => setStsSetting(pane.id, 'atrMultiplier', v)} />
        <StsNumber label="EMA length" value={pane.stsSettings.emaLength} min={1} max={400}
          onChange={(v) => setStsSetting(pane.id, 'emaLength', v)} />
        <StsNumber label="ST factor" value={pane.stsSettings.stFactor} step={0.1} min={0.1} max={10}
          onChange={(v) => setStsSetting(pane.id, 'stFactor', v)} />
        <StsNumber label="ST ATR period" value={pane.stsSettings.stAtrPeriod} min={1} max={100}
          onChange={(v) => setStsSetting(pane.id, 'stAtrPeriod', v)} />
        <StsNumber label="ADX length" value={pane.stsSettings.adxLength} min={1} max={100}
          onChange={(v) => setStsSetting(pane.id, 'adxLength', v)} />
        <StsNumber label="ADX threshold" value={pane.stsSettings.adxThreshold} min={1} max={100}
          onChange={(v) => setStsSetting(pane.id, 'adxThreshold', v)} />
        <StsNumber label="RSI length" value={pane.stsSettings.rsiLength} min={1} max={100}
          onChange={(v) => setStsSetting(pane.id, 'rsiLength', v)} />
        <StsNumber label="RSI bull" value={pane.stsSettings.rsiBull} min={1} max={100}
          onChange={(v) => setStsSetting(pane.id, 'rsiBull', v)} />
        <StsNumber label="RSI bear" value={pane.stsSettings.rsiBear} min={1} max={100}
          onChange={(v) => setStsSetting(pane.id, 'rsiBear', v)} />
        <StsNumber label="Swing lookback" value={pane.stsSettings.swingLen} min={1} max={400}
          onChange={(v) => setStsSetting(pane.id, 'swingLen', v)} />
        <StsNumber label="Volume lookback" value={pane.stsSettings.volLookback} min={1} max={400}
          onChange={(v) => setStsSetting(pane.id, 'volLookback', v)} />
      </div>
    </div>
  );
}

function StsRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-md px-1.5 py-1.5 text-xs">
      <span className="text-foreground">{label}</span>
      {children}
    </div>
  );
}

function StsNumber({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        className="h-7 w-full rounded-md border border-border bg-surface-sunken px-2 text-xs tabular-nums text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/60"
      />
    </label>
  );
}

// -----------------------------------------------------------------------------
// SMC / Order-Flow indicator suite.
// One toggle per indicator. Descriptions explain each acronym for users
// unfamiliar with LuxAlgo / ICT terminology.
// -----------------------------------------------------------------------------

const SMC_ROWS: Array<{
  key: keyof PaneState['smc'];
  label: string;
  description: string;
}> = [
  { key: 'fvg', label: 'Fair Value Gaps', description: '3-candle imbalance zones (FVG + inverse FVG)' },
  { key: 'orderBlocks', label: 'Order Blocks', description: 'Institutional supply/demand · mitigated · breaker' },
  { key: 'liquidity', label: 'Liquidity Pools', description: 'Equal highs/lows · BSL / SSL clusters' },
  { key: 'liquiditySweeps', label: 'Liquidity Sweeps', description: 'Wick-through with close-back-inside' },
  { key: 'marketStructure', label: 'Market Structure', description: 'BOS / CHoCH + HH/HL/LH/LL chips' },
  { key: 'premiumDiscount', label: 'Premium / Discount', description: 'Range thirds + 0.618–0.786 OTE band' },
  { key: 'anchoredVwap', label: 'Anchored VWAP', description: 'Anchored mean ± 1/2/3 σ bands' },
  { key: 'cvdDivergence', label: 'CVD Divergence', description: 'Cumulative delta vs price · regular & hidden' },
  { key: 'sessions', label: 'Sessions / Killzones', description: 'Asia · London · NY AM · NY PM' },
  { key: 'hvnLvn', label: 'HVN / LVN + POC', description: 'Volume profile peaks/troughs · VAH/VAL' },
  { key: 'regimeBadge', label: 'Trend Regime', description: 'EMA slope × ATR z-score classifier' },
];

function SmcSettingsBlock({ pane }: { pane: PaneState }) {
  const toggle = useTerminalStore((s) => s.toggleSmcOverlay);
  const activeCount = Object.values(pane.smc).filter(Boolean).length;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        <span>SMC / Order Flow</span>
        <span className="text-[9px] text-muted-foreground/70">{activeCount}/{SMC_ROWS.length} on</span>
      </div>
      <div className="space-y-1">
        {SMC_ROWS.map((row) => (
          <OverlayRow
            key={row.key}
            label={row.label}
            description={row.description}
            checked={pane.smc[row.key]}
            onChange={() => toggle(pane.id, row.key)}
          />
        ))}
      </div>
      <p className="mt-2 text-[10px] leading-snug text-muted-foreground/80">
        Hedge-fund SMC suite — LuxAlgo + ICT concepts ported in pure TypeScript. Toggle each
        layer independently; defaults stay sane out of the box.
      </p>
    </div>
  );
}
