import type {
  Candle,
  TradeTick,
  OrderBookDelta,
  LiquidityHeatmapCell,
  DeepTradeBubble,
  FootprintBar,
  VolumeProfile,
  Interval,
  VisibleRange,
} from './market';
import type { ProviderHealthStatus } from './provider';
import type { NewsItem } from './news';
import type { AlertEvent } from './alerts';

/** Wire protocol shared by browser ↔ API WebSocket gateway. */

export type ClientToServerMessage =
  | SubscribeMarketMessage
  | UnsubscribeMarketMessage
  | ChangeIntervalMessage
  | SetVisibleRangeMessage
  | RequestHeatmapMessage
  | RequestFootprintMessage
  | RequestVolumeProfileMessage
  | SubscribeNewsMessage
  | UnsubscribeNewsMessage
  | PingMessage;

export type ServerToClientMessage =
  | HelloMessage
  | MarketSnapshotMessage
  | CandleUpdateMessage
  | TradeTickMessage
  | DeepTradeMessage
  | OrderBookDeltaMessage
  | HeatmapUpdateMessage
  | FootprintUpdateMessage
  | VolumeProfileUpdateMessage
  | NewsUpdateMessage
  | ProviderHealthMessage
  | SubscriptionErrorMessage
  | AlertFiredMessage
  | PongMessage;

export interface SubscribeMarketMessage {
  type: 'subscribe_market';
  symbol: string;
  interval: Interval;
  range: VisibleRange;
  overlays: string[];
}

export interface UnsubscribeMarketMessage {
  type: 'unsubscribe_market';
  symbol: string;
}

export interface ChangeIntervalMessage {
  type: 'change_interval';
  symbol: string;
  interval: Interval;
}

export interface SetVisibleRangeMessage {
  type: 'set_visible_range';
  symbol: string;
  from: number;
  to: number;
  resolutionHint?: Interval;
}

export interface RequestHeatmapMessage {
  type: 'request_heatmap';
  symbol: string;
  depth: number;
  priceGrouping: number;
  timeBucketMs: number;
}

export interface RequestFootprintMessage {
  type: 'request_footprint';
  symbol: string;
  interval: Interval;
  from: number;
  to: number;
  tickGrouping: number;
}

export interface RequestVolumeProfileMessage {
  type: 'request_volume_profile';
  symbol: string;
  from: number;
  to: number;
  mode: 'visible_range' | 'session' | 'fixed_range' | 'anchored';
  rowSize?: number;
  valueAreaPercent?: number;
}

export interface SubscribeNewsMessage {
  type: 'subscribe_news';
  symbols?: string[];
  topics?: string[];
}

export interface UnsubscribeNewsMessage {
  type: 'unsubscribe_news';
}

export interface PingMessage {
  type: 'ping';
  ts: number;
}

export interface HelloMessage {
  type: 'hello';
  connectionId: string;
  serverTime: number;
  protocolVersion: number;
}

export interface MarketSnapshotMessage {
  type: 'market_snapshot';
  symbol: string;
  interval: Interval;
  candles: Candle[];
  volumeProfile?: VolumeProfile;
  heatmap?: LiquidityHeatmapCell[];
  deepTrades?: DeepTradeBubble[];
  footprint?: FootprintBar[];
  serverTime: number;
}

export interface CandleUpdateMessage {
  type: 'candle_update';
  symbol: string;
  interval: Interval;
  candle: Candle;
}

export interface TradeTickMessage {
  type: 'trade_tick';
  symbol: string;
  trade: TradeTick;
}

export interface DeepTradeMessage {
  type: 'deep_trade';
  symbol: string;
  bubble: DeepTradeBubble;
}

export interface OrderBookDeltaMessage {
  type: 'orderbook_delta';
  symbol: string;
  delta: OrderBookDelta;
}

export interface HeatmapUpdateMessage {
  type: 'heatmap_update';
  symbol: string;
  cells: LiquidityHeatmapCell[];
}

export interface FootprintUpdateMessage {
  type: 'footprint_update';
  symbol: string;
  interval: Interval;
  bar: FootprintBar;
}

export interface VolumeProfileUpdateMessage {
  type: 'volume_profile_update';
  symbol: string;
  profile: VolumeProfile;
}

export interface NewsUpdateMessage {
  type: 'news_update';
  items: NewsItem[];
}

export interface ProviderHealthMessage {
  type: 'provider_health';
  status: ProviderHealthStatus;
}

export interface SubscriptionErrorMessage {
  type: 'subscription_error';
  code: 'not_configured' | 'rate_limited' | 'unknown_symbol' | 'unauthorized' | 'internal';
  message: string;
  context?: Record<string, unknown>;
}

export interface PongMessage {
  type: 'pong';
  ts: number;
  serverTime: number;
}

export interface AlertFiredMessage {
  type: 'alert_fired';
  event: AlertEvent;
}
