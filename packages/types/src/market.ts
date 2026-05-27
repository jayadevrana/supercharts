/**
 * Normalized market data domain.
 * All providers (Binance, OANDA, Coinbase, etc.) emit these shapes after adapter normalization.
 */

export type AssetClass = 'crypto' | 'forex' | 'stock' | 'futures' | 'options' | 'commodity' | 'index';
export type InstrumentType = 'spot' | 'perpetual' | 'futures' | 'cfd' | 'forex' | 'option' | 'commodity' | 'index';
export type AggressorSide = 'buyer' | 'seller' | 'unknown';
export type OrderBookSide = 'bid' | 'ask';

/** Canonical interval set. Server validates against this list. */
export type Interval =
  | 'tick'
  | '1s'
  | '5s'
  | '15s'
  | '30s'
  | '1m'
  | '3m'
  | '5m'
  | '15m'
  | '30m'
  | '45m'
  | '1h'
  | '2h'
  | '4h'
  | '6h'
  | '8h'
  | '12h'
  | '1d'
  | '1w'
  | '1mo'
  | '3mo'
  | '6mo'
  | '1y';

export const INTERVALS: readonly Interval[] = [
  'tick','1s','5s','15s','30s','1m','3m','5m','15m','30m','45m',
  '1h','2h','4h','6h','8h','12h','1d','1w','1mo','3mo','6mo','1y',
] as const;

/** Convert an interval to its duration in milliseconds. `tick` returns 0. */
export const INTERVAL_MS: Record<Interval, number> = {
  tick: 0,
  '1s': 1_000,
  '5s': 5_000,
  '15s': 15_000,
  '30s': 30_000,
  '1m': 60_000,
  '3m': 3 * 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '45m': 45 * 60_000,
  '1h': 3_600_000,
  '2h': 2 * 3_600_000,
  '4h': 4 * 3_600_000,
  '6h': 6 * 3_600_000,
  '8h': 8 * 3_600_000,
  '12h': 12 * 3_600_000,
  '1d': 86_400_000,
  '1w': 7 * 86_400_000,
  '1mo': 30 * 86_400_000,
  '3mo': 90 * 86_400_000,
  '6mo': 182 * 86_400_000,
  '1y': 365 * 86_400_000,
};

export type VisibleRange =
  | 'live'
  | 'today'
  | '1D'
  | '5D'
  | '1M'
  | '3M'
  | '6M'
  | 'YTD'
  | '1Y'
  | 'custom';

export interface Symbol {
  /** Canonical id: `${venue}:${ticker}`, e.g. `BINANCE:BTCUSDT`, `OANDA:EUR_USD`. */
  id: string;
  base: string;
  quote: string;
  venue: string;
  provider: string;
  assetClass: AssetClass;
  type: InstrumentType;
  tickSize: number;
  lotSize: number;
  pricePrecision: number;
  quantityPrecision: number;
  /** Optional human session label (e.g. `24x7`, `Forex 24x5`). */
  session?: string;
  timezone?: string;
  /** Provider-specific raw symbol (e.g. `BTCUSDT` for Binance, `EUR_USD` for OANDA). */
  rawSymbol: string;
  status: 'trading' | 'halted' | 'pre' | 'post' | 'closed' | 'unknown';
}

export interface TradeTick {
  id: string;
  provider: string;
  venue: string;
  symbol: string;
  /** Event time at the exchange, UNIX ms UTC. */
  eventTime: number;
  /** Time the ingestion service received the message, UNIX ms UTC. */
  receiveTime: number;
  price: number;
  quantity: number;
  notional: number;
  side: AggressorSide;
  aggressorSide: AggressorSide;
  tradeId: string;
  sequence?: number;
}

export interface QuoteTick {
  provider: string;
  venue: string;
  symbol: string;
  eventTime: number;
  bid: number;
  bidSize: number;
  ask: number;
  askSize: number;
  mid: number;
  spread: number;
}

export type OrderBookLevel = readonly [price: number, size: number];

export interface OrderBookDelta {
  provider: string;
  venue: string;
  symbol: string;
  eventTime: number;
  sequenceStart: number;
  sequenceEnd: number;
  type: 'snapshot' | 'delta';
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

export interface OrderBookSnapshot {
  provider: string;
  venue: string;
  symbol: string;
  eventTime: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  depthLevels: number;
}

export interface Candle {
  symbol: string;
  provider: string;
  venue: string;
  interval: Interval;
  /** UNIX ms UTC, start of bucket. */
  openTime: number;
  /** UNIX ms UTC, end of bucket. */
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
  trades: number;
  vwap: number;
  /** True when this candle is still forming (latest live bar). */
  isClosed: boolean;
  /** Tag the volume meaning so the UI can label honestly. */
  volumeKind: 'real' | 'tick' | 'broker' | 'synthetic';
}

export interface FootprintCell {
  candleOpenTime: number;
  priceLevel: number;
  bidVolume: number;
  askVolume: number;
  delta: number;
  totalVolume: number;
  imbalanceSide: 'buy' | 'sell' | 'none';
  imbalanceRatio: number;
  absorptionFlag: boolean;
  stackedImbalanceFlag: boolean;
}

export interface FootprintBar {
  symbol: string;
  interval: Interval;
  openTime: number;
  closeTime: number;
  cells: FootprintCell[];
  candleDelta: number;
  candleVolume: number;
  candlePOC: number;
  bidVolumeTotal: number;
  askVolumeTotal: number;
}

export interface VolumeProfileLevel {
  priceLevel: number;
  totalVolume: number;
  buyVolume: number;
  sellVolume: number;
  delta: number;
  trades: number;
  isPOC: boolean;
  isHVN: boolean;
  isLVN: boolean;
  inValueArea: boolean;
}

export type VolumeProfileMode =
  | 'visible_range'
  | 'session'
  | 'fixed_range'
  | 'anchored'
  | 'composite';

export interface VolumeProfile {
  mode: VolumeProfileMode;
  symbol: string;
  fromTime: number;
  toTime: number;
  rowSize: number;
  valueAreaPercent: number;
  poc: number;
  vah: number;
  val: number;
  totalVolume: number;
  levels: VolumeProfileLevel[];
}

export interface LiquidityHeatmapCell {
  /** UNIX ms UTC bucket start. */
  timeBucket: number;
  priceLevel: number;
  bidLiquidity: number;
  askLiquidity: number;
  totalLiquidity: number;
  side: OrderBookSide | 'mid';
  /** Normalized 0..1 intensity for rendering. */
  intensity: number;
  added: number;
  pulled: number;
  executed: number;
  /** Time the resting liquidity has been visible at this level, in ms. */
  ageMs: number;
}

export interface DeepTradeBubble {
  id: string;
  symbol: string;
  eventTime: number;
  price: number;
  quantity: number;
  notional: number;
  side: AggressorSide;
  /** 0..1, scaled by threshold mode. Drives bubble radius. */
  intensity: number;
  /** Set when absorption detector marks this print. */
  absorptionContext?: {
    kind: 'buy_absorption' | 'sell_absorption' | 'exhaustion';
    nearbyLiquidity: number;
    priceDeltaAfter: number;
    candleId?: string;
  };
}

export type DeepTradeThresholdMode =
  | { mode: 'fixed_quantity'; quantity: number }
  | { mode: 'fixed_notional'; notional: number }
  | { mode: 'percentile'; percentile: number; lookbackMs: number }
  | { mode: 'z_score'; z: number; lookbackMs: number };

export type IntensityScale = 'linear' | 'log' | 'percentile';

export interface HeatmapSettings {
  depth: number;
  priceGrouping: number;
  timeBucketMs: number;
  intensityScale: IntensityScale;
  minLiquidity: number;
  showPulled: boolean;
  showAdded: boolean;
  showExecuted: boolean;
  showLabels: boolean;
  opacity: number;
}

export interface FootprintSettings {
  enabled: boolean;
  mode: 'bidAsk' | 'delta' | 'totalVolume' | 'imbalance';
  tickGrouping: number;
  showBidAsk: boolean;
  showDelta: boolean;
  showImbalance: boolean;
  imbalanceRatio: number;
  showAbsorption: boolean;
  fontSize: number;
  hideNumbersWhenZoomedOut: boolean;
}

export interface DeepTradeSettings {
  enabled: boolean;
  threshold: DeepTradeThresholdMode;
  bubbleScale: number;
  showLabels: boolean;
  showOnlyAbsorption: boolean;
}

export interface VolumeProfileSettings {
  enabled: boolean;
  mode: VolumeProfileMode;
  rowSize: number | 'auto';
  valueAreaPercent: number;
  showBuySellSplit: boolean;
  showDelta: boolean;
  highlightPOC: boolean;
  highlightHVN: boolean;
  highlightLVN: boolean;
}
