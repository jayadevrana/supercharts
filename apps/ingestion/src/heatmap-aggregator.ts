import type { LiquidityHeatmapCell, OrderBookDelta } from '@supercharts/types';
import { bus } from './event-bus';

interface SymbolState {
  bucketMs: number;
  priceGrouping: number;
  /** Most recent bucket open time. `null` until the first delta is ingested. */
  currentBucket: number | null;
  bidLevels: Map<number, number>;
  askLevels: Map<number, number>;
  /** Bucketed cells we've already emitted, capped. */
  history: LiquidityHeatmapCell[];
  /** Rolling max for normalization. */
  rollingMax: number;
  /** Last per-level snapshot so we can derive added/pulled deltas. */
  prevBid: Map<number, number>;
  prevAsk: Map<number, number>;
}

const HISTORY_CAP = 1500;

export class HeatmapAggregator {
  private state = new Map<string, SymbolState>();

  configure(symbol: string, opts: { bucketMs?: number; priceGrouping?: number } = {}): void {
    let s = this.state.get(symbol);
    if (!s) {
      s = {
        bucketMs: opts.bucketMs ?? 1_000,
        priceGrouping: opts.priceGrouping ?? 1,
        currentBucket: null,
        bidLevels: new Map(),
        askLevels: new Map(),
        history: [],
        rollingMax: 0,
        prevBid: new Map(),
        prevAsk: new Map(),
      };
      this.state.set(symbol, s);
    }
    if (opts.bucketMs !== undefined) s.bucketMs = opts.bucketMs;
    if (opts.priceGrouping !== undefined) s.priceGrouping = opts.priceGrouping;
  }

  ingest(delta: OrderBookDelta): void {
    this.configure(delta.symbol);
    const s = this.state.get(delta.symbol)!;
    if (delta.type === 'snapshot') {
      s.bidLevels = new Map();
      s.askLevels = new Map();
    }
    const group = s.priceGrouping || 0.01;
    // Snapshot frames REPLACE the level (we already cleared the maps above, so a
    // simple set is correct). Delta frames mutate the existing level by the signed
    // size delta. The previous `+= size` for snapshot rows was harmless only because
    // every provider currently emits `type: 'snapshot'`, but it would silently
    // double-count if a delta stream were wired in.
    if (delta.type === 'snapshot') {
      for (const [price, size] of delta.bids) {
        const key = Math.round(price / group) * group;
        if (size === 0) s.bidLevels.delete(key);
        else s.bidLevels.set(key, size);
      }
      for (const [price, size] of delta.asks) {
        const key = Math.round(price / group) * group;
        if (size === 0) s.askLevels.delete(key);
        else s.askLevels.set(key, size);
      }
    } else {
      for (const [price, size] of delta.bids) {
        const key = Math.round(price / group) * group;
        if (size === 0) s.bidLevels.delete(key);
        else s.bidLevels.set(key, (s.bidLevels.get(key) ?? 0) + size);
      }
      for (const [price, size] of delta.asks) {
        const key = Math.round(price / group) * group;
        if (size === 0) s.askLevels.delete(key);
        else s.askLevels.set(key, (s.askLevels.get(key) ?? 0) + size);
      }
    }
    const bucket = Math.floor(delta.eventTime / s.bucketMs) * s.bucketMs;
    if (s.currentBucket !== null && bucket !== s.currentBucket) {
      this.flushBucket(delta.symbol, s, s.currentBucket);
    }
    s.currentBucket = bucket;
  }

  /** Force a flush, e.g. when ticking periodically. */
  flush(symbol: string): void {
    const s = this.state.get(symbol);
    if (!s || s.currentBucket === null) return;
    this.flushBucket(symbol, s, s.currentBucket);
  }

  history(symbol: string, limit = 1500): LiquidityHeatmapCell[] {
    const s = this.state.get(symbol);
    if (!s) return [];
    return s.history.slice(-limit);
  }

  private flushBucket(symbol: string, s: SymbolState, bucket: number): void {
    const cells: LiquidityHeatmapCell[] = [];
    let bucketMax = 0;
    for (const [, sz] of s.bidLevels) if (sz > bucketMax) bucketMax = sz;
    for (const [, sz] of s.askLevels) if (sz > bucketMax) bucketMax = sz;
    // Smooth rolling max so a single whale doesn't wash everything out.
    s.rollingMax = s.rollingMax === 0 ? bucketMax : s.rollingMax * 0.9 + bucketMax * 0.1;
    const norm = Math.max(s.rollingMax, 1e-9);

    for (const [price, size] of s.bidLevels) {
      const prev = s.prevBid.get(price) ?? 0;
      const cell: LiquidityHeatmapCell = {
        timeBucket: bucket,
        priceLevel: price,
        bidLiquidity: size,
        askLiquidity: 0,
        totalLiquidity: size,
        side: 'bid',
        intensity: Math.min(1, size / norm),
        added: Math.max(0, size - prev),
        pulled: Math.max(0, prev - size),
        executed: 0,
        ageMs: s.bucketMs,
      };
      cells.push(cell);
    }
    for (const [price, size] of s.askLevels) {
      const prev = s.prevAsk.get(price) ?? 0;
      const cell: LiquidityHeatmapCell = {
        timeBucket: bucket,
        priceLevel: price,
        bidLiquidity: 0,
        askLiquidity: size,
        totalLiquidity: size,
        side: 'ask',
        intensity: Math.min(1, size / norm),
        added: Math.max(0, size - prev),
        pulled: Math.max(0, prev - size),
        executed: 0,
        ageMs: s.bucketMs,
      };
      cells.push(cell);
    }

    s.history.push(...cells);
    if (s.history.length > HISTORY_CAP) s.history.splice(0, s.history.length - HISTORY_CAP);
    s.prevBid = new Map(s.bidLevels);
    s.prevAsk = new Map(s.askLevels);
    if (cells.length > 0) bus.emit({ type: 'heatmap', symbol, data: cells });
  }
}

export const heatmapAggregator = new HeatmapAggregator();
