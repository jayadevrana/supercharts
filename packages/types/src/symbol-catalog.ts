/**
 * Curated, premium symbol catalog. Used by the watchlist, alerts builder, and symbol picker.
 *
 * Scope (deliberate):
 *   - Crypto majors (Binance, top spot pairs).
 *   - FX majors / minors / crosses — no exotics. Liquidity matters; we don't surface
 *     pairs where OANDA's spread spikes during off-session hours.
 *   - Commodities: XAU (gold), XAG (silver), XPT (platinum). XPD (palladium) is excluded
 *     because OANDA's liquidity on it is too thin for retail-grade alerts.
 *   - Indices: major cash CFDs (US, UK, Germany, France, Japan, Australia, Hong Kong).
 *
 * Out of scope (intentional): exotics, micro lots, leveraged tokens, perpetual futures
 * with their own funding mechanics. They each need bespoke risk surfaces and would
 * dilute the product story.
 */

export type SymbolCategory =
  | 'crypto'
  | 'fx_major'
  | 'fx_minor'
  | 'fx_cross'
  | 'commodity'
  | 'index';

export interface CatalogSymbol {
  /** Canonical "VENUE:RAW" id used everywhere downstream. */
  id: string;
  /** Human label, e.g. "EUR / USD". */
  label: string;
  category: SymbolCategory;
  venue: 'BINANCE' | 'OANDA';
  /** Sort hint within category. Lower = higher in list. */
  sort: number;
}

/* ───── Crypto ───── */
export const CRYPTO_SYMBOLS: CatalogSymbol[] = [
  { id: 'BINANCE:BTCUSDT', label: 'BTC / USDT', category: 'crypto', venue: 'BINANCE', sort: 0 },
  { id: 'BINANCE:ETHUSDT', label: 'ETH / USDT', category: 'crypto', venue: 'BINANCE', sort: 1 },
  { id: 'BINANCE:SOLUSDT', label: 'SOL / USDT', category: 'crypto', venue: 'BINANCE', sort: 2 },
  { id: 'BINANCE:BNBUSDT', label: 'BNB / USDT', category: 'crypto', venue: 'BINANCE', sort: 3 },
  { id: 'BINANCE:XRPUSDT', label: 'XRP / USDT', category: 'crypto', venue: 'BINANCE', sort: 4 },
  { id: 'BINANCE:DOGEUSDT', label: 'DOGE / USDT', category: 'crypto', venue: 'BINANCE', sort: 5 },
  { id: 'BINANCE:AVAXUSDT', label: 'AVAX / USDT', category: 'crypto', venue: 'BINANCE', sort: 6 },
  { id: 'BINANCE:ADAUSDT', label: 'ADA / USDT', category: 'crypto', venue: 'BINANCE', sort: 7 },
  { id: 'BINANCE:LINKUSDT', label: 'LINK / USDT', category: 'crypto', venue: 'BINANCE', sort: 8 },
  { id: 'BINANCE:DOTUSDT', label: 'DOT / USDT', category: 'crypto', venue: 'BINANCE', sort: 9 },
];

/* ───── FX Majors (the 7 ISO majors + EURJPY which trades like one) ───── */
export const FX_MAJOR_SYMBOLS: CatalogSymbol[] = [
  { id: 'OANDA:EUR_USD', label: 'EUR / USD', category: 'fx_major', venue: 'OANDA', sort: 0 },
  { id: 'OANDA:GBP_USD', label: 'GBP / USD', category: 'fx_major', venue: 'OANDA', sort: 1 },
  { id: 'OANDA:USD_JPY', label: 'USD / JPY', category: 'fx_major', venue: 'OANDA', sort: 2 },
  { id: 'OANDA:USD_CHF', label: 'USD / CHF', category: 'fx_major', venue: 'OANDA', sort: 3 },
  { id: 'OANDA:AUD_USD', label: 'AUD / USD', category: 'fx_major', venue: 'OANDA', sort: 4 },
  { id: 'OANDA:NZD_USD', label: 'NZD / USD', category: 'fx_major', venue: 'OANDA', sort: 5 },
  { id: 'OANDA:USD_CAD', label: 'USD / CAD', category: 'fx_major', venue: 'OANDA', sort: 6 },
];

/* ───── FX Minors (one-leg-USD-free majors) ───── */
export const FX_MINOR_SYMBOLS: CatalogSymbol[] = [
  { id: 'OANDA:EUR_GBP', label: 'EUR / GBP', category: 'fx_minor', venue: 'OANDA', sort: 0 },
  { id: 'OANDA:EUR_JPY', label: 'EUR / JPY', category: 'fx_minor', venue: 'OANDA', sort: 1 },
  { id: 'OANDA:GBP_JPY', label: 'GBP / JPY', category: 'fx_minor', venue: 'OANDA', sort: 2 },
  { id: 'OANDA:EUR_CHF', label: 'EUR / CHF', category: 'fx_minor', venue: 'OANDA', sort: 3 },
  { id: 'OANDA:GBP_CHF', label: 'GBP / CHF', category: 'fx_minor', venue: 'OANDA', sort: 4 },
  { id: 'OANDA:AUD_JPY', label: 'AUD / JPY', category: 'fx_minor', venue: 'OANDA', sort: 5 },
  { id: 'OANDA:CAD_JPY', label: 'CAD / JPY', category: 'fx_minor', venue: 'OANDA', sort: 6 },
  { id: 'OANDA:CHF_JPY', label: 'CHF / JPY', category: 'fx_minor', venue: 'OANDA', sort: 7 },
];

/* ───── FX Crosses (no-USD pairs) ───── */
export const FX_CROSS_SYMBOLS: CatalogSymbol[] = [
  { id: 'OANDA:EUR_AUD', label: 'EUR / AUD', category: 'fx_cross', venue: 'OANDA', sort: 0 },
  { id: 'OANDA:EUR_CAD', label: 'EUR / CAD', category: 'fx_cross', venue: 'OANDA', sort: 1 },
  { id: 'OANDA:EUR_NZD', label: 'EUR / NZD', category: 'fx_cross', venue: 'OANDA', sort: 2 },
  { id: 'OANDA:GBP_AUD', label: 'GBP / AUD', category: 'fx_cross', venue: 'OANDA', sort: 3 },
  { id: 'OANDA:GBP_CAD', label: 'GBP / CAD', category: 'fx_cross', venue: 'OANDA', sort: 4 },
  { id: 'OANDA:GBP_NZD', label: 'GBP / NZD', category: 'fx_cross', venue: 'OANDA', sort: 5 },
  { id: 'OANDA:AUD_CAD', label: 'AUD / CAD', category: 'fx_cross', venue: 'OANDA', sort: 6 },
  { id: 'OANDA:AUD_NZD', label: 'AUD / NZD', category: 'fx_cross', venue: 'OANDA', sort: 7 },
  { id: 'OANDA:NZD_CAD', label: 'NZD / CAD', category: 'fx_cross', venue: 'OANDA', sort: 8 },
  { id: 'OANDA:NZD_JPY', label: 'NZD / JPY', category: 'fx_cross', venue: 'OANDA', sort: 9 },
];

/* ───── Commodities (precious metals — OANDA CFDs). ───── */
export const COMMODITY_SYMBOLS: CatalogSymbol[] = [
  { id: 'OANDA:XAU_USD', label: 'Gold (XAU / USD)', category: 'commodity', venue: 'OANDA', sort: 0 },
  { id: 'OANDA:XAG_USD', label: 'Silver (XAG / USD)', category: 'commodity', venue: 'OANDA', sort: 1 },
  { id: 'OANDA:XPT_USD', label: 'Platinum (XPT / USD)', category: 'commodity', venue: 'OANDA', sort: 2 },
];

/* ───── Indices (major cash CFDs) ───── */
export const INDEX_SYMBOLS: CatalogSymbol[] = [
  { id: 'OANDA:SPX500_USD', label: 'S&P 500', category: 'index', venue: 'OANDA', sort: 0 },
  { id: 'OANDA:NAS100_USD', label: 'Nasdaq 100', category: 'index', venue: 'OANDA', sort: 1 },
  { id: 'OANDA:US30_USD', label: 'Dow Jones 30', category: 'index', venue: 'OANDA', sort: 2 },
  { id: 'OANDA:UK100_GBP', label: 'FTSE 100', category: 'index', venue: 'OANDA', sort: 3 },
  { id: 'OANDA:DE30_EUR', label: 'DAX 40', category: 'index', venue: 'OANDA', sort: 4 },
  { id: 'OANDA:FR40_EUR', label: 'CAC 40', category: 'index', venue: 'OANDA', sort: 5 },
  { id: 'OANDA:EU50_EUR', label: 'Euro Stoxx 50', category: 'index', venue: 'OANDA', sort: 6 },
  { id: 'OANDA:JP225_USD', label: 'Nikkei 225', category: 'index', venue: 'OANDA', sort: 7 },
  { id: 'OANDA:AU200_AUD', label: 'ASX 200', category: 'index', venue: 'OANDA', sort: 8 },
  { id: 'OANDA:HK33_HKD', label: 'Hang Seng 33', category: 'index', venue: 'OANDA', sort: 9 },
];

export const SYMBOL_CATALOG: CatalogSymbol[] = [
  ...CRYPTO_SYMBOLS,
  ...FX_MAJOR_SYMBOLS,
  ...FX_MINOR_SYMBOLS,
  ...FX_CROSS_SYMBOLS,
  ...COMMODITY_SYMBOLS,
  ...INDEX_SYMBOLS,
];

export const CATEGORY_ORDER: SymbolCategory[] = [
  'crypto',
  'fx_major',
  'fx_minor',
  'fx_cross',
  'commodity',
  'index',
];

export const CATEGORY_LABEL: Record<SymbolCategory, string> = {
  crypto: 'Crypto',
  fx_major: 'Forex · Major',
  fx_minor: 'Forex · Minor',
  fx_cross: 'Forex · Cross',
  commodity: 'Commodities',
  index: 'Indices',
};

/** O(1) lookup helper. */
const BY_ID = new Map(SYMBOL_CATALOG.map((s) => [s.id, s] as const));
export function getCatalogSymbol(id: string): CatalogSymbol | undefined {
  return BY_ID.get(id);
}

export function listByCategory(category: SymbolCategory): CatalogSymbol[] {
  return SYMBOL_CATALOG.filter((s) => s.category === category);
}

/** Raw OANDA instruments — used by the provider whitelist. */
export const OANDA_INSTRUMENTS = SYMBOL_CATALOG
  .filter((s) => s.venue === 'OANDA')
  .map((s) => s.id.slice('OANDA:'.length));
