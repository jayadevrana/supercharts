'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { toast } from '@/components/use-toast';
import {
  AlarmClock,
  AreaChart,
  BarChart3,
  Camera,
  CandlestickChart,
  Code2,
  Crosshair,
  History,
  LineChart,
  Maximize2,
  Minimize2,
  Save,
  Search,
} from 'lucide-react';
import { WorkspaceSettingsPopover } from './workspace-settings-popover';
import { IntervalSelector } from './interval-selector';
import { LayoutPicker } from './layout-picker';
import { MT5Chip } from './mt5-chip';
import { StrategyBuilderDialog } from './strategy-builder-dialog';
import { AlertsDialog } from './alerts-dialog';
import { BrandMark } from '@/components/brand-mark';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { useWSStatus } from '@/lib/ws-client';
import { IndicatorsDialog } from './indicators-dialog';
import { OandaConnectDialog } from './oanda-connect-dialog';
import { ImportCsvDialog } from './import-csv-dialog';
import { BacktestDialog } from './backtest-dialog';
import { WebhooksDialog } from './webhooks-dialog';
import { BroadcastDialog } from './broadcast-dialog';
import type { ChartType } from '@supercharts/types';
import { useTerminalStore } from './terminal-store';
import { PANE_LAYOUTS } from './layouts';
import { symbolResultLabel, symbolResultTone, type RemoteSymbolResult } from './symbol-search-util';

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

const RECENT_LAYOUT_LIMIT = 8;
const KNOWN_LAYOUT_IDS = new Set(PANE_LAYOUTS.map((l) => l.id));

interface SavedLayoutRecord {
  id: string;
  name: string;
  grid: string;
  config: unknown;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function savedLayoutConfig(layout: SavedLayoutRecord): Record<string, unknown> | null {
  return asRecord(layout.config);
}

function getRestorableLayoutId(layout: SavedLayoutRecord): string | null {
  const layoutId = savedLayoutConfig(layout)?.layoutId;
  return typeof layoutId === 'string' && KNOWN_LAYOUT_IDS.has(layoutId) ? layoutId : null;
}

function getSavedPaneCount(layout: SavedLayoutRecord): number | null {
  const config = savedLayoutConfig(layout);
  const paneCount = asRecord(config?.layout)?.paneCount;
  if (typeof paneCount === 'number' && Number.isFinite(paneCount) && paneCount > 0) {
    return Math.trunc(paneCount);
  }

  const panes = config?.panes;
  if (Array.isArray(panes) && panes.length > 0) return panes.length;

  const legacyGrid = Number(layout.grid);
  return Number.isFinite(legacyGrid) && legacyGrid > 0 ? legacyGrid : null;
}

function getSavedSymbolSummary(layout: SavedLayoutRecord): string | null {
  const panes = savedLayoutConfig(layout)?.panes;
  if (!Array.isArray(panes)) return null;

  const symbols: string[] = [];
  for (const item of panes) {
    const symbol = asRecord(item)?.symbol;
    if (typeof symbol === 'string' && symbol && !symbols.includes(symbol)) symbols.push(symbol);
  }
  if (symbols.length === 0) return null;

  const visible = symbols.slice(0, 2);
  const remaining = symbols.length - visible.length;
  return remaining > 0 ? `${visible.join(' · ')} +${remaining}` : visible.join(' · ');
}

/** A representative lucide icon for the chart-type trigger (TV shows the family at a glance). */
function chartTypeIcon(type: ChartType): React.ReactNode {
  const cls = 'h-4 w-4';
  if (type === 'line' || type === 'line_markers' || type === 'step_line') return <LineChart className={cls} />;
  if (type === 'area' || type === 'hlc_area' || type === 'baseline') return <AreaChart className={cls} />;
  if (type === 'bar' || type === 'column' || type === 'high_low') return <BarChart3 className={cls} />;
  return <CandlestickChart className={cls} />;
}

/** Thin vertical rule separating logical top-bar groups, TradingView-style. */
function Divider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden />;
}

function getActiveChartCanvas(paneId: string): HTMLCanvasElement | null {
  const panels = document.querySelectorAll<HTMLElement>('[data-testid="chart-panel"]');
  for (const panel of panels) {
    if (panel.dataset.paneId === paneId) {
      return panel.querySelector<HTMLCanvasElement>('[data-testid="chart-canvas"]');
    }
  }
  return null;
}

function snapshotFilename(symbol: string, interval: string): string {
  const safeSymbol = symbol.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'chart';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${safeSymbol}-${interval}-${stamp}.png`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TerminalTopBar() {
  const {
    panes,
    activePaneId,
    layoutId,
    layout,
    setLayout,
    setPaneSymbol,
    setPaneInterval,
    setPaneChartType,
    syncCrosshair,
    setSyncCrosshair,
    replayMode,
    setReplayMode,
    showBottomPanel,
    setShowBottomPanel,
  } = useTerminalStore();
  const active = panes.find((p) => p.id === activePaneId) ?? panes[0];
  const [saving, setSaving] = useState(false);
  const [layoutsOpen, setLayoutsOpen] = useState(false);
  const [savedLayouts, setSavedLayouts] = useState<SavedLayoutRecord[]>([]);
  const [layoutsLoading, setLayoutsLoading] = useState(false);
  const [layoutsError, setLayoutsError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const wsStatus = useWSStatus();
  // Strategy + Alerts dialogs are self-contained (own their open state).

  const loadSavedLayouts = useCallback(async () => {
    setLayoutsLoading(true);
    setLayoutsError(null);
    try {
      const result = await api<{ items: SavedLayoutRecord[] }>('/layouts');
      setSavedLayouts(result.items.slice(0, RECENT_LAYOUT_LIMIT));
    } catch (err) {
      setSavedLayouts([]);
      setLayoutsError(err instanceof Error ? err.message : String(err));
    } finally {
      setLayoutsLoading(false);
    }
  }, []);

  const applySavedGrid = useCallback(
    (saved: SavedLayoutRecord) => {
      const savedLayoutId = getRestorableLayoutId(saved);
      if (!savedLayoutId) {
        toast({
          title: 'Saved layout is view-only',
          description: 'This entry does not include a supported pane layout id.',
          tone: 'warn',
        });
        return;
      }

      setLayout(savedLayoutId);
      setLayoutsOpen(false);
      toast({ title: 'Layout grid applied', description: saved.name, tone: 'success' });
    },
    [setLayout],
  );

  const saveLayout = useCallback(async () => {
    if (!active) return;
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
      if (layoutsOpen) void loadSavedLayouts();
    } catch (err) {
      toast({
        title: 'Could not save layout',
        description: err instanceof Error ? err.message : String(err),
        tone: 'error',
      });
    } finally {
      setSaving(false);
    }
  }, [active, layout, layoutId, layoutsOpen, loadSavedLayouts, panes, saving]);

  const downloadChartSnapshot = useCallback(() => {
    if (!active) return;
    const canvas = getActiveChartCanvas(active.id);
    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      toast({ title: 'Chart snapshot unavailable', description: 'No rendered chart canvas was found.', tone: 'warn' });
      return;
    }

    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          toast({
            title: 'Could not export chart',
            description: 'The chart canvas did not produce an image.',
            tone: 'error',
          });
          return;
        }
        downloadBlob(blob, snapshotFilename(active.symbol, active.interval));
        toast({
          title: 'Chart snapshot downloaded',
          description: `${active.symbol} · ${active.interval}`,
          tone: 'success',
        });
      }, 'image/png');
    } catch (err) {
      toast({
        title: 'Could not export chart',
        description: err instanceof Error ? err.message : String(err),
        tone: 'error',
      });
    }
  }, [active]);

  const toggleFullscreen = useCallback(async () => {
    if (!document.fullscreenEnabled) {
      toast({ title: 'Fullscreen is not available', tone: 'warn' });
      return;
    }

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (err) {
      toast({
        title: 'Could not toggle fullscreen',
        description: err instanceof Error ? err.message : String(err),
        tone: 'error',
      });
    }
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    onFullscreenChange();
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

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

  useEffect(() => {
    if (layoutsOpen) void loadSavedLayouts();
  }, [layoutsOpen, loadSavedLayouts]);

  return (
    <header className="scroll-thin flex h-12 shrink-0 items-center gap-2 overflow-x-auto overflow-y-hidden border-b border-border bg-surface/85 px-3 backdrop-blur-xl">
      <Link href="/" className="mr-1">
        <BrandMark size={24} withWordmark={false} />
      </Link>
      <SymbolSearch
        value={active?.symbol ?? ''}
        onPick={(s) => {
          if (active) setPaneSymbol(active.id, s);
        }}
      />
      <Divider />
      <IntervalSelector
        value={active?.interval ?? '1m'}
        symbol={active?.symbol ?? ''}
        onChange={(v) => {
          if (active) setPaneInterval(active.id, v);
        }}
      />
      <Divider />
      <Select
        value={active?.chartType ?? 'candlestick'}
        onValueChange={(v) => {
          if (active) setPaneChartType(active.id, v as ChartType);
        }}
      >
        <SelectTrigger className="w-auto px-2" aria-label="Chart type" title="Chart type">
          {chartTypeIcon(active?.chartType ?? 'candlestick')}
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
      <Divider />
      <IndicatorsDialog />
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setShowBottomPanel(!showBottomPanel)}
        title="PulseScript editor (Pine Editor)"
        className={`gap-1 hover:text-foreground ${showBottomPanel ? 'text-accent' : 'text-muted-foreground'}`}
      >
        <Code2 className="h-3.5 w-3.5" /> Script
      </Button>
      <BacktestDialog />
      <ImportCsvDialog />
      <Button
        variant="ghost"
        size="sm"
        onClick={downloadChartSnapshot}
        className="shrink-0 px-2 text-muted-foreground hover:text-foreground"
        title="Download chart snapshot"
        aria-label="Download chart snapshot"
      >
        <Camera className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void toggleFullscreen()}
        className="shrink-0 px-2 text-muted-foreground hover:text-foreground"
        title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        aria-pressed={isFullscreen}
      >
        {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </Button>
      <div className="ml-auto flex items-center gap-2">
        <BroadcastDialog />
        <WebhooksDialog />
        <OandaConnectDialog />
        <Divider />
        <MT5Chip />
        <StrategyBuilderDialog
          defaultSymbol={active?.symbol ?? 'BINANCE:BTCUSDT'}
          defaultInterval={active?.interval ?? '1m'}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setReplayMode(!replayMode)}
          className="gap-1 text-muted-foreground hover:text-foreground"
          title={replayMode ? 'Exit bar replay and return to live data' : 'Enter bar replay'}
          aria-label={replayMode ? 'Exit bar replay and return to live data' : 'Enter bar replay'}
          aria-pressed={replayMode}
        >
          <AlarmClock className="h-3.5 w-3.5" /> {replayMode ? 'Live' : 'Replay'}
        </Button>
        <AlertsDialog activeSymbol={active?.symbol ?? 'BINANCE:BTCUSDT'} />
        <Button
          variant="ghost"
          size="sm"
          loading={saving}
          onClick={saveLayout}
          className="px-2 text-muted-foreground hover:text-foreground"
          title="Save layout (⌘S)"
          aria-label="Save layout"
        >
          <Save className="h-4 w-4" />
        </Button>
        <Popover open={layoutsOpen} onOpenChange={setLayoutsOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="px-2 text-muted-foreground hover:text-foreground"
              title="Saved layouts history"
              aria-label="Saved layouts history"
            >
              <History className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[360px] p-0">
            <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Saved layouts
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Recent saved chart grids
                </div>
              </div>
              <Button
                variant="ghost"
                size="xs"
                loading={layoutsLoading}
                onClick={() => void loadSavedLayouts()}
                className="shrink-0"
              >
                Refresh
              </Button>
            </div>
            {layoutsLoading ? (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                Loading saved layouts...
              </div>
            ) : layoutsError ? (
              <div className="space-y-3 px-3 py-4 text-center">
                <div>
                  <div className="text-sm font-medium text-foreground">Could not load saved layouts</div>
                  <div className="mt-1 break-words text-xs text-muted-foreground">{layoutsError}</div>
                </div>
                <Button variant="outline" size="sm" onClick={() => void loadSavedLayouts()}>
                  Retry
                </Button>
              </div>
            ) : savedLayouts.length === 0 ? (
              <div className="px-3 py-8 text-center">
                <div className="text-sm font-medium text-foreground">No saved layouts yet</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Save a chart layout to see it here.
                </div>
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto scroll-thin">
                {savedLayouts.map((saved) => {
                  const savedLayoutId = getRestorableLayoutId(saved);
                  const paneCount = getSavedPaneCount(saved);
                  const symbolSummary = getSavedSymbolSummary(saved);
                  const sameGrid = savedLayoutId === layoutId;
                  return (
                    <div
                      key={saved.id}
                      className="flex items-center gap-3 border-b border-border/60 px-3 py-2.5 last:border-b-0 hover:bg-muted"
                      title={new Date(saved.updatedAt).toLocaleString()}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">{saved.name}</span>
                          {saved.isDefault ? <Badge tone="accent">default</Badge> : null}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                          <span>{formatRelativeTime(saved.updatedAt)}</span>
                          <span>·</span>
                          <span>
                            {paneCount == null
                              ? `grid ${saved.grid}`
                              : `${paneCount} pane${paneCount === 1 ? '' : 's'}`}
                          </span>
                          {symbolSummary ? (
                            <>
                              <span>·</span>
                              <span className="max-w-[180px] truncate">{symbolSummary}</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                      {savedLayoutId ? (
                        <Button
                          variant={sameGrid ? 'subtle' : 'outline'}
                          size="xs"
                          disabled={sameGrid}
                          onClick={() => applySavedGrid(saved)}
                          className="shrink-0"
                        >
                          {sameGrid ? 'Current' : 'Apply grid'}
                        </Button>
                      ) : (
                        <Badge tone="muted" className="shrink-0">
                          view only
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </PopoverContent>
        </Popover>
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
        <WorkspaceSettingsPopover />
        {process.env.NEXT_PUBLIC_DEMO_MODE === '1' && (
          <Badge tone="accent" className="hidden md:inline-flex" title="Public read-only demo — changes are disabled">
            demo · read-only
          </Badge>
        )}
        <Badge
          tone={wsStatus === 'open' ? 'bull' : wsStatus === 'connecting' ? 'warn' : 'bear'}
          className="hidden items-center gap-1.5 md:inline-flex"
          title={
            wsStatus === 'open'
              ? 'Live data stream connected'
              : wsStatus === 'connecting'
                ? 'Reconnecting to live data…'
                : 'Disconnected'
          }
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              wsStatus === 'open' ? 'bg-current' : 'animate-pulse bg-current'
            }`}
          />
          {wsStatus === 'open' ? 'live' : wsStatus === 'connecting' ? 'reconnecting' : 'offline'}
        </Badge>
      </div>
    </header>
  );
}


function SymbolSearch({ value, onPick }: { value: string; onPick: (symbol: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [remote, setRemote] = useState<RemoteSymbolResult[]>([]);

  // Debounced remote search: query the API once the user types ≥2 chars, otherwise show curated.
  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setRemote([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const res = await api<{ items: RemoteSymbolResult[] }>(
          '/symbols/search',
          { searchParams: { q: trimmed, limit: 30 } },
        );
        setRemote(res.items);
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
          placeholder="Search symbol — BTC, INFY, NIFTY…"
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
                  <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{symbolResultLabel(s)}</span>
                </div>
                <Badge tone={symbolResultTone(s)}>{s.assetClass}</Badge>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const CURATED_SYMBOLS: RemoteSymbolResult[] = [
  ...['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'AVAXUSDT', 'ADAUSDT', 'LINKUSDT', 'DOTUSDT', 'LTCUSDT', 'MATICUSDT', 'ARBUSDT', 'OPUSDT', 'NEARUSDT'].map((rawSymbol) => ({ id: `BINANCE:${rawSymbol}`, rawSymbol, assetClass: 'crypto', venue: 'BINANCE' })),
  ...['EUR_USD', 'GBP_USD', 'USD_JPY', 'USD_CHF', 'AUD_USD', 'NZD_USD', 'USD_CAD', 'XAU_USD', 'XAG_USD'].map((rawSymbol) => ({ id: `OANDA:${rawSymbol}`, rawSymbol, assetClass: 'forex', venue: 'OANDA' })),
];
