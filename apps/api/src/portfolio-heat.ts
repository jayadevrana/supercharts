/**
 * Portfolio heat — correlation + concentration analysis across open positions.
 *
 * Goal (from the roadmap): surface "I have 5 EUR-pair longs that all move together"
 * so the trader can throttle correlated risk BEFORE MT5 fires them.
 *
 * Three lenses, all from real candle data (never synthetic):
 *   1. Correlation matrix — pairwise Pearson of log returns over a lookback window.
 *   2. Directional stacking — two LONGs on +0.8-correlated symbols amplify each other;
 *      a LONG + SHORT on the same +0.8 pair hedge. We fold position SIDE into the
 *      correlation so the "concentration" score reflects real P&L co-movement, not just
 *      price co-movement.
 *   3. Exposure — by asset class (crypto / fx_major / … ) and by net currency
 *      (decompose EUR_USD → +EUR / −USD per long), the classic FX-book heat check.
 *
 * No position sizing data exists in paper_trades, so exposure is count/side-weighted
 * (equal-weight per position) — stated honestly in the UI, not faked as notional.
 */
import type { Candle } from '@supercharts/types';
import { getCatalogSymbol, CATEGORY_LABEL, CATEGORY_ORDER, INTERVAL_MS, type SymbolCategory } from '@supercharts/types';

const DAY_MS = 86_400_000;

export interface HeatPosition {
  symbol: string;
  side: 'buy' | 'sell';
}

export interface CorrelatedPair {
  a: string;
  b: string;
  corr: number;
  /** true → the two positions amplify each other (stacked risk); false → they hedge. */
  stacked: boolean;
  n: number;
}

export interface AssetClassBucket {
  category: string;
  label: string;
  longs: number;
  shorts: number;
  count: number;
}

export interface CurrencyExposure {
  currency: string;
  /** net = longs − shorts of this currency across the book. */
  net: number;
  longs: number;
  shorts: number;
}

export interface PortfolioHeat {
  symbols: string[];
  labels: Record<string, string>;
  /** N×N Pearson correlation of returns. Diagonal = 1. null = insufficient overlap. */
  matrix: (number | null)[][];
  /** Pairs with |corr| ≥ threshold, sorted by |corr| desc. */
  pairs: CorrelatedPair[];
  assetClasses: AssetClassBucket[];
  currencies: CurrencyExposure[];
  /** 0..1 — mean directional (side-folded) correlation, floored at 0. High = stacked. */
  concentration: number;
  concentrationLabel: 'Low' | 'Moderate' | 'High';
  /** Mean |corr| over valid pairs (price co-movement, side-agnostic). */
  avgAbsCorr: number;
  /** Bars actually used per symbol after alignment. */
  barsUsed: Record<string, number>;
  lookback: number;
  interval: string;
  warnings: string[];
  threshold: number;
}

// Quote suffixes for splitting concatenated crypto tickers (longest first so USDT
// matches before USD).
const QUOTE_SUFFIXES = [
  'USDT', 'USDC', 'FDUSD', 'TUSD', 'BUSD', 'USD', 'EUR', 'GBP', 'JPY',
  'AUD', 'CAD', 'CHF', 'NZD', 'HKD', 'BTC', 'ETH', 'BNB',
];

/** Split a symbol id into base/quote currencies. Returns null when undecodable. */
export function decompose(symbol: string): { base: string; quote: string } | null {
  const raw = symbol.includes(':') ? symbol.split(':')[1]! : symbol;
  if (raw.includes('_')) {
    const [base, quote] = raw.split('_');
    if (base && quote) return { base, quote };
    return null;
  }
  for (const q of QUOTE_SUFFIXES) {
    if (raw.length > q.length && raw.endsWith(q)) return { base: raw.slice(0, raw.length - q.length), quote: q };
  }
  return null;
}

/** Pearson correlation. Returns null when fewer than 8 paired points. */
export function pearson(x: number[], y: number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n < 8) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i += 1) {
    sx += x[i]!;
    sy += y[i]!;
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = x[i]! - mx;
    const b = y[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  const r = num / Math.sqrt(dx * dy);
  // Clamp tiny FP overshoots.
  return Math.max(-1, Math.min(1, r));
}

/**
 * Build a timeKey→close map for fast pairwise alignment. For daily-or-longer intervals
 * the key is the UTC calendar day, so bars from different sessions/providers (e.g. gold
 * futures vs spot FX vs crypto, which open at different times) still line up day-to-day.
 * For intraday intervals the exact openTime is used.
 */
function closeMap(candles: ReadonlyArray<Candle>, dayBucket: boolean): Map<number, number> {
  const m = new Map<number, number>();
  for (const c of candles) {
    const key = dayBucket ? Math.floor(c.openTime / DAY_MS) : c.openTime;
    m.set(key, c.close); // last close of the day wins
  }
  return m;
}

/** Log returns over the closes shared (by openTime) between two series, time-sorted. */
function alignedReturns(a: Map<number, number>, b: Map<number, number>): [number[], number[]] {
  const times: number[] = [];
  for (const t of a.keys()) if (b.has(t)) times.push(t);
  times.sort((x, y) => x - y);
  const ra: number[] = [];
  const rb: number[] = [];
  for (let i = 1; i < times.length; i += 1) {
    const pa = a.get(times[i - 1]!)!;
    const ca = a.get(times[i]!)!;
    const pb = b.get(times[i - 1]!)!;
    const cb = b.get(times[i]!)!;
    if (pa > 0 && ca > 0 && pb > 0 && cb > 0) {
      ra.push(Math.log(ca / pa));
      rb.push(Math.log(cb / pb));
    }
  }
  return [ra, rb];
}

function sideSign(side: 'buy' | 'sell'): 1 | -1 {
  return side === 'buy' ? 1 : -1;
}

/**
 * Compute the full heat report. `candlesBySymbol` must hold (at least) the lookback
 * window of closed candles for every position symbol; correlations are computed only
 * over the bars two symbols share.
 */
export function buildPortfolioHeat(
  positions: ReadonlyArray<HeatPosition>,
  candlesBySymbol: Map<string, ReadonlyArray<Candle>>,
  opts: { lookback: number; interval: string; threshold?: number },
): PortfolioHeat {
  const threshold = opts.threshold ?? 0.6;

  // Collapse to one net position per symbol (net side = sign of summed sides).
  const sideBySymbol = new Map<string, number>();
  for (const p of positions) {
    sideBySymbol.set(p.symbol, (sideBySymbol.get(p.symbol) ?? 0) + sideSign(p.side));
  }
  // Stable, catalog-ordered symbol list: group by asset class, then by catalog sort.
  const symbols = [...sideBySymbol.keys()].sort((x, y) => {
    const cx = getCatalogSymbol(x);
    const cy = getCatalogSymbol(y);
    const gx = cx ? CATEGORY_ORDER.indexOf(cx.category) : 99;
    const gy = cy ? CATEGORY_ORDER.indexOf(cy.category) : 99;
    if (gx !== gy) return gx - gy;
    const ox = cx ? cx.sort : 999;
    const oy = cy ? cy.sort : 999;
    if (ox !== oy) return ox - oy;
    return x.localeCompare(y);
  });

  const labels: Record<string, string> = {};
  for (const s of symbols) labels[s] = getCatalogSymbol(s)?.label ?? (s.includes(':') ? s.split(':')[1]! : s);

  const dayBucket = ((INTERVAL_MS as Record<string, number>)[opts.interval] ?? 0) >= DAY_MS;
  const maps = new Map<string, Map<number, number>>();
  const barsUsed: Record<string, number> = {};
  for (const s of symbols) {
    const cm = closeMap(candlesBySymbol.get(s) ?? [], dayBucket);
    maps.set(s, cm);
    barsUsed[s] = cm.size;
  }

  // Correlation matrix.
  const n = symbols.length;
  const matrix: (number | null)[][] = Array.from({ length: n }, () => new Array<number | null>(n).fill(null));
  const pairs: CorrelatedPair[] = [];
  let absSum = 0;
  let absCount = 0;
  let dirSum = 0;
  let dirCount = 0;

  for (let i = 0; i < n; i += 1) {
    matrix[i]![i] = 1;
    for (let j = i + 1; j < n; j += 1) {
      const [ra, rb] = alignedReturns(maps.get(symbols[i]!)!, maps.get(symbols[j]!)!);
      const r = pearson(ra, rb);
      matrix[i]![j] = r;
      matrix[j]![i] = r;
      if (r === null) continue;
      absSum += Math.abs(r);
      absCount += 1;
      // Side-folded (directional) correlation: does P&L co-move?
      const si = Math.sign(sideBySymbol.get(symbols[i]!) ?? 0) || 1;
      const sj = Math.sign(sideBySymbol.get(symbols[j]!) ?? 0) || 1;
      const directional = si * sj * r;
      dirSum += directional;
      dirCount += 1;
      if (Math.abs(r) >= threshold) {
        pairs.push({ a: symbols[i]!, b: symbols[j]!, corr: r, stacked: directional > 0, n: ra.length });
      }
    }
  }
  pairs.sort((p, q) => Math.abs(q.corr) - Math.abs(p.corr));

  const avgAbsCorr = absCount > 0 ? absSum / absCount : 0;
  const meanDirectional = dirCount > 0 ? dirSum / dirCount : 0;
  const concentration = Math.max(0, meanDirectional);
  const concentrationLabel: PortfolioHeat['concentrationLabel'] =
    concentration < 0.2 ? 'Low' : concentration < 0.5 ? 'Moderate' : 'High';

  // Asset-class buckets.
  const acMap = new Map<string, AssetClassBucket>();
  for (const p of positions) {
    const cat = (getCatalogSymbol(p.symbol)?.category ?? 'crypto') as SymbolCategory;
    let bucket = acMap.get(cat);
    if (!bucket) {
      bucket = { category: cat, label: CATEGORY_LABEL[cat] ?? cat, longs: 0, shorts: 0, count: 0 };
      acMap.set(cat, bucket);
    }
    bucket.count += 1;
    if (p.side === 'buy') bucket.longs += 1;
    else bucket.shorts += 1;
  }
  const assetClasses = [...acMap.values()].sort((a, b) => b.count - a.count);

  // Net currency exposure: long base / short quote per long position; reversed for short.
  const curMap = new Map<string, CurrencyExposure>();
  const bump = (cur: string, dir: number) => {
    let e = curMap.get(cur);
    if (!e) {
      e = { currency: cur, net: 0, longs: 0, shorts: 0 };
      curMap.set(cur, e);
    }
    e.net += dir;
    if (dir > 0) e.longs += 1;
    else e.shorts += 1;
  };
  for (const p of positions) {
    const d = decompose(p.symbol);
    if (!d) continue;
    const s = sideSign(p.side);
    bump(d.base, s); // long position → long base
    bump(d.quote, -s); // … short quote
  }
  const currencies = [...curMap.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

  // Human-readable warnings.
  const warnings: string[] = [];
  const stackedPairs = pairs.filter((p) => p.stacked);
  if (stackedPairs.length > 0) {
    // Cluster stacked pairs into connected components.
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      parent.set(x, parent.get(x) ?? x);
      while (parent.get(x) !== x) {
        const p = parent.get(x)!;
        parent.set(x, parent.get(p) ?? p);
        x = parent.get(x)!;
      }
      return x;
    };
    const union = (a: string, b: string) => {
      parent.set(find(a), find(b));
    };
    for (const p of stackedPairs) union(p.a, p.b);
    const groups = new Map<string, string[]>();
    for (const p of stackedPairs) {
      for (const sym of [p.a, p.b]) {
        const root = find(sym);
        const g = groups.get(root) ?? [];
        if (!g.includes(sym)) g.push(sym);
        groups.set(root, g);
      }
    }
    for (const g of groups.values()) {
      if (g.length >= 2) {
        const names = g.map((s) => labels[s] ?? s).join(', ');
        warnings.push(`${g.length} positions stack risk (correlated, same direction): ${names}.`);
      }
    }
  }
  for (const c of currencies) {
    if (Math.abs(c.net) >= 3) {
      warnings.push(`Net ${c.net > 0 ? 'long' : 'short'} ${c.currency} across ${Math.abs(c.net)} positions — concentrated currency exposure.`);
    }
  }

  return {
    symbols,
    labels,
    matrix,
    pairs,
    assetClasses,
    currencies,
    concentration,
    concentrationLabel,
    avgAbsCorr,
    barsUsed,
    lookback: opts.lookback,
    interval: opts.interval,
    warnings,
    threshold,
  };
}
