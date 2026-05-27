import type {
  Interval,
  VisibleRange,
  HeatmapSettings,
  FootprintSettings,
  DeepTradeSettings,
  VolumeProfileSettings,
} from './market';

export type ChartType =
  | 'candlestick'
  | 'bar'
  | 'line'
  | 'line_markers'
  | 'area'
  | 'hlc_area'
  | 'baseline'
  | 'hollow_candle'
  | 'volume_candle'
  | 'column'
  | 'step_line'
  | 'hlc'
  | 'ohlc'
  | 'high_low'
  | 'heikin_ashi'
  | 'renko'
  | 'range_bar'
  | 'tick_bar'
  | 'volume_bar'
  | 'dollar_bar'
  | 'kagi'
  | 'point_and_figure'
  | 'line_break'
  | 'delta_candle'
  | 'cvd_candle'
  | 'footprint'
  | 'tpo'
  | 'session_volume_profile';

export type Theme = 'dark' | 'light' | 'high_contrast' | 'custom';

export type GridSize = 1 | 2 | 4 | 8 | 16;

export interface ViewportState {
  /** UNIX ms UTC. */
  fromTime: number;
  toTime: number;
  priceMin: number;
  priceMax: number;
  /** Pixels per candle along the time axis. */
  barWidth: number;
}

export interface PaneConfig {
  id: string;
  symbol: string;
  provider: string;
  interval: Interval;
  range: VisibleRange;
  chartType: ChartType;
  overlays: OverlayConfig;
  indicators: IndicatorInstance[];
  scale: ScaleConfig;
  showLastPriceLine: boolean;
  showCountdown: boolean;
  syncCrosshair: boolean;
  syncSymbol: boolean;
  syncTimeframe: boolean;
}

export interface OverlayConfig {
  volumeProfile: VolumeProfileSettings;
  heatmap: HeatmapSettings & { enabled: boolean };
  footprint: FootprintSettings;
  deepTrades: DeepTradeSettings;
  showVolumeBars: boolean;
  showCVDPanel: boolean;
  showOrderBook: boolean;
  showRecentTrades: boolean;
  showNewsMarkers: boolean;
}

export interface ScaleConfig {
  mode: 'linear' | 'log' | 'percent';
  inverted: boolean;
  autoFit: boolean;
}

export interface IndicatorInstance {
  id: string;
  type: string;
  name: string;
  paneId: 'price' | string;
  inputs: Record<string, number | string | boolean>;
  style: Record<string, string | number>;
  visible: boolean;
  locked: boolean;
}

export interface ChartLayout {
  id: string;
  userId: string;
  name: string;
  grid: GridSize;
  panes: PaneConfig[];
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CrosshairState {
  /** Logical time in UNIX ms, or null when outside chart. */
  time: number | null;
  price: number | null;
  paneId: string | null;
  visible: boolean;
}

export interface DataQualityLabel {
  kind: 'live' | 'delayed' | 'aggregated' | 'tick_volume' | 'broker_liquidity' | 'unavailable';
  detail?: string;
}
