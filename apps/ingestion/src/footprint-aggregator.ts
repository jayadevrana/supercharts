import type { FootprintBar, Interval, TradeTick } from '@supercharts/types';
import { INTERVAL_MS } from '@supercharts/types';

/**
 * Footprint aggregator — buckets the live trade stream into per-candle,
 * per-price-row bid/ask volume (a real footprint, not the candle-split
 * approximation the layer falls back to). Buyer-aggressed prints add to
 * askVolume, seller-aggressed to bidVolume; `unknown` is split by the uptick
 * rule against the last price so nothing is fabricated.
 *
 * Per-cell flags (imbalance / stacked / absorption) are computed by the pure
 * `finalizeFootprintBar` so they can be unit-tested independent of the stream.
 */

/** Price-bucket size per symbol so a typical bar yields a readable number of rows. */
export function estimateTickGroup(symbol: string): number {
  if (symbol.includes('BTC')) return 10;
  if (symbol.includes('ETH')) return 1;
  if (symbol.includes('SOL')) return 0.05;
  if (symbol.includes('BNB')) return 0.5;
  if (symbol.includes('DOGE') || symbol.includes('XRP') || symbol.includes('ADA')) return 0.0001;
  return 0.5;
}

export interface FinalizeOptions {
  /** Ask:bid (or bid:ask) ratio at a cell that flags an imbalance. */
  imbalanceRatio: number;
  /** Consecutive same-side imbalanced rows that flag a stacked imbalance. */
  stackedRun: number;
  /** A cell counts as absorption when its volume exceeds this × the median cell. */
  absorptionVolumeMult: number;
}

const DEFAULTS: FinalizeOptions = { imbalanceRatio: 3, stackedRun: 3, absorptionVolumeMult: 2.5 };

/**
 * Compute every derived field on a bar's cells in place: totals, delta, POC,
 * per-cell imbalance side/ratio, stacked-imbalance runs, and absorption. Pure
 * over the cells already present — safe to call repeatedly (idempotent).
 */
export function finalizeFootprintBar(bar: FootprintBar, opts: Partial<FinalizeOptions> = {}): FootprintBar {
  const o = { ...DEFAULTS, ...opts };
  const cells = bar.cells;
  cells.sort((a, b) => a.priceLevel - b.priceLevel);

  let bid = 0;
  let ask = 0;
  let pocVol = -1;
  let poc = 0;
  const vols: number[] = [];
  for (const c of cells) {
    c.totalVolume = c.bidVolume + c.askVolume;
    c.delta = c.askVolume - c.bidVolume;
    bid += c.bidVolume;
    ask += c.askVolume;
    vols.push(c.totalVolume);
    if (c.totalVolume > pocVol) {
      pocVol = c.totalVolume;
      poc = c.priceLevel;
    }
    // Vertical (same-row) imbalance: dominant side must be `imbalanceRatio`× the other.
    if (c.askVolume > 0 && c.askVolume >= c.bidVolume * o.imbalanceRatio) {
      c.imbalanceSide = 'buy';
      c.imbalanceRatio = c.askVolume / Math.max(c.bidVolume, 1e-9);
    } else if (c.bidVolume > 0 && c.bidVolume >= c.askVolume * o.imbalanceRatio) {
      c.imbalanceSide = 'sell';
      c.imbalanceRatio = c.bidVolume / Math.max(c.askVolume, 1e-9);
    } else {
      c.imbalanceSide = 'none';
      c.imbalanceRatio = 0;
    }
    c.stackedImbalanceFlag = false;
    c.absorptionFlag = false;
  }

  bar.bidVolumeTotal = bid;
  bar.askVolumeTotal = ask;
  bar.candleVolume = bid + ask;
  bar.candleDelta = ask - bid;
  bar.candlePOC = poc;

  // Stacked imbalance: `stackedRun`+ consecutive rows (ascending price) on the same side.
  let runStart = 0;
  for (let i = 0; i <= cells.length; i++) {
    const sameAsPrev =
      i > 0 &&
      i < cells.length &&
      cells[i]!.imbalanceSide !== 'none' &&
      cells[i]!.imbalanceSide === cells[i - 1]!.imbalanceSide;
    if (!sameAsPrev) {
      const runLen = i - runStart;
      if (runLen >= o.stackedRun && cells[runStart]!.imbalanceSide !== 'none') {
        for (let j = runStart; j < i; j++) cells[j]!.stackedImbalanceFlag = true;
      }
      runStart = i;
    }
  }

  // Absorption: a row that traded far more than typical yet stayed roughly balanced
  // (heavy two-sided trade that failed to move price away) — a real two-sided print,
  // never invented.
  if (vols.length >= 4) {
    const sorted = [...vols].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 0;
    for (const c of cells) {
      if (
        median > 0 &&
        c.totalVolume > median * o.absorptionVolumeMult &&
        Math.abs(c.delta) / Math.max(c.totalVolume, 1e-9) < 0.3
      ) {
        c.absorptionFlag = true;
      }
    }
  }

  return bar;
}

interface SymbolConfig {
  intervals: Set<Interval>;
  tickGroup: number;
}

export class FootprintAggregator {
  private cfg = new Map<string, SymbolConfig>();
  /** `${symbol}|${interval}` → ring of bars (oldest first, current bar last). */
  private bars = new Map<string, FootprintBar[]>();
  /** Last trade price per symbol for the uptick rule on `unknown`-aggressor prints. */
  private lastPrice = new Map<string, number>();
  private cap = 240;

  /** Start bucketing this symbol/interval (called when a candle sub is acquired). */
  track(symbol: string, interval: Interval): void {
    let c = this.cfg.get(symbol);
    if (!c) {
      c = { intervals: new Set(), tickGroup: estimateTickGroup(symbol) };
      this.cfg.set(symbol, c);
    }
    c.intervals.add(interval);
  }

  ingest(trade: TradeTick): void {
    const cfg = this.cfg.get(trade.symbol);
    if (!cfg) return;
    let side: 'buyer' | 'seller';
    if (trade.aggressorSide === 'buyer' || trade.aggressorSide === 'seller') {
      side = trade.aggressorSide;
    } else {
      // Uptick rule: a print above the last price is buyer-aggressed, below is seller.
      const prev = this.lastPrice.get(trade.symbol);
      side = prev != null && trade.price < prev ? 'seller' : 'buyer';
    }
    this.lastPrice.set(trade.symbol, trade.price);
    for (const interval of cfg.intervals) {
      this.ingestInterval(trade, interval, cfg.tickGroup, side);
    }
  }

  private ingestInterval(trade: TradeTick, interval: Interval, tickGroup: number, side: 'buyer' | 'seller'): void {
    const ms = INTERVAL_MS[interval] ?? 60_000;
    const openTime = Math.floor(trade.eventTime / ms) * ms;
    const key = `${trade.symbol}|${interval}`;
    let ring = this.bars.get(key);
    if (!ring) {
      ring = [];
      this.bars.set(key, ring);
    }
    let bar = ring.length > 0 ? ring[ring.length - 1]! : null;
    if (!bar || bar.openTime !== openTime) {
      if (bar) finalizeFootprintBar(bar);
      bar = {
        symbol: trade.symbol,
        interval,
        openTime,
        closeTime: openTime + ms,
        cells: [],
        candleDelta: 0,
        candleVolume: 0,
        candlePOC: 0,
        bidVolumeTotal: 0,
        askVolumeTotal: 0,
      };
      ring.push(bar);
      if (ring.length > this.cap) ring.shift();
    }
    const priceLevel = Math.round(trade.price / tickGroup) * tickGroup;
    let cell = bar.cells.find((x) => x.priceLevel === priceLevel);
    if (!cell) {
      cell = {
        candleOpenTime: openTime,
        priceLevel,
        bidVolume: 0,
        askVolume: 0,
        delta: 0,
        totalVolume: 0,
        imbalanceSide: 'none',
        imbalanceRatio: 0,
        absorptionFlag: false,
        stackedImbalanceFlag: false,
      };
      bar.cells.push(cell);
    }
    if (side === 'buyer') cell.askVolume += trade.quantity;
    else cell.bidVolume += trade.quantity;
    cell.totalVolume = cell.bidVolume + cell.askVolume;
    cell.delta = cell.askVolume - cell.bidVolume;
  }

  /** Recent finalized bars (plus the live one) for a symbol/interval within [from, to]. */
  history(symbol: string, interval: Interval, from?: number, to?: number, limit = 120): FootprintBar[] {
    const ring = this.bars.get(`${symbol}|${interval}`);
    if (!ring) return [];
    const out: FootprintBar[] = [];
    for (const bar of ring) {
      if (from != null && bar.closeTime < from) continue;
      if (to != null && bar.openTime > to) continue;
      // Finalize a shallow copy so the live bar's flags are current without mutating cadence.
      out.push(finalizeFootprintBar({ ...bar, cells: bar.cells.map((c) => ({ ...c })) }));
    }
    return out.slice(-limit);
  }
}

export const footprintAggregator = new FootprintAggregator();
