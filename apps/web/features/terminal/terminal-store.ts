'use client';

import { create } from 'zustand';
import type { ChartType, IndicatorInstance, Interval } from '@supercharts/types';
import type { InputDef } from '@supercharts/script-lang';
import { DEFAULT_LAYOUT_ID, getLayout, type PaneLayout } from './layouts';
import type { DataWindowSnapshot } from './data-window-util';
import { reorderInstances } from './indicator-manager-util';

/** Default PulseScript shown in a fresh code terminal — exercises inputs, ta.*, draw, and marks. */
export const SAMPLE_PULSE = `# EMA cross study — PulseScript
meta(name: "EMA Cross", overlay: true)

let fastLen = input.num(12, "Fast EMA", 2, 100)
let slowLen = input.num(26, "Slow EMA", 2, 200)

let fast = ema(close, fastLen)
let slow = ema(close, slowLen)

draw line(fast, color: "#38bdf8", title: "Fast EMA")
draw line(slow, color: "#f59e0b", title: "Slow EMA")

when crossOver(fast, slow) {
  mark buy at low "Long"
}
when crossUnder(fast, slow) {
  mark sell at high "Short"
}
`;

/** Per-pane PulseScript editor + render state. */
export interface PulseState {
  source: string;
  /** Whether the last successful run's draw/mark output is shown on the chart. */
  enabled: boolean;
  /** Input overrides keyed by the script's input id. */
  inputValues: Record<string, number | boolean | string>;
  /** Bump to force ChartPane to re-run (Run button, input change). */
  runToken: number;
}

/** Result of a run, written by ChartPane and read by the code terminal dialog. */
export interface PulseResult {
  ok: boolean;
  error: string | null;
  meta: Record<string, number | boolean | string | null>;
  inputs: InputDef[];
  plotCount: number;
  markCount: number;
  /** Counts for the newer output channels (levels / markers / paints / alerts). */
  levelCount?: number;
  shapeCount?: number;
  paintCount?: number;
  alertCount?: number;
  /** The most recent `alert("…")` events of the run (capped), newest last. */
  alerts?: { bar: number; text: string }[];
  ranAt: number;
}

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
    /** Per-session Market Profile / TPO histogram (POC + value area) behind candles. */
    marketProfile: boolean;
    /** Live Time & Sales tape (per-trade prints) — crypto only. */
    timeAndSales: boolean;
    /** Live DOM ladder (top-of-book depth) — crypto only. */
    domLadder: boolean;
    /** Open Interest (Binance USD-M futures) panel — crypto only. */
    openInterest: boolean;
    /** "Signals & Trend Score" indicator: MA cloud + ATR trail + Buy/Sell + MTF dashboards. */
    signalsTrendScore: boolean;
    /** Economic calendar: high/medium-impact macro events as vertical markers. */
    economicEvents: boolean;
    /** MA-cross BUY/SELL labels from a matching alert (or a backtest preview). Default on. */
    maSignals: boolean;
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
  /** PulseScript editor + render state for this pane. */
  pulse: PulseState;
  /** Vertical price-scale mode (TV parity INC-12). Undefined = linear (legacy panes). */
  scaleMode?: 'linear' | 'log' | 'percent';
}

interface TerminalStore {
  /** Currently selected layout id (see `PANE_LAYOUTS`). */
  layoutId: string;
  /** Convenience: the resolved layout, kept in sync with layoutId. */
  layout: PaneLayout;
  panes: PaneState[];
  activePaneId: string;
  drawTool: string | null;
  /** A Strategy-Tester run pinned to a pane's chart so its BUY/SELL plot on real candles. */
  backtestPreview: { paneId: string; maType: 'sma' | 'ema'; fast: number; slow: number } | null;
  setBacktestPreview: (v: { paneId: string; maType: 'sma' | 'ema'; fast: number; slow: number } | null) => void;
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
  setPaneScaleMode: (id: string, mode: NonNullable<PaneState['scaleMode']>) => void;
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
  /** Move an indicator one slot up/down within a pane's list (legend + manager + render order). */
  reorderIndicator: (id: string, indicatorId: string, dir: 'up' | 'down') => void;
  setDrawTool: (tool: string | null) => void;
  setShowLeftRail: (v: boolean) => void;
  setShowRightRail: (v: boolean) => void;
  setShowBottomPanel: (v: boolean) => void;
  setSyncCrosshair: (v: boolean) => void;
  /** Controlled right-rail tab so other UI can switch to it (e.g. the on-chart legend gear → Ind). */
  rightRailTab: string;
  setRightRailTab: (tab: string) => void;
  /**
   * One-shot dialog opener so non-topbar surfaces (e.g. the chart context menu) can open
   * the Indicators / Alerts dialogs, which own their `open` state locally. Each request
   * bumps `token`; the dialog opens when it sees a new token for its kind.
   */
  dialogRequest: { kind: 'indicators' | 'alerts'; token: number } | null;
  requestDialog: (kind: 'indicators' | 'alerts') => void;
  /** When set, the Ind panel auto-opens that instance's settings editor, then clears this. */
  indicatorSettingsTarget: string | null;
  requestIndicatorSettings: (id: string) => void;
  clearIndicatorSettingsTarget: () => void;
  /** Data Window snapshot published by the active pane (crosshair candle OHLCV + indicator values). */
  dataWindow: DataWindowSnapshot | null;
  setDataWindow: (s: DataWindowSnapshot | null) => void;
  /** Latest PulseScript run result per pane id — written by ChartPane, read by the code terminal. */
  pulseResults: Record<string, PulseResult>;
  setPulseSource: (id: string, source: string) => void;
  setPulseEnabled: (id: string, enabled: boolean) => void;
  setPulseInput: (id: string, inputId: string, value: number | boolean | string) => void;
  runPulse: (id: string) => void;
  setPulseResult: (id: string, result: PulseResult) => void;
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
    // All overlays OFF by default — a fresh chart is candles-only. The user turns
    // indicators on from the Indicators dialog (TradingView-style blank-first UX).
    overlays: {
      heatmap: false,
      profile: false,
      deepTrades: false,
      volume: false,
      footprint: false,
      marketProfile: false,
      timeAndSales: false,
      domLadder: false,
      openInterest: false,
      signalsTrendScore: false,
      economicEvents: false,
      maSignals: true,
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
    pulse: { source: SAMPLE_PULSE, enabled: false, inputValues: {}, runToken: 0 },
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
        pulse: carryOver[i]!.pulse ?? base.pulse,
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
  backtestPreview: null,
  setBacktestPreview: (v) => set({ backtestPreview: v }),
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

  setPaneScaleMode: (id, mode) =>
    set((state) => ({
      panes: state.panes.map((p) => (p.id === id ? { ...p, scaleMode: mode } : p)),
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
  reorderIndicator: (id, indicatorId, dir) =>
    set((state) => ({
      panes: state.panes.map((p) =>
        p.id === id ? { ...p, classicIndicators: reorderInstances(p.classicIndicators, indicatorId, dir) } : p,
      ),
    })),

  setDrawTool: (tool) => set({ drawTool: tool }),
  setShowLeftRail: (v) => set({ showLeftRail: v }),
  setShowRightRail: (v) => set({ showRightRail: v }),
  setShowBottomPanel: (v) => set({ showBottomPanel: v }),
  setSyncCrosshair: (v) => set({ syncCrosshair: v }),
  rightRailTab: 'trade',
  setRightRailTab: (tab) => set({ rightRailTab: tab }),
  dialogRequest: null,
  requestDialog: (kind) =>
    set((s) => ({ dialogRequest: { kind, token: (s.dialogRequest?.token ?? 0) + 1 } })),
  indicatorSettingsTarget: null,
  requestIndicatorSettings: (id) => set({ rightRailTab: 'ind', indicatorSettingsTarget: id }),
  clearIndicatorSettingsTarget: () => set({ indicatorSettingsTarget: null }),
  dataWindow: null,
  setDataWindow: (s) => set({ dataWindow: s }),

  pulseResults: {},
  setPulseSource: (id, source) =>
    set((state) => ({
      panes: state.panes.map((p) =>
        p.id === id ? { ...p, pulse: { ...p.pulse, source, runToken: p.pulse.runToken + 1 } } : p,
      ),
    })),
  setPulseEnabled: (id, enabled) =>
    set((state) => ({
      panes: state.panes.map((p) =>
        p.id === id ? { ...p, pulse: { ...p.pulse, enabled, runToken: p.pulse.runToken + 1 } } : p,
      ),
    })),
  setPulseInput: (id, inputId, value) =>
    set((state) => ({
      panes: state.panes.map((p) =>
        p.id === id
          ? { ...p, pulse: { ...p.pulse, inputValues: { ...p.pulse.inputValues, [inputId]: value }, runToken: p.pulse.runToken + 1 } }
          : p,
      ),
    })),
  runPulse: (id) =>
    set((state) => ({
      panes: state.panes.map((p) =>
        p.id === id ? { ...p, pulse: { ...p.pulse, runToken: p.pulse.runToken + 1 } } : p,
      ),
    })),
  setPulseResult: (id, result) =>
    set((state) => ({ pulseResults: { ...state.pulseResults, [id]: result } })),
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
