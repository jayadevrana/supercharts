import type { AssetClass } from './market';

export type ProviderId =
  | 'binance'
  | 'binance_futures'
  | 'coinbase'
  | 'kraken'
  | 'okx'
  | 'bybit'
  | 'oanda'
  | 'twelvedata'
  | 'finnhub'
  | 'polygon'
  | 'coingecko'
  | 'cryptopanic'
  | 'gdelt'
  | 'newsapi'
  | 'mock';

export interface ProviderCapabilities {
  trades: boolean;
  quotes: boolean;
  orderBook: boolean;
  /** Max book depth the provider exposes. */
  orderBookDepth: number;
  candles: boolean;
  historicalCandles: boolean;
  historicalTrades: boolean;
  news: boolean;
  /** Realistic note about volume semantics. */
  volumeKind: 'real' | 'tick' | 'broker' | 'synthetic' | 'unknown';
  assetClasses: AssetClass[];
}

export interface ProviderHealthStatus {
  provider: ProviderId;
  venue: string;
  status: 'connected' | 'connecting' | 'disconnected' | 'degraded' | 'not_configured' | 'error';
  /** Time of last meaningful message from the provider, UNIX ms UTC. */
  lastMessageAt: number | null;
  latencyMs: number | null;
  reconnects: number;
  subscriptions: number;
  message?: string;
}
