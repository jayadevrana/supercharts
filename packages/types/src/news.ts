export type NewsSource =
  | 'gdelt'
  | 'cryptopanic'
  | 'finnhub'
  | 'newsapi'
  | 'twelvedata'
  | 'mock';

export type NewsTopic =
  | 'macro'
  | 'crypto'
  | 'forex'
  | 'central_bank'
  | 'inflation'
  | 'rates'
  | 'geopolitical'
  | 'commodity'
  | 'equity'
  | 'regulation'
  | 'protocol'
  | 'security'
  | 'earnings';

export interface NewsItem {
  id: string;
  source: NewsSource;
  publishedAt: number;
  title: string;
  url: string;
  summary?: string;
  imageUrl?: string;
  symbols: string[];
  topics: NewsTopic[];
  /** -1..1, negative = bearish, positive = bullish. Null when source does not score. */
  sentiment: number | null;
  /** 0..1, source-or-engine assigned relevance to the requested filter. */
  relevance: number;
  /** Provider-specific raw record, useful for debugging. */
  raw?: unknown;
}

export interface NewsQuery {
  query?: string;
  symbols?: string[];
  topics?: NewsTopic[];
  source?: NewsSource;
  from?: number;
  to?: number;
  limit?: number;
  cursor?: string;
}

export interface NewsResult {
  items: NewsItem[];
  cursor?: string;
  fetchedAt: number;
  source: NewsSource | 'aggregated';
  /** Set when a source returned a setup/error state rather than results. */
  status: 'ok' | 'not_configured' | 'rate_limited' | 'error';
  message?: string;
}
