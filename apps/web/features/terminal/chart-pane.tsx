'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChartCore,
  DARK_THEME,
  LIGHT_THEME,
  PriceSeriesLayer,
  LiquidityHeatmapLayer,
  VolumeProfileLayer,
  DeepTradesLayer,
  FootprintLayer,
  SignalsTrendScoreLayer,
  SmcLayer,
  IndicatorsLayer,
  MaCrossLayer,
  EconomicEventsLayer,
  computeMaCross,
  buildVisibleRangeProfile,
  computeSignalsTrendScore,
  computeMtfState,
  computeFvg,
  computeOrderBlocks,
  computeLiquidity,
  computeMarketStructure,
  computePremiumDiscount,
  computeAnchoredVwap,
  computeCvd,
  computeSessions,
  computeHvnLvn,
  computeRegime,
  toHeikinAshi,
  toRenko,
  toRangeBars,
  toLineBreak,
  toKagi,
  toPointAndFigure,
} from '@supercharts/chart-core';
import type {
  IndicatorOverlayBand,
  IndicatorOverlayDots,
  IndicatorOverlayLine,
  IndicatorOverlayArea,
  IndicatorOverlayHist,
  IndicatorOverlayLevel,
  IndicatorOverlayMarkers,
  IndicatorOverlayTints,
  ShadeLayer,
  EconomicEventMarker,
} from '@supercharts/chart-core';
import { computeAll, INDICATOR_LOOKUP, nakedPOC } from '@supercharts/indicators';
import { runScript, type RunResult } from '@supercharts/script-lang';
import { SubPaneIndicators, type SubPaneView } from './sub-pane-indicators';
import { ENTRY_INDEX, INDICATOR_DND_MIME, buildInstance } from './indicators-dialog';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { IndicatorLegend } from './indicator-legend';
import { SymbolStatusLine } from './symbol-status-line';
import { buildLegendRows } from './indicator-legend-util';
import { buildDataWindow } from './data-window-util';
import type { SignalsTrendScoreFrame } from '@supercharts/chart-core';
import { StsDashboard, type MtfRow } from './sts-dashboard';
import { TimeSalesPanel, type TapeRow } from './time-sales-panel';
import { DomLadderPanel, type Level } from './dom-ladder-panel';
import { OpenInterestPanel, type OIData } from './open-interest-panel';
import type {
  Candle,
  ChartType,
  DeepTradeBubble,
  FootprintBar,
  Interval,
  LiquidityHeatmapCell,
  ServerToClientMessage,
} from '@supercharts/types';
import { INTERVAL_MS as INTERVAL_MS_MAP } from '@supercharts/types';
import { api } from '@/lib/api';
import { fetchAlerts } from '@/lib/alerts';
import { getWSClient } from '@/lib/ws-client';
import type { AlertDefinition, AlertEvent } from '@supercharts/types';
import { useTheme } from '@/components/theme-provider';
import { formatPrice, formatPercent, formatSymbolLabel } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import type { PaneState } from './terminal-store';
import { useTerminalStore } from './terminal-store';
import { DrawingController } from './drawing-controller';
import type { DrawingObject } from '@supercharts/types';

interface ChartPaneProps {
  pane: PaneState;
  active: boolean;
  onClick?: () => void;
}

const HEATMAP_LIMIT = 1500;
const BUBBLE_LIMIT = 800;

export function ChartPane({ pane, active, onClick }: ChartPaneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<ChartCore | null>(null);
  const candleBufRef = useRef<Candle[]>([]);
  const heatmapBufRef = useRef<LiquidityHeatmapCell[]>([]);
  const bubbleBufRef = useRef<DeepTradeBubble[]>([]);
  /** Live footprint bars keyed by candle openTime (merged from snapshot + footprint_update). */
  const footprintBufRef = useRef<Map<number, FootprintBar>>(new Map());
  /** Time & Sales tape ring buffer (newest-first), flushed to state on a timer. */
  const tapeRef = useRef<TapeRow[]>([]);
  const [tapeRows, setTapeRows] = useState<TapeRow[]>([]);
  /** Live mirror of the tape toggle — the WS handler closure is pinned to symbol/interval,
   * so it must read the current value through a ref rather than the stale `pane`. */
  const tapeOnRef = useRef(false);
  /** Latest top-of-book snapshot for the DOM ladder, flushed to state on a timer. */
  const bookRef = useRef<{ bids: Level[]; asks: Level[] }>({ bids: [], asks: [] });
  const [domBook, setDomBook] = useState<{ bids: Level[]; asks: Level[] }>({ bids: [], asks: [] });
  const domOnRef = useRef(false);
  /** Open Interest (REST-polled from /api/futures/oi while the panel is on). */
  const [oiData, setOiData] = useState<OIData | null>(null);
  const [oiLoading, setOiLoading] = useState(false);
  const drawingsRef = useRef<DrawingObject[]>([]);
  const drawingControllerRef = useRef<DrawingController | null>(null);
  const loadedRangeRef = useRef<{ from: number; to: number }>({ from: 0, to: 0 });
  const loadingMoreRef = useRef(false);
  const [last, setLast] = useState<{ price: number; change: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [stsFrame, setStsFrame] = useState<SignalsTrendScoreFrame | null>(null);
  const [mtfRows, setMtfRows] = useState<MtfRow[]>([]);
  // Alerts targeting this pane's (symbol, interval). The MA cross layer renders
  // the FIRST matching alert; the rest still fire server-side but don't draw.
  const [paneAlerts, setPaneAlerts] = useState<AlertDefinition[]>([]);
  const alertsRefreshTick = useRef(0);
  const { theme } = useTheme();
  const resolvedTheme = useMemo(() => (theme === 'dark' ? DARK_THEME : LIGHT_THEME), [theme]);
  const drawTool = useTerminalStore((s) => s.drawTool);
  const setDrawTool = useTerminalStore((s) => s.setDrawTool);
  const backtestPreview = useTerminalStore((s) => s.backtestPreview);
  const syncCrosshair = useTerminalStore((s) => s.syncCrosshair);
  const setCrosshairTime = useTerminalStore((s) => s.setCrosshairTime);
  const externalCrosshairTime = useTerminalStore((s) => s.crosshairTime);
  const replayMode = useTerminalStore((s) => s.replayMode);
  const replayCursor = useTerminalStore((s) => s.replayCursor);
  const setReplayBounds = useTerminalStore((s) => s.setReplayBounds);
  const setPulseResult = useTerminalStore((s) => s.setPulseResult);
  const updateIndicator = useTerminalStore((s) => s.updateIndicator);
  const removeIndicator = useTerminalStore((s) => s.removeIndicator);
  const addIndicator = useTerminalStore((s) => s.addIndicator);
  const reorderIndicator = useTerminalStore((s) => s.reorderIndicator);
  const togglePaneOverlay = useTerminalStore((s) => s.togglePaneOverlay);
  const toggleSmcOverlay = useTerminalStore((s) => s.toggleSmcOverlay);
  const requestIndicatorSettings = useTerminalStore((s) => s.requestIndicatorSettings);
  const setDataWindow = useTerminalStore((s) => s.setDataWindow);
  const rightRailTab = useTerminalStore((s) => s.rightRailTab);
  // Refs so the drawing controller (created once per symbol/interval) sees the latest
  // tool selection and active-pane state without remounting.
  const drawToolRef = useRef<string | null>(drawTool);
  const activeRef = useRef<boolean>(active);
  drawToolRef.current = drawTool;
  activeRef.current = active;
  // On-chart indicator legend (M2): per-instance computed channels live in a ref (large arrays
  // stay out of React state); `legendTick` bumps a re-render when they recompute, and `hoverTime`
  // tracks the crosshair candle so the legend shows that bar's values (latest when off-chart).
  const indChannelsRef = useRef<Map<string, Record<string, number[]>>>(new Map());
  const [legendTick, setLegendTick] = useState(0);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  // Bumped (debounced via the chart's range-change callback) when the visible range pans/zooms,
  // so the React-rendered oscillator sub-panes re-read the chart's time projection and stay aligned.
  const [subTick, setSubTick] = useState(0);
  // Collapse toggle for the on-chart indicator legend (the symbol status line stays visible).
  const [legendCollapsed, setLegendCollapsed] = useState(false);
  // True while an indicator row from the browser dialog is dragged over this chart (drag-to-add, M6).
  const [dndOver, setDndOver] = useState(false);

  // Initial mount: create chart, load historical, subscribe.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const core = new ChartCore({
      canvas,
      theme: resolvedTheme,
      showVolumePane: pane.overlays.volume,
      onPointerEvent: (e) => {
        if (e.type === 'contextmenu') {
          setMenu({ x: e.x, y: e.y });
        } else if (e.type === 'pointerdown') {
          setMenu(null);
        }
      },
      shouldSuppressPan: () => {
        const t = drawToolRef.current;
        return Boolean(t && t !== 'cursor' && t !== 'crosshair' && activeRef.current);
      },
      onVisibleRangeChange: ({ fromTime, toTime }) => {
        // Re-align the oscillator sub-panes to the new pan/zoom window (this callback is already
        // debounced ~120ms in ChartCore, so this is a cheap, throttled re-render trigger).
        setSubTick((t) => t + 1);
        // Trigger progressive history load if the user has panned near or past the oldest
        // candle we've fetched so far. This pulls another window of equal duration from
        // the API and prepends it to the buffer.
        const loaded = loadedRangeRef.current;
        if (
          loaded.from > 0 &&
          !loadingMoreRef.current &&
          fromTime < loaded.from + (loaded.to - loaded.from) * 0.05
        ) {
          loadingMoreRef.current = true;
          const span = Math.max(loaded.to - loaded.from, 60_000);
          const newFrom = Math.max(0, loaded.from - span);
          const newTo = loaded.from;
          void api<{ candles: Candle[] }>('/candles', {
            searchParams: {
              symbol: pane.symbol,
              interval: pane.interval,
              from: newFrom,
              to: newTo,
              limit: 5000,
            },
          })
            .then((r) => {
              if (!r.candles || r.candles.length === 0) {
                loadedRangeRef.current.from = newFrom;
                return;
              }
              // Prepend, dedupe by openTime.
              const seen = new Set(candleBufRef.current.map((k) => k.openTime));
              const fresh = r.candles.filter((k) => !seen.has(k.openTime));
              if (fresh.length > 0) {
                candleBufRef.current = [...fresh, ...candleBufRef.current];
                if (candleBufRef.current.length > 10_000) {
                  candleBufRef.current = candleBufRef.current.slice(-10_000);
                }
                core.setCandles(
                  transformCandles(candleBufRef.current, pane.chartType, pane.symbol),
                );
              }
              loadedRangeRef.current.from = newFrom;
            })
            .catch(() => {
              loadedRangeRef.current.from = newFrom;
            })
            .finally(() => {
              loadingMoreRef.current = false;
            });
        }

        if (!pane.overlays.profile) return;
        const arr = candleBufRef.current;
        if (arr.length === 0) return;
        const visible = arr.filter((k) => k.openTime >= fromTime && k.openTime <= toTime);
        if (visible.length === 0) return;
        const profile = buildVisibleRangeProfile(visible, estimateRowSize(pane.symbol), 0.7);
        core.setVolumeProfile({
          mode: 'visible_range',
          symbol: pane.symbol,
          fromTime,
          toTime,
          rowSize: profile.rowSize,
          valueAreaPercent: 0.7,
          poc: profile.poc,
          vah: profile.vah,
          val: profile.val,
          totalVolume: profile.totalVolume,
          levels: profile.levels,
        });
      },
    });
    chartRef.current = core;
    if (typeof window !== 'undefined') {
      (window as unknown as { __sc_chart?: unknown }).__sc_chart = core;
    }

    // Drawing controller — only active in the active pane.
    const controller = new DrawingController({
      core,
      symbol: pane.symbol,
      userId: 'demo',
      getTool: () => (activeRef.current ? drawToolRef.current : null),
      clearTool: () => setDrawTool(null),
      initial: [],
      handlers: {
        onCreate: async (d) => {
          drawingsRef.current = [...drawingsRef.current, d];
          await api('/drawings', {
            method: 'POST',
            body: JSON.stringify({
              symbol: d.symbol,
              type: d.type,
              points: d.points,
              style: d.style as unknown as Record<string, string | number | boolean>,
              text: d.text,
              emoji: d.emoji,
              table: d.table,
              riskReward: d.riskReward,
              fib: d.fib,
              zIndex: d.zIndex,
              visible: d.visible,
              locked: d.locked,
            }),
          }).catch(() => {
            /* offline — ok */
          });
        },
        onUpdate: async (d) => {
          await api(`/drawings/${d.id}`, {
            method: 'PUT',
            body: JSON.stringify({ points: d.points, style: d.style as unknown as Record<string, string | number | boolean> }),
          }).catch(() => {});
        },
        onDelete: async (id) => {
          drawingsRef.current = drawingsRef.current.filter((d) => d.id !== id);
          await api(`/drawings/${id}`, { method: 'DELETE' }).catch(() => {});
        },
      },
    });
    drawingControllerRef.current = controller;

    // Load existing drawings.
    void api<{ items: DrawingObject[] }>('/drawings', { searchParams: { symbol: pane.symbol } })
      .then((r) => {
        drawingsRef.current = r.items;
        controller.setDrawings(r.items);
      })
      .catch(() => {});

    // Keyboard delete
    const onKey = (e: KeyboardEvent) => {
      if (!activeRef.current) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        controller.deleteSelected();
      } else if (e.key === 'Escape') {
        controller.cancelDraft();
        setDrawTool(null);
      }
    };
    window.addEventListener('keydown', onKey);

    const cleanupKey = () => window.removeEventListener('keydown', onKey);

    let cancelled = false;
    setLoadError(null);
    setLoading(true);

    (async () => {
      try {
        const now = Date.now();
        // Initial fetch scales by interval so the user gets a useful window without thrashing:
        // 1m → ~3 days, 1h → ~7 months, 1d → ~13 years. Capped at ~5000 bars.
        const intervalMs = INTERVAL_MS_MAP[pane.interval] ?? 60_000;
        const initialBars = 5000;
        const from = now - intervalMs * initialBars;
        loadedRangeRef.current = { from, to: now };
        const { candles } = await api<{ candles: Candle[] }>(
          '/candles',
          {
            searchParams: { symbol: pane.symbol, interval: pane.interval, from, to: now, limit: initialBars },
          },
        );
        if (cancelled) return;
        if (!candles?.length) {
          setLoadError(`No data available for ${pane.symbol} at ${pane.interval}.`);
          setLoading(false);
          return;
        }
        candleBufRef.current = candles;
        core.setCandles(transformCandles(candles, pane.chartType, pane.symbol));
        if (active && candles.length > 0) {
          setReplayBounds({
            from: candles[0]!.openTime,
            to: candles[candles.length - 1]!.closeTime,
          });
        }
        setLoading(false);
        applyOverlays(core, pane);
        if (pane.overlays.profile) {
          const profile = buildVisibleRangeProfile(candles, estimateRowSize(pane.symbol), 0.7);
          core.setVolumeProfile({
            mode: 'visible_range',
            symbol: pane.symbol,
            fromTime: candles[0]!.openTime,
            toTime: candles[candles.length - 1]!.closeTime,
            rowSize: profile.rowSize,
            valueAreaPercent: 0.7,
            poc: profile.poc,
            vah: profile.vah,
            val: profile.val,
            totalVolume: profile.totalVolume,
            levels: profile.levels,
          });
        }
        const lastK = candles[candles.length - 1]!;
        const firstK = candles[0]!;
        setLast({
          price: lastK.close,
          change: firstK.close > 0 ? ((lastK.close - firstK.close) / firstK.close) * 100 : 0,
        });
      } catch (err) {
         
        console.warn('[pane] historical load failed', err);
        if (!cancelled) {
          setLoading(false);
          setLoadError(`Could not load ${pane.symbol} (${pane.interval}).`);
        }
      }
    })();

    const ws = getWSClient();
    // CUSTOM: datasets (CSV imports) are static — there is no live provider to subscribe to.
    const isCustom = pane.symbol.startsWith('CUSTOM:');
    if (!isCustom) ws.subscribe(pane.symbol, pane.interval, ['candles', 'volume', 'heatmap', 'deepTrades']);

    const off = ws.on((msg: ServerToClientMessage) => {
      switch (msg.type) {
        case 'market_snapshot':
          if (msg.symbol !== pane.symbol || msg.interval !== pane.interval) return;
          if (msg.candles?.length) {
            candleBufRef.current = msg.candles;
            core.setCandles(transformCandles(msg.candles, pane.chartType, pane.symbol));
            const lastK = msg.candles[msg.candles.length - 1]!;
            const firstK = msg.candles[0]!;
            setLast({
              price: lastK.close,
              change: firstK.close > 0 ? ((lastK.close - firstK.close) / firstK.close) * 100 : 0,
            });
          }
          if (msg.heatmap?.length && pane.overlays.heatmap) {
            heatmapBufRef.current = msg.heatmap.slice(-HEATMAP_LIMIT);
            core.setHeatmapCells(heatmapBufRef.current);
          }
          if (msg.deepTrades?.length && pane.overlays.deepTrades) {
            bubbleBufRef.current = msg.deepTrades.slice(-BUBBLE_LIMIT);
            core.setDeepTrades(bubbleBufRef.current);
          }
          if (msg.footprint?.length && pane.overlays.footprint) {
            footprintBufRef.current = new Map(msg.footprint.map((b) => [b.openTime, b]));
            core.setFootprint([...footprintBufRef.current.values()]);
          }
          return;

        case 'candle_update':
          if (msg.symbol !== pane.symbol || msg.interval !== pane.interval) return;
          {
            // keep buffer aligned with the chart’s internal copy
            const arr = candleBufRef.current;
            const lastIdx = arr.length - 1;
            if (lastIdx >= 0 && arr[lastIdx]!.openTime === msg.candle.openTime) {
              arr[lastIdx] = msg.candle;
            } else if (lastIdx < 0 || arr[lastIdx]!.openTime < msg.candle.openTime) {
              arr.push(msg.candle);
              if (arr.length > 5000) arr.splice(0, arr.length - 5000);
            }
          }
          if (isPassThroughChartType(pane.chartType)) {
            core.upsertCandle(msg.candle);
          } else {
            // For derived series (Renko, Kagi, P&F, etc.) a single candle update can spawn
            // multiple new bricks/lines/columns, so rebuild from the buffer.
            core.setCandles(transformCandles(candleBufRef.current, pane.chartType, pane.symbol));
          }
          if (pane.overlays.profile) {
            const profile = buildVisibleRangeProfile(
              candleBufRef.current.slice(-500),
              estimateRowSize(pane.symbol),
              0.7,
            );
            core.setVolumeProfile({
              mode: 'visible_range',
              symbol: pane.symbol,
              fromTime: msg.candle.openTime,
              toTime: msg.candle.closeTime,
              rowSize: profile.rowSize,
              valueAreaPercent: 0.7,
              poc: profile.poc,
              vah: profile.vah,
              val: profile.val,
              totalVolume: profile.totalVolume,
              levels: profile.levels,
            });
          }
          setLast((s) => {
            const arr = candleBufRef.current;
            const first = arr[0];
            return {
              price: msg.candle.close,
              change: first && first.close > 0 ? ((msg.candle.close - first.close) / first.close) * 100 : s?.change ?? 0,
            };
          });
          return;

        case 'heatmap_update':
          if (msg.symbol !== pane.symbol || !pane.overlays.heatmap) return;
          heatmapBufRef.current = mergeHeatmap(heatmapBufRef.current, msg.cells);
          core.setHeatmapCells(heatmapBufRef.current);
          return;

        case 'deep_trade':
          if (msg.symbol !== pane.symbol || !pane.overlays.deepTrades) return;
          bubbleBufRef.current = [...bubbleBufRef.current, msg.bubble].slice(-BUBBLE_LIMIT);
          core.setDeepTrades(bubbleBufRef.current);
          return;

        case 'footprint_update': {
          if (msg.symbol !== pane.symbol || msg.interval !== pane.interval || !pane.overlays.footprint) return;
          const buf = footprintBufRef.current;
          buf.set(msg.bar.openTime, msg.bar);
          if (buf.size > 240) {
            const keys = [...buf.keys()].sort((a, b) => a - b);
            for (let i = 0; i < keys.length - 240; i += 1) buf.delete(keys[i]!);
          }
          core.setFootprint([...buf.values()].sort((a, b) => a.openTime - b.openTime));
          return;
        }

        case 'trade_tick': {
          if (msg.symbol !== pane.symbol || !tapeOnRef.current) return;
          const t = msg.trade;
          // Drop duplicates — the stream can re-deliver a print, which would collide on the
          // React key. The buffer is tiny (≤60) so the scan is cheap.
          if (tapeRef.current.some((r) => r.id === t.id)) return;
          const side: TapeRow['side'] =
            t.aggressorSide === 'buyer' ? 'buy' : t.aggressorSide === 'seller' ? 'sell' : 'unknown';
          tapeRef.current.unshift({ id: t.id, price: t.price, qty: t.quantity, notional: t.notional, side, time: t.eventTime });
          if (tapeRef.current.length > 60) tapeRef.current.length = 60;
          return;
        }

        case 'orderbook_delta': {
          if (msg.symbol !== pane.symbol || !domOnRef.current) return;
          // depth20 snapshots — just keep the latest top-of-book for the ladder.
          bookRef.current = { bids: msg.delta.bids, asks: msg.delta.asks };
          return;
        }
      }
    });

    return () => {
      cancelled = true;
      off();
      cleanupKey();
      controller.destroy();
      drawingControllerRef.current = null;
      try {
        ws.unsubscribe(pane.symbol);
      } catch {
        /* ignore */
      }
      core.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.symbol, pane.interval]);

  // Theme change.
  useEffect(() => {
    chartRef.current?.setTheme(resolvedTheme);
  }, [resolvedTheme]);

  // Cross-pane crosshair sync: publish the active pane's hover time + mirror others.
  useEffect(() => {
    const core = chartRef.current;
    if (!core) return;
    if (!syncCrosshair) {
      core.setExternalCrosshairTime(null);
      return;
    }
    if (active) {
      const off = core.onCrosshair((s) => setCrosshairTime(s.time));
      return off;
    }
    return undefined;
  }, [syncCrosshair, active, setCrosshairTime]);

  // Legend (M2): always-on crosshair subscription so the on-chart legend can show the hovered
  // bar's indicator values. Re-subscribes when the ChartCore is rebuilt (symbol/interval change).
  useEffect(() => {
    const core = chartRef.current;
    if (!core) return undefined;
    return core.onCrosshair((s) => setHoverTime(s.time));
  }, [pane.symbol, pane.interval]);

  // Legend (M2): recompute each visible classic indicator's channels into a ref whenever the
  // indicator set or candles change. Cheap (reuses @supercharts/indicators); kept out of state.
  useEffect(() => {
    const bars = candleBufRef.current;
    const next = new Map<string, Record<string, number[]>>();
    for (const inst of pane.classicIndicators) {
      if (!inst.visible) continue;
      const spec = INDICATOR_LOOKUP[inst.type];
      if (!spec) continue;
      const inputs = Object.fromEntries(spec.inputs.map((i) => [i.key, inst.inputs[i.key] ?? i.default]));
      try {
        next.set(inst.id, Object.fromEntries(computeAll(inst.type, bars, inputs).entries()));
      } catch {
        /* a single indicator failing must not break the legend */
      }
    }
    indChannelsRef.current = next;
    setLegendTick((t) => t + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.classicIndicators, candleBufRef.current.length, candleBufRef.current[candleBufRef.current.length - 1]?.close]);

  useEffect(() => {
    const core = chartRef.current;
    if (!core) return;
    if (!syncCrosshair || active) {
      core.setExternalCrosshairTime(null);
      return;
    }
    core.setExternalCrosshairTime(externalCrosshairTime);
  }, [externalCrosshairTime, syncCrosshair, active]);

  // Recompute series when chartType changes (Heikin Ashi → Renko → etc).
  useEffect(() => {
    const core = chartRef.current;
    if (!core) return;
    if (candleBufRef.current.length === 0) return;
    core.setCandles(transformCandles(candleBufRef.current, pane.chartType, pane.symbol));
    applyOverlays(core, pane);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.chartType]);

  // SMC indicator suite — recompute when any toggle flips or candles update.
  useEffect(() => {
    const core = chartRef.current;
    if (!core) return;
    const layer = core.getLayer<SmcLayer>('smc');
    if (!layer) return;
    const anyOn = Object.values(pane.smc).some(Boolean);
    layer.visible = anyOn;
    layer.options = {
      showFvg: pane.smc.fvg,
      showOrderBlocks: pane.smc.orderBlocks,
      showLiquidity: pane.smc.liquidity,
      showLiquiditySweeps: pane.smc.liquiditySweeps,
      showMarketStructure: pane.smc.marketStructure,
      showPremiumDiscount: pane.smc.premiumDiscount,
      showAnchoredVwap: pane.smc.anchoredVwap,
      showCvdDivergence: pane.smc.cvdDivergence,
      showSessions: pane.smc.sessions,
      showHvnLvn: pane.smc.hvnLvn,
      showRegimeBadge: pane.smc.regimeBadge,
    };
    if (!anyOn || candleBufRef.current.length < 30) {
      layer.frame = {};
      return;
    }
    const bars = candleBufRef.current;
    const fvgs = pane.smc.fvg ? computeFvg(bars) : undefined;
    const orderBlocks = pane.smc.orderBlocks ? computeOrderBlocks(bars) : undefined;
    const liq =
      pane.smc.liquidity || pane.smc.liquiditySweeps ? computeLiquidity(bars) : undefined;
    const ms =
      pane.smc.marketStructure ? computeMarketStructure(bars) : undefined;
    const structureChips = ms?.chips.map((ch) => ({
      pivotIndex: ch.pivot.index,
      pivotTime: bars[ch.pivot.index]!.openTime,
      pivotPrice: ch.pivot.price,
      label: ch.label,
    }));
    const pd = pane.smc.premiumDiscount ? computePremiumDiscount(bars) : null;
    const aw = pane.smc.anchoredVwap
      ? computeAnchoredVwap(bars, {
          anchorIndex: Math.max(0, bars.length - 500),
          multipliers: [1, 2, 3],
          source: 'hlc3',
        })
      : null;
    const cvd = pane.smc.cvdDivergence ? computeCvd(bars) : undefined;
    const sessions = pane.smc.sessions ? computeSessions(bars) : undefined;
    const hv = pane.smc.hvnLvn ? computeHvnLvn(bars) : null;
    const rg = pane.smc.regimeBadge ? computeRegime(bars) : null;
    layer.frame = {
      fvgs,
      orderBlocks,
      liquidityLevels: liq?.levels,
      liquiditySweeps: liq?.sweeps,
      structureEvents: ms?.events,
      structureChips,
      premiumDiscount: pd,
      anchoredVwap: aw,
      cvdDivergences: cvd?.divergences,
      sessions,
      hvnLvn: hv,
      regimeLabel: rg?.currentLabel ?? null,
    };
     
  }, [
    pane.smc,
    candleBufRef.current.length,
    candleBufRef.current[candleBufRef.current.length - 1]?.close,
  ]);

  // Signals & Trend Score: recompute the indicator whenever candles refresh or
  // the indicator settings change, then push the result into the canvas layer.
  useEffect(() => {
    const core = chartRef.current;
    if (!core) return;
    if (!pane.overlays.signalsTrendScore || candleBufRef.current.length === 0) {
      setStsFrame(null);
      const layer = core.getLayer<SignalsTrendScoreLayer>('signals-trend-score');
      if (layer) {
        layer.options.enabled = false;
        layer.visible = false;
        layer.frame = null;
      }
      return;
    }
    const frame = computeSignalsTrendScore(candleBufRef.current, {
      maLength: pane.stsSettings.maLength,
      atrPeriod: pane.stsSettings.atrPeriod,
      atrMultiplier: pane.stsSettings.atrMultiplier,
      emaLength: pane.stsSettings.emaLength,
      stFactor: pane.stsSettings.stFactor,
      stAtrPeriod: pane.stsSettings.stAtrPeriod,
      adxLength: pane.stsSettings.adxLength,
      adxThreshold: pane.stsSettings.adxThreshold,
      rsiLength: pane.stsSettings.rsiLength,
      rsiBull: pane.stsSettings.rsiBull,
      rsiBear: pane.stsSettings.rsiBear,
      swingLen: pane.stsSettings.swingLen,
      volLookback: pane.stsSettings.volLookback,
    });
    setStsFrame(frame);
    const layer = core.getLayer<SignalsTrendScoreLayer>('signals-trend-score');
    if (layer) {
      layer.options.enabled = true;
      layer.options.showMaCloud = pane.stsSettings.showMaCloud;
      layer.options.showAtrTrail = pane.stsSettings.showAtrTrail;
      layer.options.showSignals = pane.stsSettings.showSignals;
      layer.options.showSlTp = pane.stsSettings.showSlTp;
      layer.options.showUpHighlight = pane.stsSettings.showUpHighlight;
      layer.options.showDownHighlight = pane.stsSettings.showDownHighlight;
      layer.visible = true;
      layer.frame = frame;
      // Compute the most recent SL/TP from the latest buy/sell flip in the frame.
      if (frame) {
        let signalIdx = -1;
        let signalSide: 'long' | 'short' = 'long';
        for (let i = frame.buySignal.length - 1; i >= 0; i -= 1) {
          if (frame.buySignal[i]) {
            signalIdx = i;
            signalSide = 'long';
            break;
          }
          if (frame.sellSignal[i]) {
            signalIdx = i;
            signalSide = 'short';
            break;
          }
        }
        if (signalIdx >= 0) {
          const entry = candleBufRef.current[signalIdx]!.close;
          const sl = signalSide === 'long' ? frame.swingLow[signalIdx] || entry : frame.swingHigh[signalIdx] || entry;
          const risk = Math.abs(entry - sl);
          const tp1 = signalSide === 'long' ? entry + risk : entry - risk;
          const tp2 = signalSide === 'long' ? entry + risk * 2 : entry - risk * 2;
          const tp3 = signalSide === 'long' ? entry + risk * 3 : entry - risk * 3;
          layer.lastTrade = {
            side: signalSide,
            entry,
            sl,
            tp1,
            tp2,
            tp3,
            entryTime: candleBufRef.current[signalIdx]!.openTime,
          };
        } else {
          layer.lastTrade = null;
        }
      }
    }
     
  }, [
    pane.overlays.signalsTrendScore,
    pane.stsSettings,
    candleBufRef.current.length,
    // Tick on the close of the last candle so the indicator updates live.
    candleBufRef.current[candleBufRef.current.length - 1]?.close,
  ]);

  /* ─── MA cross alert visualization ─── */
  // Pull the user's alerts targeting this pane (symbol + interval). The MaCrossLayer
  // is fed the FIRST matching alert's parameters and the locally-computed cross
  // result; the engine still evaluates everything server-side. We refresh on
  // (symbol, interval, manual tick) and on every WS `alert_fired` matching this pane.
  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const all = await fetchAlerts();
        if (cancelled) return;
        const filtered = all.filter(
          (a) => a.symbol === pane.symbol && a.interval === pane.interval && a.enabled,
        );
        setPaneAlerts(filtered);
      } catch {
        // Anonymous demo user without server reachable — keep UI quiet.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [pane.symbol, pane.interval, alertsRefreshTick.current]);

  // Recompute the MA line + crosses whenever candles or the active alert change.
  useEffect(() => {
    const core = chartRef.current;
    if (!core) return;
    const layer = core.getLayer<MaCrossLayer>('ma-cross');
    if (!layer) return;
    const haveCandles = candleBufRef.current.length > 0;

    // A Strategy-Tester run pinned to THIS pane plots its own BUY/SELL on the real candles
    // (so the client can eyeball the exact entries the backtest used). It always renders —
    // it's an explicit user action — and overrides the alert-driven line below.
    const preview = backtestPreview && backtestPreview.paneId === pane.id ? backtestPreview : null;
    if (preview && haveCandles) {
      const result = computeMaCross(candleBufRef.current, {
        type: preview.maType,
        length: preview.fast,
        source: 'close',
        crossWith: { type: preview.maType, length: preview.slow },
      });
      layer.setOptions({
        enabled: true, buyLabel: 'BUY', sellLabel: 'SELL',
        lineColor: '#f5d524', slowLineColor: '#7c9cff', lineWidth: 1.6,
        buyColor: '#22c55e', sellColor: '#ef4444',
      });
      layer.setFrame(result);
      return;
    }

    // Only ma_cross alerts drive this on-chart MA line; indicator-condition alerts (M5) don't.
    // The "Signals" Layers toggle hides them (undefined on persisted panes → treated as shown).
    const showSignals = pane.overlays.maSignals !== false;
    const target = paneAlerts.find((a) => a.type === 'ma_cross');
    if (!target || !haveCandles || !showSignals) {
      layer.setOptions({ enabled: false });
      layer.setFrame(null);
      return;
    }
    // Thread `crossWith` (dual-MA mode) into the detector so the chart matches what
    // the server-side engine fires on. If absent, falls back to single-MA mode.
    const result = computeMaCross(candleBufRef.current, {
      ...target.config.ma,
      crossWith: target.config.crossWith,
    });
    layer.setOptions({
      enabled: true,
      buyLabel: target.config.labels.buy,
      sellLabel: target.config.labels.sell,
      lineColor: target.config.style?.lineColor ?? '#f5d524',
      slowLineColor: target.config.style?.slowLineColor ?? '#7c9cff',
      lineWidth: target.config.style?.lineWidth ?? 1.6,
      buyColor: target.config.style?.buyColor ?? '#22c55e',
      sellColor: target.config.style?.sellColor ?? '#ef4444',
    });
    layer.setFrame(result);

  }, [
    paneAlerts,
    backtestPreview,
    pane.id,
    pane.overlays.maSignals,
    candleBufRef.current.length,
    candleBufRef.current[candleBufRef.current.length - 1]?.close,
  ]);

  // Economic calendar overlay — push real macro events into the dedicated layer when toggled.
  // Events are global (not per-symbol) so they're fetched once and shared across panes.
  useEffect(() => {
    const core = chartRef.current;
    if (!core) return;
    const layer = core.getLayer<EconomicEventsLayer>('economic-events');
    if (!layer) return;
    if (!pane.overlays.economicEvents) {
      if (layer.visible) {
        layer.visible = false;
        core.invalidate();
      }
      return;
    }
    let cancelled = false;
    layer.visible = true;
    core.invalidate();
    void loadEconomicEvents().then((events) => {
      if (cancelled) return;
      const live = chartRef.current?.getLayer<EconomicEventsLayer>('economic-events');
      if (!live) return;
      live.options = { events, minImpact: 'medium' };
      live.visible = true;
      chartRef.current?.invalidate();
    });
    return () => {
      cancelled = true;
    };
    // symbol/interval are deps because the ChartCore (and all its layers) is rebuilt on those
    // changes — without re-running, the overlay would silently drop after a timeframe switch.
  }, [pane.overlays.economicEvents, pane.symbol, pane.interval]);

  // Subscribe to alert_fired so we toast and refresh.
  useEffect(() => {
    const ws = getWSClient();
    const off = ws.on((msg: ServerToClientMessage) => {
      if (msg.type !== 'alert_fired') return;
      const e: AlertEvent = msg.event;
      // Show a toast for every fire — even on other panes/symbols — so the trader
      // never misses a signal.
      // (Imported lazily to avoid pulling toast into the WS handler when SSR'd.)
      import('@/components/use-toast').then(({ toast }) => {
        toast({
          title: `${e.side === 'buy' ? '🟢' : '🔴'} ${e.side.toUpperCase()} · ${e.label}`,
          description: `${e.symbol.replace(':', ' · ')} @ ${e.price.toFixed(4)} · ${e.interval}`,
          tone: e.side === 'buy' ? 'success' : 'warn',
          durationMs: 6000,
        });
      });
      // If the fire is for THIS pane, nudge the recomputation pipeline.
      if (e.symbol === pane.symbol && e.interval === pane.interval) {
        alertsRefreshTick.current += 1;
        setPaneAlerts((prev) => prev.slice());
      }
    });
    return off;
  }, [pane.symbol, pane.interval]);

  // Multi-timeframe rows for the dashboard. Fetches a small batch of candles on each
  // configured TF and computes a lightweight trend-dir + bull/bear score per TF.
  useEffect(() => {
    if (!pane.overlays.signalsTrendScore) {
      setMtfRows([]);
      return;
    }
    let cancelled = false;
    const tfs: Array<{ label: string; interval: string }> = [
      { label: '5', interval: '5m' },
      { label: '15', interval: '15m' },
      { label: '30', interval: '30m' },
      { label: '60', interval: '1h' },
      { label: 'D', interval: '1d' },
    ];
    (async () => {
      const now = Date.now();
      const rows = await Promise.all(
        tfs.map(async (t) => {
          try {
            const { candles } = await api<{ candles: Candle[] }>('/candles', {
              searchParams: {
                symbol: pane.symbol,
                interval: t.interval,
                from: now - 60 * 24 * 60 * 60_000,
                to: now,
                limit: 300,
              },
            });
            const s = computeMtfState(candles);
            return {
              label: t.label,
              trendDir: s?.trendDir ?? null,
              bullScore: s?.bullScore ?? 0,
              bearScore: s?.bearScore ?? 0,
              rsi: s?.rsi ?? NaN,
            };
          } catch {
            return { label: t.label, trendDir: null, bullScore: 0, bearScore: 0, rsi: NaN };
          }
        }),
      );
      if (!cancelled) setMtfRows(rows);
    })();
    const id = setInterval(() => {
      if (cancelled) return;
      // Refresh once a minute when the indicator is on.
      void (async () => {
        const now = Date.now();
        const rows = await Promise.all(
          tfs.map(async (t) => {
            try {
              const { candles } = await api<{ candles: Candle[] }>('/candles', {
                searchParams: {
                  symbol: pane.symbol,
                  interval: t.interval,
                  from: now - 60 * 24 * 60 * 60_000,
                  to: now,
                  limit: 300,
                },
              });
              const s = computeMtfState(candles);
              return {
                label: t.label,
                trendDir: s?.trendDir ?? null,
                bullScore: s?.bullScore ?? 0,
                bearScore: s?.bearScore ?? 0,
                rsi: s?.rsi ?? NaN,
              };
            } catch {
              return { label: t.label, trendDir: null, bullScore: 0, bearScore: 0, rsi: NaN };
            }
          }),
        );
        if (!cancelled) setMtfRows(rows);
      })();
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pane.overlays.signalsTrendScore, pane.symbol]);

  // Overlay toggles + heatmap settings.
  useEffect(() => {
    const core = chartRef.current;
    if (!core) return;
    applyOverlays(core, pane);
    // Volume profile is built lazily (on load / on pan) only when it was already on. With
    // the blank-by-default chart the user toggles it on AFTER load, so build it now from
    // the current visible range — otherwise the layer is visible but has no data.
    if (pane.overlays.profile) {
      const { fromTime, toTime } = core.getVisibleRange();
      const arr = candleBufRef.current;
      const visible = arr.filter((k) => k.openTime >= fromTime && k.openTime <= toTime);
      const src = visible.length > 0 ? visible : arr;
      if (src.length > 0) {
        const built = buildVisibleRangeProfile(src, estimateRowSize(pane.symbol), 0.7);
        core.setVolumeProfile({
          mode: 'visible_range',
          symbol: pane.symbol,
          fromTime: src[0]!.openTime,
          toTime: src[src.length - 1]!.closeTime,
          rowSize: built.rowSize,
          valueAreaPercent: 0.7,
          poc: built.poc,
          vah: built.vah,
          val: built.val,
          totalVolume: built.totalVolume,
          levels: built.levels,
        });
      }
    }
  }, [
    pane.overlays.heatmap,
    pane.overlays.profile,
    pane.overlays.deepTrades,
    pane.overlays.volume,
    pane.overlays.footprint,
    pane.overlays.marketProfile,
    pane.heatmapSettings.opacity,
    pane.heatmapSettings.depth,
    pane.heatmapSettings.timeBucketMs,
    pane.chartType,
    pane,
  ]);

  // Real footprint: while the overlay is on, pull the per-cell bid/ask bars for the
  // visible range from the server on a short timer (~2.5s so the live bar refreshes).
  // Crypto (Binance trades) returns data; venues without a trade feed return nothing and
  // the layer falls back to the candle-split approximation.
  useEffect(() => {
    const core = chartRef.current;
    if (!core) return;
    if (!pane.overlays.footprint) {
      footprintBufRef.current.clear();
      core.setFootprint([]);
      return;
    }
    const ws = getWSClient();
    const request = (): void => {
      const arr = candleBufRef.current;
      if (arr.length === 0) return;
      const from = arr[Math.max(0, arr.length - 120)]!.openTime;
      const to = arr[arr.length - 1]!.closeTime;
      ws.send({ type: 'request_footprint', symbol: pane.symbol, interval: pane.interval, from, to, tickGrouping: 1 });
    };
    request();
    const timer = setInterval(request, 2500);
    return () => clearInterval(timer);
  }, [pane.overlays.footprint, pane.symbol, pane.interval]);

  // Time & Sales: trades arrive too fast to setState per print, so the WS handler fills a
  // ring buffer and this flushes it to render state ~2.5×/s. Resets on symbol/interval change.
  useEffect(() => {
    tapeOnRef.current = pane.overlays.timeAndSales;
    if (!pane.overlays.timeAndSales) {
      tapeRef.current = [];
      setTapeRows([]);
      return;
    }
    tapeRef.current = [];
    setTapeRows([]);
    const flush = (): void => setTapeRows([...tapeRef.current]);
    const timer = setInterval(flush, 400);
    return () => clearInterval(timer);
  }, [pane.overlays.timeAndSales, pane.symbol, pane.interval]);

  // DOM ladder: same pattern — orderbook_delta fills bookRef, flushed to state ~4×/s.
  useEffect(() => {
    domOnRef.current = pane.overlays.domLadder;
    if (!pane.overlays.domLadder) {
      bookRef.current = { bids: [], asks: [] };
      setDomBook({ bids: [], asks: [] });
      return;
    }
    bookRef.current = { bids: [], asks: [] };
    setDomBook({ bids: [], asks: [] });
    const flush = (): void => setDomBook({ bids: bookRef.current.bids, asks: bookRef.current.asks });
    const timer = setInterval(flush, 250);
    return () => clearInterval(timer);
  }, [pane.overlays.domLadder, pane.symbol, pane.interval]);

  // Open Interest: REST-poll the cached fapi proxy while the panel is on (OI moves slowly).
  useEffect(() => {
    if (!pane.overlays.openInterest) {
      setOiData(null);
      return;
    }
    let cancelled = false;
    const load = async (): Promise<void> => {
      setOiLoading(true);
      try {
        const res = await fetch(`/api/futures/oi?symbol=${encodeURIComponent(pane.symbol)}`);
        const json = (await res.json()) as OIData;
        if (!cancelled) setOiData(json);
      } catch {
        if (!cancelled) setOiData({ available: false, openInterest: null, history: [] });
      } finally {
        if (!cancelled) setOiLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pane.overlays.openInterest, pane.symbol]);

  // Bar replay — clip candles to the replay cursor while replayMode is on.
  useEffect(() => {
    const core = chartRef.current;
    if (!core) return;
    const all = candleBufRef.current;
    if (all.length === 0) return;
    if (!replayMode) {
      core.setCandles(transformCandles(all, pane.chartType, pane.symbol));
      return;
    }
    const clipped = all.filter((c) => c.openTime <= replayCursor);
    if (clipped.length > 0) {
      core.setCandles(transformCandles(clipped, pane.chartType, pane.symbol));
    }
  }, [replayMode, replayCursor, pane.chartType, pane.symbol]);

  // Classic TA indicators — compute + push to IndicatorsLayer (overlays only).
  // Sub-pane oscillators render in `SubPaneIndicators` below the canvas.
  useEffect(() => {
    const core = chartRef.current;
    if (!core) return;
    const layer = core.getLayer<IndicatorsLayer>('indicators');
    if (!layer) return;
    const bars = candleBufRef.current;
    const lines: IndicatorOverlayLine[] = [];
    const bands: IndicatorOverlayBand[] = [];
    const dots: IndicatorOverlayDots[] = [];
    if (bars.length === 0) {
      layer.options = { lines, bands, dots };
      return;
    }
    for (const inst of pane.classicIndicators) {
      if (!inst.visible) continue;
      const spec = INDICATOR_LOOKUP[inst.type];
      if (!spec || spec.pane !== 'overlay') continue;
      const inputs = Object.fromEntries(
        spec.inputs.map((i) => [i.key, inst.inputs[i.key] ?? i.default]),
      );
      const channels = computeAll(inst.type, bars, inputs);
      const color = (k: string): string =>
        String(inst.style[k] ?? spec.style[k] ?? spec.style.color ?? '#42a5f5');
      // Span of `lines` this instance contributes — used below to apply the user's line
      // width / style (solid·dashed·dotted) overrides from the Style tab without rewriting
      // every per-type push (defaults are untouched when those keys aren't set).
      const lineStart = lines.length;
      switch (inst.type) {
        case 'sma':
        case 'ema':
        case 'wma':
        case 'hma':
        case 'dema':
        case 'tema':
        case 'vwap': {
          const v = channels.get('value');
          if (v) lines.push({ id: inst.id, channel: 'value', values: v, color: color('color') });
          break;
        }
        case 'bollinger':
        case 'keltner': {
          const mid = channels.get('middle');
          const upper = channels.get('upper');
          const lower = channels.get('lower');
          if (upper && lower) {
            bands.push({
              id: inst.id,
              upper,
              lower,
              fillColor: 'rgba(144,164,174,0.06)',
              borderColor: color('bandColor'),
              borderWidth: 0.8,
            });
          }
          if (mid) lines.push({ id: inst.id, channel: 'middle', values: mid, color: color('middleColor') });
          break;
        }
        case 'donchian': {
          const upper = channels.get('upper');
          const lower = channels.get('lower');
          if (upper && lower) {
            bands.push({
              id: inst.id,
              upper,
              lower,
              fillColor: 'rgba(128,203,196,0.05)',
              borderColor: color('bandColor'),
              borderWidth: 0.8,
            });
          }
          break;
        }
        case 'supertrend': {
          const line = channels.get('line');
          const dir = channels.get('direction');
          if (line && dir) {
            // Single line — color stitched by direction. Render two lines so
            // segments where the trend flips get the right color.
            const upVals = line.map((v, i) => (dir[i]! > 0 ? v : NaN));
            const dnVals = line.map((v, i) => (dir[i]! < 0 ? v : NaN));
            lines.push({ id: inst.id + '_up', channel: 'line', values: upVals, color: color('upColor'), lineWidth: 1.5 });
            lines.push({ id: inst.id + '_dn', channel: 'line', values: dnVals, color: color('downColor'), lineWidth: 1.5 });
          }
          break;
        }
        case 'psar': {
          const v = channels.get('value');
          if (v) dots.push({ id: inst.id, values: v, color: color('color'), radius: Number(inst.style.dotSize ?? 2.5) });
          break;
        }
        case 'ichimoku': {
          const conv = channels.get('conversion');
          const base = channels.get('base');
          const spanA = channels.get('spanA');
          const spanB = channels.get('spanB');
          if (conv) lines.push({ id: inst.id + '_c', channel: 'conversion', values: conv, color: color('conversionColor') });
          if (base) lines.push({ id: inst.id + '_b', channel: 'base', values: base, color: color('baseColor') });
          if (spanA && spanB) {
            bands.push({
              id: inst.id + '_cloud',
              upper: spanA.map((a, i) => Math.max(a, spanB[i] ?? a)),
              lower: spanA.map((a, i) => Math.min(a, spanB[i] ?? a)),
              fillColor: 'rgba(38,166,154,0.10)',
            });
          }
          break;
        }
        case 'vwap_bands': {
          const vw = channels.get('vwap');
          const u1 = channels.get('upper1');
          const l1 = channels.get('lower1');
          const u2 = channels.get('upper2');
          const l2 = channels.get('lower2');
          const bandFill = String(inst.style.bandColor ?? spec.style.bandColor ?? 'rgba(38,198,218,0.10)');
          if (u2 && l2) bands.push({ id: inst.id + '_outer', upper: u2, lower: l2, fillColor: bandFill });
          if (u1 && l1) bands.push({ id: inst.id + '_inner', upper: u1, lower: l1, fillColor: bandFill });
          if (vw) lines.push({ id: inst.id + '_vwap', channel: 'vwap', values: vw, color: color('color'), lineWidth: 1.5 });
          break;
        }
        case 'initial_balance': {
          const ibHigh = channels.get('ibHigh');
          const ibLow = channels.get('ibLow');
          const ibMid = channels.get('ibMid');
          if (ibHigh) lines.push({ id: inst.id + '_ibh', channel: 'ibHigh', values: ibHigh, color: color('color'), lineWidth: 1.25 });
          if (ibLow) lines.push({ id: inst.id + '_ibl', channel: 'ibLow', values: ibLow, color: color('color'), lineWidth: 1.25 });
          if (ibMid) lines.push({ id: inst.id + '_ibm', channel: 'ibMid', values: ibMid, color: String(inst.style.midColor ?? spec.style.midColor ?? color('color')), lineWidth: 1, dash: [4, 4] });
          break;
        }
        case 'naked_poc': {
          // Variable number of levels (one per prior session) — computed directly
          // from bars, not via the fixed-channel runner. Naked levels extend to now
          // in the bright color; filled (revisited) ones stop at the touch, dimmed.
          const levels = nakedPOC(bars, { maxLevels: Number(inst.inputs.maxLevels ?? 25) });
          const filledColor = String(inst.style.filledColor ?? spec.style.filledColor ?? 'rgba(255,255,255,0.16)');
          for (let li = 0; li < levels.length; li++) {
            const lv = levels[li]!;
            const vals = new Array<number>(bars.length).fill(NaN);
            for (let k = lv.fromIndex; k <= lv.toIndex; k++) vals[k] = lv.price;
            lines.push({
              id: inst.id + '_npoc' + li,
              channel: 'poc',
              values: vals,
              color: lv.naked ? color('color') : filledColor,
              lineWidth: lv.naked ? 1.25 : 0.75,
              dash: lv.naked ? undefined : [3, 3],
            });
          }
          break;
        }
      }
      // Apply Style-tab line width / line style to every line this instance contributed.
      const lw = Number(inst.style.lineWidth);
      const ls = typeof inst.style.lineStyle === 'string' ? inst.style.lineStyle : undefined;
      const dash: [number, number] | undefined =
        ls === 'dashed' ? [6, 4] : ls === 'dotted' ? [2, 3] : undefined;
      for (let li = lineStart; li < lines.length; li += 1) {
        if (Number.isFinite(lw) && lw > 0) lines[li]!.lineWidth = lw;
        if (ls && ls !== 'solid') lines[li]!.dash = dash;
      }
    }
    layer.visible = lines.length > 0 || bands.length > 0 || dots.length > 0;
    layer.options = { lines, bands, dots };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.classicIndicators, candleBufRef.current.length, candleBufRef.current[candleBufRef.current.length - 1]?.close]);

  // PulseScript — run the active script over THIS pane's candles (so plot values align to the
  // rendered bars) and push draw/mark output to the dedicated 'pulse-script' overlay layer.
  // Driven by the store (Run / input changes bump runToken); reruns on new bars. Console,
  // errors, and the input schema are reported back to the store for the code terminal dialog.
  useEffect(() => {
    const core = chartRef.current;
    if (!core) return;
    const layer = core.getLayer<IndicatorsLayer>('pulse-script');
    if (!layer) return;
    const bgLayer = core.getLayer<ShadeLayer>('pulse-bg');
    const clear = (): void => {
      layer.visible = false;
      layer.options = { lines: [], bands: [], dots: [] };
      if (bgLayer) {
        bgLayer.visible = false;
        bgLayer.options = { colors: [] };
      }
    };
    const pulse = pane.pulse;
    if (pulse.runToken === 0) {
      // Untouched pane — stay dormant until the user runs a script.
      clear();
      return;
    }
    const bars = candleBufRef.current;
    if (!pulse.source.trim() || bars.length === 0) {
      clear();
      return;
    }
    try {
      const res: RunResult = runScript(pulse.source, bars, { inputs: pulse.inputValues, interval: pane.interval });
      const lines: IndicatorOverlayLine[] = [];
      const bands: IndicatorOverlayBand[] = [];
      const dots: IndicatorOverlayDots[] = [];
      const areas: IndicatorOverlayArea[] = [];
      const hists: IndicatorOverlayHist[] = [];
      const palette = ['#38bdf8', '#f59e0b', '#a78bfa', '#34d399', '#f472b6', '#facc15'];
      const DASH: Record<string, [number, number] | undefined> = { dashed: [6, 4], dotted: [2, 3], solid: undefined };
      res.plots.forEach((p, idx) => {
        const color = p.color || palette[idx % palette.length]!;
        const vals = p.values.map((v) => (v == null ? NaN : v));
        if (p.kind === 'band' && p.values2) {
          bands.push({
            id: 'pulse_' + idx,
            upper: vals,
            lower: p.values2.map((v) => (v == null ? NaN : v)),
            fillColor: pulseFill(color),
            borderColor: color,
            borderWidth: 0.8,
          });
        } else if (p.kind === 'area') {
          areas.push({ id: 'pulse_' + idx, values: vals, color, fillColor: pulseFill(color), lineWidth: p.width ?? 1.5 });
        } else if (p.kind === 'hist') {
          hists.push({ id: 'pulse_' + idx, values: vals, color });
        } else if (p.kind === 'dots') {
          dots.push({ id: 'pulse_' + idx, values: vals, color, radius: p.width ?? 2.5 });
        } else {
          lines.push({
            id: 'pulse_' + idx,
            channel: p.title || 'plot' + idx,
            values: vals,
            color,
            lineWidth: p.width ?? 1.6,
            dash: DASH[p.dash ?? 'solid'],
            step: p.kind === 'steps',
          });
        }
      });
      // marks → colored dots at the mark's bar + price (buy green, sell red, note grey).
      const markColor: Record<string, string> = { buy: '#22c55e', sell: '#ef4444', note: '#94a3b8' };
      const byKind = new Map<string, number[]>();
      for (const m of res.marks) {
        if (m.bar < 0 || m.bar >= bars.length) continue;
        let arr = byKind.get(m.kind);
        if (!arr) {
          arr = new Array<number>(bars.length).fill(NaN);
          byKind.set(m.kind, arr);
        }
        arr[m.bar] = m.price ?? bars[m.bar]!.close;
      }
      for (const [kind, vals] of byKind) {
        dots.push({ id: 'pulse_mark_' + kind, values: vals, color: markColor[kind] ?? '#94a3b8', radius: 4 });
      }
      // levels / markers / candle tints — the script's reference lines + shape stamps.
      const levels: IndicatorOverlayLevel[] = res.levels.map((l, i) => ({
        id: 'pulse_level_' + i,
        y: l.y,
        color: l.color || '#94a3b8',
        dash: DASH[l.dash] ?? [6, 4],
        label: l.title ?? undefined,
      }));
      const markers: IndicatorOverlayMarkers[] = res.shapes.length
        ? [
            {
              id: 'pulse_shapes',
              items: res.shapes
                .filter((s) => s.bar >= 0 && s.bar < bars.length)
                .map((s) => ({
                  index: s.bar,
                  shape: s.shape,
                  place: s.place,
                  price: s.price,
                  color:
                    s.color ||
                    (s.shape === 'triangleUp' || s.shape === 'arrowUp'
                      ? '#22c55e'
                      : s.shape === 'triangleDown' || s.shape === 'arrowDown'
                        ? '#ef4444'
                        : '#38bdf8'),
                  text: s.text,
                  size: s.size,
                })),
            },
          ]
        : [];
      const tints: IndicatorOverlayTints[] = res.barTints.some((t) => t)
        ? [{ id: 'pulse_tint', colors: res.barTints }]
        : [];
      const hasOutput =
        lines.length > 0 ||
        bands.length > 0 ||
        dots.length > 0 ||
        areas.length > 0 ||
        hists.length > 0 ||
        levels.length > 0 ||
        markers.length > 0 ||
        tints.length > 0;
      const hasBg = res.bgFills.some((f) => f);
      if (pulse.enabled) {
        layer.options = { lines, bands, dots, areas, hists, levels, markers, tints };
        layer.visible = hasOutput;
        if (bgLayer) {
          bgLayer.options = { colors: hasBg ? res.bgFills : [] };
          bgLayer.visible = hasBg;
        }
      } else {
        clear();
      }
      setPulseResult(pane.id, {
        ok: true,
        error: null,
        meta: res.meta as Record<string, number | boolean | string | null>,
        inputs: res.inputs,
        plotCount: res.plots.length,
        markCount: res.marks.length,
        levelCount: res.levels.length,
        shapeCount: res.shapes.length,
        paintCount: res.bgFills.filter(Boolean).length + res.barTints.filter(Boolean).length,
        alertCount: res.alerts.length,
        alerts: res.alerts.slice(-20),
        ranAt: Date.now(),
      });
    } catch (err) {
      clear();
      setPulseResult(pane.id, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        meta: {},
        inputs: [],
        plotCount: 0,
        markCount: 0,
        ranAt: Date.now(),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.id, pane.pulse.enabled, pane.pulse.source, pane.pulse.runToken, pane.pulse.inputValues, candleBufRef.current.length]);

  // Legend (M2): candle index under the crosshair (latest when off-chart), then the rows.
  const legendHoverIdx = useMemo(() => {
    const bars = candleBufRef.current;
    if (bars.length === 0) return -1;
    if (hoverTime == null) return bars.length - 1;
    let lo = 0;
    let hi = bars.length - 1;
    let ans = bars.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (bars[mid]!.openTime <= hoverTime) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverTime, legendTick, candleBufRef.current.length]);
  const legendRows = useMemo(
    () => buildLegendRows(pane.classicIndicators, (t) => INDICATOR_LOOKUP[t], indChannelsRef.current, legendHoverIdx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pane.classicIndicators, legendHoverIdx, legendTick],
  );

  // Live time→x projection mirrored from the chart so the oscillator sub-panes share its axis.
  // Recomputes on pan/zoom (subTick), crosshair move (hoverTime), data load (loading) and new
  // bars (legendTick / buffer length). Reading the ref here is safe — it's set on mount and these
  // deps cover every change that moves the projection.
  const subView = useMemo<SubPaneView | null>(
    () => chartRef.current?.getTimeProjection() ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [subTick, hoverTime, legendTick, loading, pane.symbol, pane.interval, candleBufRef.current.length],
  );

  // Bar feeding the symbol status line: the crosshair candle (or latest) + its prior close.
  const statusBuf = candleBufRef.current;
  const statusCandle =
    legendHoverIdx >= 0 && legendHoverIdx < statusBuf.length ? statusBuf[legendHoverIdx]! : null;
  const statusPrevClose = legendHoverIdx - 1 >= 0 ? statusBuf[legendHoverIdx - 1]?.close ?? null : null;

  // Data Window (M3): the ACTIVE pane publishes a compact snapshot (crosshair candle OHLCV +
  // every visible indicator's channel values) to the store; the right-rail Data tab renders it.
  // Only published while the Data tab is open — no point writing the store on every tick otherwise
  // (switching to the tab re-runs this via the rightRailTab dep, so it populates immediately).
  useEffect(() => {
    if (!active || rightRailTab !== 'data') return;
    setDataWindow(
      buildDataWindow(
        pane.id,
        candleBufRef.current,
        legendHoverIdx,
        hoverTime != null,
        pane.classicIndicators,
        (t) => INDICATOR_LOOKUP[t],
        indChannelsRef.current,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, rightRailTab, legendHoverIdx, legendTick, pane.classicIndicators, hoverTime, pane.id, setDataWindow]);

  return (
    <div
      onClick={onClick}
      className={`relative flex h-full flex-col overflow-hidden rounded-lg border ${
        active ? 'border-accent/60 shadow-[0_0_0_1px_hsl(var(--accent)/0.4)]' : 'border-border'
      } bg-surface/70`}
    >
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5">
        <div className="flex items-center gap-2 text-xs">
          <span className="dot-pulse bg-bull" />
          <span className="font-semibold tracking-tight text-foreground">{formatSymbolLabel(pane.symbol)}</span>
          <Badge tone="muted" className="text-[9px]">
            {pane.interval}
          </Badge>
          <Badge tone="muted" className="text-[9px]">
            {pane.chartType.replace('_', ' ')}
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-xs tabular-nums">
          <span className="text-foreground">{last ? formatPrice(last.price) : '—'}</span>
          <span className={(last?.change ?? 0) >= 0 ? 'text-bull' : 'text-bear'}>
            {last ? formatPercent(last.change) : '—'}
          </span>
        </div>
      </div>
      <div
        data-testid="chart-container"
        className="relative min-h-0 min-w-0 flex-1"
        onDragOver={(ev) => {
          // Allow dropping only indicator rows dragged from the browser dialog (M6).
          if (!ev.dataTransfer.types.includes(INDICATOR_DND_MIME)) return;
          ev.preventDefault();
          ev.dataTransfer.dropEffect = 'copy';
          if (!dndOver) setDndOver(true);
        }}
        onDragLeave={(ev) => {
          // Only clear when the cursor actually leaves the container (not on inner-child crossings).
          if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setDndOver(false);
        }}
        onDrop={(ev) => {
          const id = ev.dataTransfer.getData(INDICATOR_DND_MIME);
          setDndOver(false);
          if (!id) return;
          ev.preventDefault();
          const entry = ENTRY_INDEX.get(id);
          if (!entry) return;
          if (entry.kind === 'overlay') {
            if (!pane.overlays[entry.key]) togglePaneOverlay(pane.id, entry.key);
          } else if (entry.kind === 'smc') {
            if (!pane.smc[entry.key]) toggleSmcOverlay(pane.id, entry.key);
          } else {
            const spec = INDICATOR_LOOKUP[entry.type];
            if (spec) addIndicator(pane.id, buildInstance(spec));
          }
        }}
      >
        <canvas
          data-testid="chart-canvas"
          ref={canvasRef}
          className="absolute inset-0 h-full w-full"
        />
        <div className="pointer-events-none absolute left-2 top-2 z-20 flex max-w-[72%] flex-col items-start gap-0.5">
          <div className="flex items-center gap-1">
            <SymbolStatusLine candle={statusCandle} prevClose={statusPrevClose} atCrosshair={hoverTime != null} />
            {legendRows.length > 0 ? (
              <button
                type="button"
                title={legendCollapsed ? `Show ${legendRows.length} indicator${legendRows.length > 1 ? 's' : ''}` : 'Hide indicators'}
                aria-label={legendCollapsed ? 'Show indicators' : 'Hide indicators'}
                onClick={() => setLegendCollapsed((v) => !v)}
                className="pointer-events-auto flex items-center gap-0.5 rounded bg-surface/75 px-1 py-[3px] text-[10px] tabular-nums text-muted-foreground backdrop-blur-[1px] hover:text-foreground"
              >
                {legendCollapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
                {legendCollapsed ? legendRows.length : null}
              </button>
            ) : null}
          </div>
          {!legendCollapsed ? (
            <IndicatorLegend
              rows={legendRows}
              atCrosshair={hoverTime != null}
              onToggleVisible={(id) => {
                const inst = pane.classicIndicators.find((i) => i.id === id);
                if (inst) updateIndicator(pane.id, id, { visible: !inst.visible });
              }}
              onSettings={(id) => requestIndicatorSettings(id)}
              onRemove={(id) => removeIndicator(pane.id, id)}
              onReorder={(id, dir) => reorderIndicator(pane.id, id, dir)}
              onResetDefaults={(id) => {
                const inst = pane.classicIndicators.find((i) => i.id === id);
                const spec = inst ? INDICATOR_LOOKUP[inst.type] : undefined;
                if (!spec) return;
                updateIndicator(pane.id, id, {
                  inputs: Object.fromEntries(spec.inputs.map((i) => [i.key, i.default])),
                  style: { ...spec.style },
                });
              }}
              moveTargets={(id) => {
                // Only sub-pane indicators move panes (overlays live on price). Offer a fresh pane
                // plus a "merge into" for every other distinct sub-pane group.
                const inst = pane.classicIndicators.find((i) => i.id === id);
                const spec = inst ? INDICATOR_LOOKUP[inst.type] : undefined;
                if (!inst || !spec || spec.pane !== 'sub') return [];
                const cur = inst.paneId || inst.type;
                const out: { paneId: string; label: string }[] = [{ paneId: `sp_${id}`, label: 'New pane' }];
                const seen = new Set<string>([cur]);
                for (const o of pane.classicIndicators) {
                  if (o.id === id) continue;
                  const os = INDICATOR_LOOKUP[o.type];
                  if (!os || os.pane !== 'sub') continue;
                  const pid = o.paneId || o.type;
                  if (seen.has(pid)) continue;
                  seen.add(pid);
                  out.push({ paneId: pid, label: `Merge into ${o.name || os.label}` });
                }
                return out;
              }}
              onMoveToPane={(id, paneId) => updateIndicator(pane.id, id, { paneId })}
            />
          ) : null}
        </div>
        {loading && !loadError ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background/40 backdrop-blur-[2px]">
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface-raised/90 px-3 py-1.5 text-[11px] text-muted-foreground shadow-floating">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-r-transparent" />
              Loading {formatSymbolLabel(pane.symbol)} · {pane.interval}
            </div>
          </div>
        ) : null}
        {loadError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/85 p-4 text-center">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              No data
            </div>
            <p className="max-w-xs text-sm text-muted-foreground">{loadError}</p>
            <p className="text-[11px] text-muted-foreground/70">
              Symbol may be delisted or unavailable on this provider.
            </p>
          </div>
        ) : null}
        {menu ? (
          <ChartContextMenu
            x={menu.x}
            y={menu.y}
            pane={pane}
            onClose={() => setMenu(null)}
            onResetZoom={() => {
              const ev = new MouseEvent('dblclick');
              canvasRef.current?.dispatchEvent(ev);
              setMenu(null);
            }}
            onDeleteDrawing={() => {
              drawingControllerRef.current?.deleteSelected();
              setMenu(null);
            }}
          />
        ) : null}
        {pane.overlays.signalsTrendScore && stsFrame ? (
          <StsDashboard
            frame={stsFrame}
            mtfRows={mtfRows}
            showBottomStrip={pane.stsSettings.showBottomDash}
          />
        ) : null}
        {pane.overlays.timeAndSales ? (
          <TimeSalesPanel rows={tapeRows} hasData={pane.symbol.startsWith('BINANCE:')} />
        ) : null}
        {pane.overlays.domLadder ? (
          <DomLadderPanel bids={domBook.bids} asks={domBook.asks} hasData={pane.symbol.startsWith('BINANCE:')} />
        ) : null}
        {pane.overlays.openInterest ? <OpenInterestPanel data={oiData} loading={oiLoading} /> : null}
        {dndOver ? (
          <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-md border-2 border-dashed border-accent/70 bg-accent/10">
            <span className="rounded-md bg-surface-raised/90 px-3 py-1.5 text-xs font-medium text-foreground shadow-floating">
              Drop to add to this chart
            </span>
          </div>
        ) : null}
      </div>
      <SubPaneIndicators
        candles={candleBufRef.current}
        indicators={pane.classicIndicators}
        view={subView}
        hoverTime={hoverTime}
      />
    </div>
  );
}

function ChartContextMenu({
  x,
  y,
  pane,
  onClose,
  onResetZoom,
  onDeleteDrawing,
}: {
  x: number;
  y: number;
  pane: PaneState;
  onClose: () => void;
  onResetZoom: () => void;
  onDeleteDrawing: () => void;
}) {
  const togglePaneOverlay = useTerminalStore((s) => s.togglePaneOverlay);
  return (
    <div className="absolute inset-0" onClick={onClose}>
      <div
        role="menu"
        className="absolute z-30 w-56 rounded-lg border border-border bg-surface-raised/95 p-1 text-xs shadow-floating backdrop-blur"
        style={{ left: x, top: y }}
        onClick={(e) => e.stopPropagation()}
      >
        <MenuItem label="Reset zoom" hint="dbl-click" onClick={onResetZoom} />
        <MenuItem label="Delete selected drawing" hint="Del" onClick={onDeleteDrawing} />
        <MenuSeparator />
        <MenuItem
          label={pane.overlays.heatmap ? 'Hide heatmap' : 'Show heatmap'}
          onClick={() => {
            togglePaneOverlay(pane.id, 'heatmap');
            onClose();
          }}
        />
        <MenuItem
          label={pane.overlays.profile ? 'Hide volume profile' : 'Show volume profile'}
          onClick={() => {
            togglePaneOverlay(pane.id, 'profile');
            onClose();
          }}
        />
        <MenuItem
          label={pane.overlays.deepTrades ? 'Hide deep trades' : 'Show deep trades'}
          onClick={() => {
            togglePaneOverlay(pane.id, 'deepTrades');
            onClose();
          }}
        />
        <MenuItem
          label={pane.overlays.footprint ? 'Hide footprint' : 'Show footprint'}
          onClick={() => {
            togglePaneOverlay(pane.id, 'footprint');
            onClose();
          }}
        />
        <MenuItem
          label={pane.overlays.volume ? 'Hide volume pane' : 'Show volume pane'}
          onClick={() => {
            togglePaneOverlay(pane.id, 'volume');
            onClose();
          }}
        />
      </div>
    </div>
  );
}

function MenuItem({
  label,
  hint,
  onClick,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-muted"
    >
      <span>{label}</span>
      {hint ? <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{hint}</span> : null}
    </button>
  );
}

function MenuSeparator() {
  return <div className="my-1 h-px bg-border" />;
}

/**
 * Run the chart-type's series transformation when needed. Passthrough types use the raw
 * candles; algorithmic types (Renko, Kagi, P&F, Line break, Range bar) build a new series
 * that the existing candlestick renderer can draw via the same primitives.
 */
function transformCandles(candles: Candle[], chartType: ChartType, symbol: string): Candle[] {
  if (candles.length === 0) return candles;
  switch (chartType) {
    case 'heikin_ashi':
      return toHeikinAshi(candles);
    case 'renko': {
      // Auto-size brick = ~0.25% of mid for crypto, scaled by tick. Caller can refine later.
      const last = candles[candles.length - 1]!;
      const brickSize = Math.max(estimateRowSize(symbol), Math.abs(last.close) * 0.0015);
      return toRenko(candles, { brickSize, useATR: true, atrPeriod: 14, useWicks: true });
    }
    case 'range_bar': {
      const last = candles[candles.length - 1]!;
      const range = Math.max(estimateRowSize(symbol) * 4, Math.abs(last.close) * 0.0015);
      return toRangeBars(candles, { range });
    }
    case 'line_break':
      return toLineBreak(candles, { count: 3 });
    case 'kagi': {
      const last = candles[candles.length - 1]!;
      const reversal = Math.max(estimateRowSize(symbol) * 5, Math.abs(last.close) * 0.004);
      return toKagi(candles, { reversal });
    }
    case 'point_and_figure': {
      const last = candles[candles.length - 1]!;
      const boxSize = Math.max(estimateRowSize(symbol), Math.abs(last.close) * 0.002);
      return toPointAndFigure(candles, { boxSize, reversalBoxes: 3 });
    }
    case 'tick_bar':
    case 'volume_bar':
    case 'dollar_bar':
      // True implementations need raw trade ticks; for now fall back to source candles.
      return candles;
    default:
      return candles;
  }
}

function isPassThroughChartType(chartType: ChartType): boolean {
  switch (chartType) {
    case 'heikin_ashi':
    case 'renko':
    case 'range_bar':
    case 'line_break':
    case 'kagi':
    case 'point_and_figure':
      return false;
    default:
      return true;
  }
}

function applyOverlays(core: ChartCore, pane: PaneState): void {
  // Some "chart types" are actually overlays riding on top of regular candlesticks
  // (footprint, TPO, session volume profile). When the user picks one of those, the
  // candlestick series stays as-is and we just flip the appropriate overlay on.
  const ct = pane.chartType;
  const isFootprintChart = ct === 'footprint';
  const isProfileChart = ct === 'tpo' || ct === 'session_volume_profile';

  const heatmap = core.getLayer<LiquidityHeatmapLayer>('heatmap');
  if (heatmap) {
    heatmap.options.enabled = pane.overlays.heatmap;
    heatmap.options.opacity = pane.heatmapSettings.opacity;
    heatmap.visible = pane.overlays.heatmap;
  }
  const profile = core.getLayer<VolumeProfileLayer>('volume-profile');
  if (profile) profile.visible = pane.overlays.profile || isProfileChart;
  const deep = core.getLayer<DeepTradesLayer>('deep-trades');
  if (deep) deep.visible = pane.overlays.deepTrades;
  const series = core.getLayer<PriceSeriesLayer>('price-series');
  if (series) {
    // When the chart-type is an overlay, render the candles underneath as a normal candlestick.
    series.options.chartType = isFootprintChart || isProfileChart ? 'candlestick' : pane.chartType;
  }
  const footprint = core.getLayer<FootprintLayer>('footprint');
  if (footprint) {
    const on = pane.overlays.footprint || isFootprintChart;
    footprint.options.enabled = on;
    footprint.visible = on;
  }
  // Per-session Market Profile / TPO backdrop — self-computes from candles.
  const marketProfile = core.getLayer('market-profile');
  if (marketProfile) marketProfile.visible = pane.overlays.marketProfile;
  // Volume sub-pane histogram — was always-on; now respects the Volume toggle so a
  // fresh chart is truly blank (candles only).
  const volume = core.getLayer('volume');
  if (volume) volume.visible = pane.overlays.volume;
  // …and the band itself collapses when hidden, returning its height to the candles
  // (otherwise an empty 18% strip sits at the bottom of every volume-less chart).
  core.setVolumePaneVisible(pane.overlays.volume);
}

/** Translucent fill for a PulseScript `band` derived from its line color. */
// The macro calendar is global (not per-symbol), so fetch it once per page load and share
// the promise across every pane. Failures resolve to [] — the overlay simply shows nothing,
// never fabricated events.
let economicEventsMemo: Promise<EconomicEventMarker[]> | null = null;
function loadEconomicEvents(): Promise<EconomicEventMarker[]> {
  if (!economicEventsMemo) {
    economicEventsMemo = api<{ events: EconomicEventMarker[] }>('/calendar/economic')
      .then((r) => r.events ?? [])
      .catch(() => []);
  }
  return economicEventsMemo;
}

function pulseFill(color: string): string {
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
    const hex = color.length === 4 ? color.slice(1).split('').map((c) => c + c).join('') : color.slice(1);
    const n = parseInt(hex, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.12)`;
  }
  return 'rgba(56,189,248,0.12)';
}

function estimateRowSize(symbol: string): number {
  if (symbol.includes('BTC')) return 5;
  if (symbol.includes('ETH')) return 0.5;
  if (symbol.includes('SOL')) return 0.05;
  if (symbol.includes('BNB')) return 0.1;
  if (symbol.includes('USD')) return 0.0001;
  return 1;
}

function mergeHeatmap(prev: LiquidityHeatmapCell[], incoming: LiquidityHeatmapCell[]): LiquidityHeatmapCell[] {
  if (incoming.length === 0) return prev;
  const merged = [...prev, ...incoming];
  if (merged.length > HEATMAP_LIMIT * 2) {
    merged.splice(0, merged.length - HEATMAP_LIMIT * 2);
  }
  return merged.slice(-HEATMAP_LIMIT);
}
