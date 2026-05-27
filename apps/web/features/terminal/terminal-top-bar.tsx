'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/components/use-toast';
import {
  AlarmClock,
  BellRing,
  ChevronDown,
  Cog,
  Crosshair,
  History,
  Save,
  Search,
  Workflow,
} from 'lucide-react';
import { LayoutPicker } from './layout-picker';
import { MT5Chip } from './mt5-chip';
import { SignalBuilderDialog } from './signal-builder-dialog';
import { AlertsDialog } from './alerts-dialog';
import { BrandMark } from '@/components/brand-mark';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import type { ChartType, Interval } from '@supercharts/types';
import { useTerminalStore } from './terminal-store';

const INTERVALS: { value: Interval; label: string; group: 'seconds' | 'minutes' | 'hours' | 'days' | 'longer' }[] = [
  { value: '1s', label: '1s', group: 'seconds' },
  { value: '5s', label: '5s', group: 'seconds' },
  { value: '15s', label: '15s', group: 'seconds' },
  { value: '30s', label: '30s', group: 'seconds' },
  { value: '1m', label: '1m', group: 'minutes' },
  { value: '3m', label: '3m', group: 'minutes' },
  { value: '5m', label: '5m', group: 'minutes' },
  { value: '15m', label: '15m', group: 'minutes' },
  { value: '30m', label: '30m', group: 'minutes' },
  { value: '1h', label: '1h', group: 'hours' },
  { value: '2h', label: '2h', group: 'hours' },
  { value: '4h', label: '4h', group: 'hours' },
  { value: '6h', label: '6h', group: 'hours' },
  { value: '12h', label: '12h', group: 'hours' },
  { value: '1d', label: '1D', group: 'days' },
  { value: '1w', label: '1W', group: 'days' },
  { value: '1mo', label: '1M', group: 'longer' },
];

const CHART_TYPES: Array<{ value: ChartType; label: string; group: string }> = [
  // OHLC
  { value: 'bar', label: 'Bars', group: 'OHLC' },
  { value: 'candlestick', label: 'Candles', group: 'OHLC' },
  { value: 'hollow_candle', label: 'Hollow candles', group: 'OHLC' },
  { value: 'volume_candle', label: 'Volume candles', group: 'OHLC' },
  // Line family
  { value: 'line', label: 'Line', group: 'Line' },
  { value: 'line_markers', label: 'Line with markers', group: 'Line' },
  { value: 'step_line', label: 'Step line', group: 'Line' },
  // Area family
  { value: 'area', label: 'Area', group: 'Area' },
  { value: 'hlc_area', label: 'HLC area', group: 'Area' },
  { value: 'baseline', label: 'Baseline', group: 'Area' },
  // Range / column
  { value: 'column', label: 'Columns', group: 'Bar' },
  { value: 'high_low', label: 'High-low', group: 'Bar' },
  // Order-flow / profile
  { value: 'footprint', label: 'Volume footprint', group: 'Order flow' },
  { value: 'tpo', label: 'Time price opportunity', group: 'Order flow' },
  { value: 'session_volume_profile', label: 'Session volume profile', group: 'Order flow' },
  // Algorithmic
  { value: 'heikin_ashi', label: 'Heikin Ashi', group: 'Algorithmic' },
  { value: 'renko', label: 'Renko', group: 'Algorithmic' },
  { value: 'line_break', label: 'Line break', group: 'Algorithmic' },
  { value: 'kagi', label: 'Kagi', group: 'Algorithmic' },
  { value: 'point_and_figure', label: 'Point & figure', group: 'Algorithmic' },
  { value: 'range_bar', label: 'Range', group: 'Algorithmic' },
];

export function TerminalTopBar() {
  const {
    panes,
    activePaneId,
    layoutId,
    layout,
    setPaneSymbol,
    setPaneInterval,
    setPaneChartType,
    syncCrosshair,
    setSyncCrosshair,
    replayMode,
    setReplayMode,
  } = useTerminalStore();
  const active = panes.find((p) => p.id === activePaneId) ?? panes[0]!;
  const [saving, setSaving] = useState(false);
  const [signalOpen, setSignalOpen] = useState(false);

  const saveLayout = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const name = `${active.symbol} · ${layout.paneCount}-pane (${layoutId}) · ${new Date().toLocaleString()}`;
      // The /api/layouts endpoint validates `grid` against a small enum, so we map the layout's
      // paneCount onto the closest legacy bucket. The full layoutId + cells are stored in `config`.
      const legacyGrid = (() => {
        const n = layout.paneCount;
        if (n <= 1) return '1';
        if (n <= 2) return '2';
        if (n <= 4) return '4';
        if (n <= 8) return '8';
        return '16';
      })();
      await api('/layouts', {
        method: 'POST',
        body: JSON.stringify({
          name,
          grid: legacyGrid,
          config: { layoutId, layout, panes },
          isDefault: false,
        }),
      });
      toast({ title: 'Layout saved', description: name, tone: 'success' });
    } catch (err) {
      toast({
        title: 'Could not save layout',
        description: err instanceof Error ? err.message : String(err),
        tone: 'error',
      });
    } finally {
      setSaving(false);
    }
  }, [active.symbol, layout, layoutId, panes, saving]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveLayout();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveLayout]);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface/85 px-3 backdrop-blur-xl">
      <Link href="/" className="mr-1">
        <BrandMark size={24} withWordmark={false} />
      </Link>
      <SymbolSearch
        value={active.symbol}
        onPick={(s) => setPaneSymbol(active.id, s)}
      />
      <Select value={active.interval} onValueChange={(v) => setPaneInterval(active.id, v as Interval)}>
        <SelectTrigger className="w-24">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {INTERVALS.filter((g) => supportsInterval(active.symbol, g.value)).map((g) => (
            <SelectItem key={g.value} value={g.value}>
              {g.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={active.chartType} onValueChange={(v) => setPaneChartType(active.id, v as ChartType)}>
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CHART_TYPES.map((c) => (
            <SelectItem key={c.value} value={c.value}>
              <span className="flex flex-col">
                <span>{c.label}</span>
                <span className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">{c.group}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <LayoutPicker />
      <div className="ml-auto flex items-center gap-2">
        <MT5Chip />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSignalOpen(true)}
          className="gap-1 text-muted-foreground hover:text-foreground"
        >
          <Workflow className="h-3.5 w-3.5" /> Signal
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setReplayMode(!replayMode)}
          className="gap-1 text-muted-foreground hover:text-foreground"
        >
          <AlarmClock className="h-3.5 w-3.5" /> {replayMode ? 'Live' : 'Replay'}
        </Button>
        <AlertsDialog activeSymbol={active.symbol} />
        <Button
          variant="ghost"
          size="sm"
          loading={saving}
          onClick={saveLayout}
          className="gap-1 text-muted-foreground hover:text-foreground"
        >
          <Save className="h-3.5 w-3.5" /> Save layout
        </Button>
        <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground hover:text-foreground">
          <History className="h-3.5 w-3.5" /> History
        </Button>
        <Button
          variant={syncCrosshair ? 'subtle' : 'ghost'}
          size="sm"
          onClick={() => setSyncCrosshair(!syncCrosshair)}
          className="gap-1 text-muted-foreground hover:text-foreground"
          title="Sync crosshair across panes"
        >
          <Crosshair className="h-3.5 w-3.5" /> Sync
        </Button>
        <ThemeToggle />
        <Button variant="outline" size="icon" aria-label="Settings">
          <Cog className="h-4 w-4" />
        </Button>
        <Badge tone="bull" className="hidden md:inline-flex">
          live
        </Badge>
      </div>
      <SignalBuilderDialog
        open={signalOpen}
        onOpenChange={setSignalOpen}
        availableIndicators={active.classicIndicators}
        defaultSymbol={active.symbol}
        defaultInterval={active.interval}
      />
    </header>
  );
}


function SymbolSearch({ value, onPick }: { value: string; onPick: (symbol: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState<Array<{ id: string; kind: 'crypto' | 'forex' }>>([]);

  // Debounced remote search: query the API once the user types ≥2 chars, otherwise show curated.
  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setRemote([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const res = await api<{ items: Array<{ id: string; assetClass: 'crypto' | 'forex' }> }>(
          '/symbols/search',
          { searchParams: { q: trimmed, limit: 30 } },
        );
        setRemote(res.items.map((s) => ({ id: s.id, kind: s.assetClass })));
      } catch {
        setRemote([]);
      }
    }, 150);
    return () => clearTimeout(handle);
  }, [q]);

  const items = useMemo(() => {
    const qu = q.trim().toUpperCase();
    if (qu.length < 2) return CURATED_SYMBOLS;
    const curatedMatches = CURATED_SYMBOLS.filter((s) => s.id.toUpperCase().includes(qu));
    const seen = new Set(curatedMatches.map((s) => s.id));
    const remoteFiltered = remote.filter((s) => !seen.has(s.id));
    return [...curatedMatches, ...remoteFiltered].slice(0, 40);
  }, [q, remote]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-2 rounded-md border border-border bg-surface-raised px-3 py-1.5 text-sm font-medium hover:border-accent/60">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="numeric">{value}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[360px] p-2">
        {/*
          Decoy fields to siphon Chrome's autofill heuristics away from the real symbol input.
          Chrome targets the first email + password pair it sees inside a popover, so we
          hand it a non-rendered pair and tell it those are the fields to fill.
        */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          tabIndex={-1}
          aria-hidden
          style={{ position: 'absolute', left: '-9999px', width: 1, height: 1 }}
        />
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          tabIndex={-1}
          aria-hidden
          style={{ position: 'absolute', left: '-9999px', width: 1, height: 1 }}
        />
        <Input
          autoFocus
          type="search"
          name="supercharts-symbol-search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          readOnly
          onFocus={(e) => {
            e.currentTarget.readOnly = false;
          }}
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore -- non-standard Chrome attr that disables aggressive autofill heuristics
          data-form-type="other"
          data-lpignore="true"
          placeholder="Search symbol — BTC, EUR, SOL…"
          leftAdornment={<Search className="h-4 w-4" />}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="mt-2 max-h-72 overflow-auto scroll-thin">
          {items.length === 0 ? (
            <div className="px-2 py-6 text-center text-xs text-muted-foreground">
              Nothing matches "{q}".
            </div>
          ) : (
            items.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  onPick(s.id);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted"
              >
                <div className="flex flex-col">
                  <span className="text-foreground">{s.id}</span>
                  <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{s.kind}</span>
                </div>
                <Badge tone={s.kind === 'crypto' ? 'accent' : 'warn'}>{s.kind}</Badge>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function supportsInterval(symbol: string, interval: Interval): boolean {
  const venue = symbol.split(':')[0]?.toUpperCase();
  // Binance Spot REST/klines: 1s, 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1mo.
  // We've never wired 5s/15s/30s so hide them for Binance until aggregation lands.
  if (venue === 'BINANCE') {
    const ok = new Set<Interval>(['1s','1m','3m','5m','15m','30m','1h','2h','4h','6h','12h','1d','1w','1mo']);
    return ok.has(interval);
  }
  // OANDA candles: S5, S15, S30, M1, M5, M15, M30, H1, H2, H4, H12, D, W, M.
  if (venue === 'OANDA') {
    const ok = new Set<Interval>(['5s','15s','30s','1m','5m','15m','30m','1h','2h','4h','12h','1d','1w','1mo']);
    return ok.has(interval);
  }
  return true;
}

const CURATED_SYMBOLS: Array<{ id: string; kind: 'crypto' | 'forex' }> = [
  { id: 'BINANCE:BTCUSDT', kind: 'crypto' },
  { id: 'BINANCE:ETHUSDT', kind: 'crypto' },
  { id: 'BINANCE:SOLUSDT', kind: 'crypto' },
  { id: 'BINANCE:BNBUSDT', kind: 'crypto' },
  { id: 'BINANCE:XRPUSDT', kind: 'crypto' },
  { id: 'BINANCE:DOGEUSDT', kind: 'crypto' },
  { id: 'BINANCE:AVAXUSDT', kind: 'crypto' },
  { id: 'BINANCE:ADAUSDT', kind: 'crypto' },
  { id: 'BINANCE:LINKUSDT', kind: 'crypto' },
  { id: 'BINANCE:DOTUSDT', kind: 'crypto' },
  { id: 'BINANCE:LTCUSDT', kind: 'crypto' },
  { id: 'BINANCE:MATICUSDT', kind: 'crypto' },
  { id: 'BINANCE:ARBUSDT', kind: 'crypto' },
  { id: 'BINANCE:OPUSDT', kind: 'crypto' },
  { id: 'BINANCE:NEARUSDT', kind: 'crypto' },
  { id: 'OANDA:EUR_USD', kind: 'forex' },
  { id: 'OANDA:GBP_USD', kind: 'forex' },
  { id: 'OANDA:USD_JPY', kind: 'forex' },
  { id: 'OANDA:USD_CHF', kind: 'forex' },
  { id: 'OANDA:AUD_USD', kind: 'forex' },
  { id: 'OANDA:NZD_USD', kind: 'forex' },
  { id: 'OANDA:USD_CAD', kind: 'forex' },
  { id: 'OANDA:XAU_USD', kind: 'forex' },
  { id: 'OANDA:XAG_USD', kind: 'forex' },
];
