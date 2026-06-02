import { getCatalogSymbol } from '@supercharts/types';
import type { NewsItem } from '@supercharts/types';

/**
 * Per-watchlist news relevance scoring (Phase 3 #12).
 *
 * Turns the symbols in a watchlist into human-readable keyword sets, then scores each news
 * headline by how strongly it references those instruments. This is an original engine — no
 * third-party news API's query DSL, identifiers, or ranking is reproduced. The keyword tables
 * are plain market facts (coin names, currency names, central banks, metals, index names).
 *
 * Two jobs:
 *   1. Bias the upstream fetch toward the watchlist — `buildGdeltQuery` (GDELT, keyless) and
 *      `cryptoCurrenciesFor` (CryptoPanic `currencies`).
 *   2. Re-rank whatever the providers return by genuine relevance — `buildKeywordIndex` +
 *      `scoreItem`, which also reports exactly which watchlist symbols each headline touches.
 *
 * Weights encode confidence: an explicit pair form ("EURUSD", "EUR/USD") is unambiguous, a
 * coin/metal/index name is strong, a single currency name is moderate, and a lone central bank
 * is a weak single-leg hint. Deliberately uses multi-word fiat phrases ("us dollar", "british
 * pound") rather than bare "dollar"/"pound" so common words don't flood the score.
 */

export interface KeywordTerm {
  /** Lower-cased phrase to look for in a headline. */
  phrase: string;
  /** Contribution to a symbol's score when the phrase is present. */
  weight: number;
}

export type KeywordIndex = Array<{ id: string; terms: KeywordTerm[] }>;

/* ───── Factual keyword tables (market vocabulary, not any product's API) ───── */

const CRYPTO_NAMES: Record<string, string[]> = {
  BTC: ['bitcoin'],
  ETH: ['ethereum', 'ether'],
  SOL: ['solana'],
  BNB: ['binance coin'],
  XRP: ['ripple'],
  DOGE: ['dogecoin'],
  AVAX: ['avalanche'],
  ADA: ['cardano'],
  LINK: ['chainlink'],
  DOT: ['polkadot'],
};

const FIAT_NAMES: Record<string, string[]> = {
  USD: ['us dollar', 'greenback'],
  EUR: ['euro', 'eurozone'],
  JPY: ['japanese yen', 'yen'],
  GBP: ['british pound', 'pound sterling', 'sterling'],
  CHF: ['swiss franc'],
  AUD: ['australian dollar', 'aussie dollar'],
  NZD: ['new zealand dollar'],
  CAD: ['canadian dollar'],
  HKD: ['hong kong dollar'],
};

/** Single-leg central-bank hints — weak on their own (a USD pair is only loosely "the Fed"). */
const CENTRAL_BANKS: Record<string, string[]> = {
  USD: ['federal reserve', 'fomc'],
  EUR: ['european central bank'],
  JPY: ['bank of japan'],
  GBP: ['bank of england'],
  CHF: ['swiss national bank'],
  AUD: ['reserve bank of australia'],
  NZD: ['reserve bank of new zealand'],
  CAD: ['bank of canada'],
};

const METAL_NAMES: Record<string, string[]> = {
  XAU: ['gold', 'bullion'],
  XAG: ['silver'],
  XPT: ['platinum'],
};

const INDEX_NAMES: Record<string, string[]> = {
  SPX500: ['s&p 500', 's&p500'],
  NAS100: ['nasdaq 100', 'nasdaq'],
  US30: ['dow jones', 'dow jones industrial'],
  UK100: ['ftse 100', 'ftse'],
  DE30: ['dax 40', 'dax'],
  FR40: ['cac 40'],
  EU50: ['euro stoxx 50', 'euro stoxx'],
  JP225: ['nikkei 225', 'nikkei'],
  AU200: ['asx 200'],
  HK33: ['hang seng'],
};

/* ───── Symbol parsing ───── */

function parse(id: string): { cat: string; raw: string } {
  const raw = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;
  const sym = getCatalogSymbol(id);
  if (sym) return { cat: sym.category, raw };
  // Fallback for ids not in the catalog (keeps the engine usable + unit-testable in isolation).
  if (id.startsWith('BINANCE:')) return { cat: 'crypto', raw };
  const head = firstSeg(raw);
  if (head in METAL_NAMES) return { cat: 'commodity', raw };
  if (head in INDEX_NAMES) return { cat: 'index', raw };
  if (/^[A-Z]{3}_[A-Z]{3}$/.test(raw)) return { cat: 'fx_major', raw };
  return { cat: 'unknown', raw };
}

function cryptoBase(raw: string): string {
  return raw.replace(/USDT$/, '').replace(/USD$/, '');
}

/** First underscore-delimited segment (e.g. "XAU_USD" → "XAU", "SPX500_USD" → "SPX500"). */
function firstSeg(raw: string): string {
  return raw.split('_')[0] ?? raw;
}

/**
 * Keyword terms (phrase + weight) that indicate a headline is about this instrument.
 */
export function symbolKeywords(id: string): KeywordTerm[] {
  const { cat, raw } = parse(id);
  const out: KeywordTerm[] = [];
  const push = (phrase: string | undefined, weight: number): void => {
    if (phrase) out.push({ phrase: phrase.toLowerCase(), weight });
  };

  if (cat === 'crypto') {
    const base = cryptoBase(raw);
    for (const n of CRYPTO_NAMES[base] ?? []) push(n, 3);
    push(base, 2); // ticker, matched whole-word
  } else if (cat.startsWith('fx')) {
    const [a, b] = raw.split('_');
    if (a && b) {
      push(`${a}${b}`, 4); // EURUSD
      push(`${a}/${b}`, 4); // EUR/USD
      for (const leg of [a, b]) {
        for (const n of FIAT_NAMES[leg] ?? []) push(n, 2);
        for (const cb of CENTRAL_BANKS[leg] ?? []) push(cb, 1);
      }
    }
  } else if (cat === 'commodity') {
    const base = firstSeg(raw);
    for (const n of METAL_NAMES[base] ?? []) push(n, 3);
    push(`${base}usd`, 4);
    push(`${base}/usd`, 4);
  } else if (cat === 'index') {
    const base = firstSeg(raw);
    for (const n of INDEX_NAMES[base] ?? []) push(n, 3);
  }

  // Collapse duplicate phrases, keeping the strongest weight.
  const byPhrase = new Map<string, number>();
  for (const t of out) byPhrase.set(t.phrase, Math.max(byPhrase.get(t.phrase) ?? 0, t.weight));
  return [...byPhrase].map(([phrase, weight]) => ({ phrase, weight }));
}

/** The single most distinctive phrase for an instrument, used to bias the GDELT query. */
export function primaryPhrase(id: string): string | null {
  const { cat, raw } = parse(id);
  if (cat === 'crypto') {
    const base = cryptoBase(raw);
    return CRYPTO_NAMES[base]?.[0] ?? (base ? base.toLowerCase() : null);
  }
  if (cat.startsWith('fx')) {
    const [a, b] = raw.split('_');
    // USD is too broad for a precise news query — prefer the other leg's name.
    const leg = (a === 'USD' ? b : a) ?? '';
    return FIAT_NAMES[leg]?.[0] ?? null;
  }
  if (cat === 'commodity') return METAL_NAMES[firstSeg(raw)]?.[0] ?? null;
  if (cat === 'index') return INDEX_NAMES[firstSeg(raw)]?.[0] ?? null;
  return null;
}

export function buildKeywordIndex(ids: string[]): KeywordIndex {
  return ids.map((id) => ({ id, terms: symbolKeywords(id) })).filter((e) => e.terms.length > 0);
}

function phraseHit(haystack: string, phrase: string): boolean {
  // Pure alphanumerics → whole-word match (so "eth" misses "ethics", "dax" misses "dax40").
  // Anything with spaces or symbols ("s&p 500", "eur/usd") → plain substring.
  if (/^[a-z0-9]+$/.test(phrase)) {
    return new RegExp(`(?<![a-z0-9])${phrase}(?![a-z0-9])`).test(haystack);
  }
  return haystack.includes(phrase);
}

/**
 * Score a headline against a watchlist's keyword index.
 * Returns relevance in [0,1] (0 = no reference) and the matched symbol ids, strongest first.
 */
export function scoreItem(
  item: Pick<NewsItem, 'title' | 'summary'>,
  index: KeywordIndex,
): { relevance: number; matchedSymbols: string[] } {
  const haystack = ` ${`${item.title} ${item.summary ?? ''}`.toLowerCase()} `;
  let total = 0;
  const matched: Array<{ id: string; score: number }> = [];
  for (const entry of index) {
    let s = 0;
    for (const t of entry.terms) if (phraseHit(haystack, t.phrase)) s += t.weight;
    if (s > 0) {
      matched.push({ id: entry.id, score: s });
      total += s;
    }
  }
  matched.sort((a, b) => b.score - a.score);
  // Saturating curve: more hits → higher relevance, asymptotic to 1, exactly 0 when nothing hit.
  const relevance = total === 0 ? 0 : Math.round((1 - Math.exp(-total / 5)) * 1000) / 1000;
  return { relevance, matchedSymbols: matched.map((m) => m.id) };
}

/** OR-query of the most distinctive phrase per symbol, for the keyless GDELT doc API. */
export function buildGdeltQuery(ids: string[]): string {
  const seen = new Set<string>();
  const phrases: string[] = [];
  for (const id of ids) {
    const p = primaryPhrase(id);
    if (p && !seen.has(p)) {
      seen.add(p);
      phrases.push(p);
    }
    if (phrases.length >= 8) break;
  }
  if (phrases.length === 0) return 'markets';
  return `(${phrases.map((p) => (/[^a-z0-9]/.test(p) ? `"${p}"` : p)).join(' OR ')})`;
}

/** Base tokens of the crypto symbols (e.g. BTC, ETH) for CryptoPanic's `currencies` filter. */
export function cryptoCurrenciesFor(ids: string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    const { cat, raw } = parse(id);
    if (cat === 'crypto') {
      const base = cryptoBase(raw);
      if (base) out.add(base);
    }
  }
  return [...out];
}
