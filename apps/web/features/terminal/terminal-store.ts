'use client';

import { create } from 'zustand';
import type { ChartType, IndicatorInstance, Interval } from '@supercharts/types';
import { DEFAULT_LAYOUT_ID, getLayout, type PaneLayout } from './layouts';

/** Legacy export kept for backwards-compat with old saved layouts. */
export type GridSize = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 12 | 14 | 16;

export interface PaneState {
  id: string;
  symbol: string;
  interval: Interval;
  chartType: ChartType;
  overlays: {
    heatmap: boolean;
    profile: boolean;
    deepTrades: boolean;
    volume: boolean;
    footprint: boolean;
    /** "Signals & Trend Score" indicator: MA cloud + ATR trail + Buy/Sell + MTF dashboards. */
    signalsTrendScore: boolean;
  };
  /** SMC / order-flow indicator toggles. Each maps 1:1 to a SmcLayer flag. */
  smc: {
    fvg: boolean;
    orderBlocks: boolean;
    liquidity: boolean;
    liquiditySweeps: boolean;
    marketStructure: boolean;
    premiumDiscount: boolean;
    anchoredVwap: boolean;
    cvdDivergence: boolean;
    sessions: boolean;
    hvnLvn: boolean;
    regimeBadge: boolean;
  };
  heatmapSettings: {
    opacity: number; // 0..1
    depth: number; // 5..100
    timeBucketMs: number; // 250..5000
  };
  stsSettings: {
    maLength: number;
    atrPeriod: number;
    atrMultiplier: number;
    showMaCloud: boolean;
    showAtrTrail: boolean;
    showSignals: boolean;
    showBottomDash: boolean;
    showSlTp: boolean;
    showUpHighlight: boolean;
    showDownHighlight: boolean;
    emaLength: number;
    stFactor: number;
    stAtrPeriod: number;
    adxLength: number;
    adxThreshold: number;
    rsiLength: number;
    rsiBull: number;
    rsiBear: number;
    swingLen: number;
    volLookback: number;
  };
  /** Classic TA indicator instances active on this pane. */
  classicIndicators: IndicatorInstance[];
}

interface TerminalStore {
  /** Currently selected layout id (see `PANE_LAYOUTS`). */
  layoutId: string;
  /** Convenience: the resolved layout, kept in sync with layoutId. */
  layout: PaneLayout;
  panes: PaneState[];
  activePaneId: string;
  drawTool: string | null;
  showLeftRail: boolean;
  showRightRail: boolean;
  showBottomPanel: boolean;
  syncCrosshair: boolean;
  /** Most-recent crosshair time (UNIX ms). Other panes can mirror this. */
  crosshairTime: number | null;
  setCrosshairTime: (t: number | null) => void;
  /** Bar replay state — clips visible candles to `replayCursor` when active. */
  replayMode: boolean;
  replayPlaying: boolean;
  replayCursor: number;
  replaySpeed: number;
  replayBounds: { from: number; to: number };
  setReplayMode: (v: boolean) => void;
  setReplayPlaying: (v: boolean) => void;
  setReplayCursor: (t: number) => void;
  setReplaySpeed: (s: number) => void;
  setReplayBounds: (b: { from: number; to: number }) => void;
  setLayout: (layoutId: string) => void;
  setActivePane: (id: string) => void;
  setPaneSymbol: (id: string, symbol: string) => void;
  setPaneInterval: (id: string, interval: Interval) => void;
  setPaneChartType: (id: string, t: ChartType) => void;
  togglePaneOverlay: (id: string, overlay: keyof PaneState['overlays']) => void;
  toggleSmcOverlay: (id: string, overlay: keyof PaneState['smc']) => void;
  setHeatmapSetting: (id: string, key: keyof PaneState['heatmapSettings'], value: number) => void;
  setStsSetting: <K extends keyof PaneState['stsSettings']>(
    id: string,
    key: K,
    value: PaneState['stsSettings'][K],
  ) => void;
  addIndicator: (id: string, indicator: IndicatorInstance) => void;
  removeIndicator: (id: string, indicatorId: string) => void;
  updateIndicator: (
    id: string,
    indicatorId: string,
    patch: Partial<IndicatorInstance>,
  ) => void;
  setDrawTool: (tool: string | null) => void;
  setShowLeftRail: (v: boolean) => void;
  setShowRightRail: (v: boolean) => void;
  setShowBottomPanel: (v: boolean) => void;
  setSyncCrosshair: (v: boolean) => void;
}

const SYMBOLS = [
  'BINANCE:BTCUSDT',
  'BINANCE:ETHUSDT',
  'BINANCE:SOLUSDT',
  'BINANCE:BNBUSDT',
  'BINANCE:XRPUSDT',
  'BINANCE:DOGEUSDT',
  'BINANCE:AVAXUSDT',
  'BINANCE:ADAUSDT',
  'BINANCE:LINKUSDT',
  'BINANCE:DOTUSDT',
  'BINANCE:LTCUSDT',
  'BINANCE:TRXUSDT',
  'BINANCE:NEARUSDT',
  'BINANCE:ARBUSDT',
  'BINANCE:OPUSDT',
  'BINANCE:SUIUSDT',
];

function defaultPane(id: string, symbol: string): PaneState {
  return {
    id,
    symbol,
    interval: '1m',
    chartType: 'candlestick',
    overlays: {
      heatmap: true,
      profile: true,
      deepTrades: true,
      volume: true,
      footprint: false,
      signalsTrendScore: false,
    },
    smc: {
      fvg: false,
      orderBlocks: false,
      liquidity: false,
      liquiditySweeps: false,
      marketStructure: false,
      premiumDiscount: false,
      anchoredVwap: false,
      cvdDivergence: false,
      sessions: false,
      hvnLvn: false,
      regimeBadge: false,
    },
    heatmapSettings: { opacity: 0.85, depth: 20, timeBucketMs: 1000 },
    classicIndicators: [],
    stsSettings: {
      maLength: 17,
      atrPeriod: 14,
      atrMultiplier: 1,
      showMaCloud: true,
      showAtrTrail: true,
      showSignals: true,
      showBottomDash: true,
      showSlTp: true,
      showUpHighlight: false,
      showDownHighlight: false,
      emaLength: 21,
      stFactor: 2,
      stAtrPeriod: 10,
      adxLength: 14,
      adxThreshold: 23,
      rsiLength: 14,
      rsiBull: 55,
      rsiBear: 45,
      swingLen: 10,
      volLookback: 10,
    },
  };
}

function panesForCount(count: number, carryOver?: PaneState[]): PaneState[] {
  return Array.from({ length: count }, (_, i) => {
    const symbol = carryOver?.[i]?.symbol ?? SYMBOLS[i] ?? 'BINANCE:BTCUSDT';
    const base = defaultPane(`p${i}`, symbol);
    if (carryOver?.[i]) {
      return {
        ...base,
        symbol: carryOver[i]!.symbol,
        interval: carryOver[i]!.interval,
        chartType: carryOver[i]!.chartType,
        overlays: { ...carryOver[i]!.overlays },
        heatmapSettings: { ...carryOver[i]!.heatmapSettings },
        classicIndicators: carryOver[i]!.classicIndicators ?? [],
      };
    }
    return base;
  });
}

const initialLayout = getLayout(DEFAULT_LAYOUT_ID);

export const useTerminalStore = create<TerminalStore>((set) => ({
  layoutId: initialLayout.id,
  layout: initialLayout,
  panes: panesForCount(initialLayout.paneCount),
  activePaneId: 'p0',
  drawTool: null,
  showLeftRail: true,
  showRightRail: true,
  showBottomPanel: false,
  syncCrosshair: false,

  setLayout: (layoutId) =>
    set((state) => {
      const layout = getLayout(layoutId);
      const next = panesForCount(layout.paneCount, state.panes);
      return {
        layoutId: layout.id,
        layout,
        panes: next,
        activePaneId: next[0]?.id ?? 'p0',
      };
    }),

  setActivePane: (id) => set({ activePaneId: id }),

  setPaneSymbol: (id, symbol) =>
    set((state) => ({
      panes: state.panes.map((p) => (p.id === id ? { ...p, symbol } : p)),
    })),

  setPaneInterval: (id, interval) =>
    set((state) => ({
      panes: state.panes.map((p) => (p.id === id ? { ...p, interval } : p)),
    })),

  setPaneChartType: (id, t) =>
    set((state) => ({
      panes: state.panes.map((p) => (p.id === id ? { ...p, chartType: t } : p)),
    })),

  togglePaneOverlay: (id, overlay) =>
    set((state) => ({
      panes: state.panes.map((p) =>
        p.id === id ? { ...p, overlays: { ...p.overlays, [overlay]: !p.overlays[overlay] } } : p,
      ),
    })),

  toggleSmcOverlay: (id, overlay) =>
    set((state) => ({
      panes: state.panes.map((p) =>
        p.id === id ? { ...p, smc: { ...p.smc, [overlay]: !p.smc[overlay] } } : p,
      ),
    })),

  setHeatmapSetting: (id, key, value) =>
    set((state) => ({
      panes: state.panes.map((p) =>
        p.id === id ? { ...p, heatmapSettings: { ...p.heatmapSettings, [key]: value } } : p,
      ),
    })),

  setStsSetting: (id, key, value) =>
    set((state) => ({
      panes: state.panes.map((p) =>
        p.id === id ? { ...p, stsSettings: { ...p.stsSettings, [key]: value } } : p,
      ),
    })),

  addIndicator: (id, indicator) =>
    set((state) => ({
      panes: state.panes.map((p) =>
        p.id === id ? { ...p, classicIndicators: [...p.classicIndicators, indicator] } : p,
      ),
    })),

  removeIndicator: (id, indicatorId) =>
    set((state) => ({
      panes: state.panes.map((p) =>
        p.id === id
          ? { ...p, classicIndicators: p.classicIndicators.filter((i) => i.id !== indicatorId) }
          : p,
      ),
    })),

  updateIndicator: (id, indicatorId, patch) =>
    set((state) => ({
      panes: state.panes.map((p) =>
        p.id === id
          ? {
              ...p,
              classicIndicators: p.classicIndicators.map((i) =>
                i.id === indicatorId
                  ? { ...i, ...patch, inputs: { ...i.inputs, ...patch.inputs }, style: { ...i.style, ...patch.style } }
                  : i,
              ),
            }
          : p,
      ),
    })),

  setDrawTool: (tool) => set({ drawTool: tool }),
  setShowLeftRail: (v) => set({ showLeftRail: v }),
  setShowRightRail: (v) => set({ showRightRail: v }),
  setShowBottomPanel: (v) => set({ showBottomPanel: v }),
  setSyncCrosshair: (v) => set({ syncCrosshair: v }),
  crosshairTime: null,
  setCrosshairTime: (t) => set({ crosshairTime: t }),

  replayMode: false,
  replayPlaying: false,
  replayCursor: Date.now(),
  replaySpeed: 4,
  replayBounds: { from: Date.now() - 7 * 24 * 60 * 60_000, to: Date.now() },
  setReplayMode: (v) =>
    set((state) =>
      v
        ? {
            replayMode: true,
            replayPlaying: false,
            // Default cursor to 24h before now so the user actually sees motion.
            replayCursor: state.replayBounds.to - 24 * 60 * 60_000,
          }
        : { replayMode: false, replayPlaying: false },
    ),
  setReplayPlaying: (v) => set({ replayPlaying: v }),
  setReplayCursor: (t) => set({ replayCursor: t }),
  setReplaySpeed: (s) => set({ replaySpeed: s }),
  setReplayBounds: (b) => set({ replayBounds: b }),
}));
