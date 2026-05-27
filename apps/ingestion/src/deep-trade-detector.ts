import type { DeepTradeBubble, DeepTradeThresholdMode, TradeTick } from '@supercharts/types';
import { bus } from './event-bus';

/**
 * Sliding-window deep-trade detector. Maintains a per-symbol notional history,
 * computes the configured threshold (percentile / z-score / fixed), and emits a
 * `deep_trade` bus event for each qualifying trade.
 *
 * Memory bounded by `windowMs` × incoming rate. We trim aggressively.
 */

interface Window {
  /** Sorted by eventTime. */
  trades: TradeTick[];
  lookbackMs: number;
  cachedSorted: Float64Array | null;
}

export class DeepTradeDetector {
  private windows = new Map<string, Window>();
  private modes = new Map<string, DeepTradeThresholdMode>();
  private bubbleHistory = new Map<string, DeepTradeBubble[]>();
  private historyCap = 2000;

  /** Default threshold = top 1% over last 10 minutes. */
  setMode(symbol: string, mode: DeepTradeThresholdMode): void {
    this.modes.set(symbol, mode);
    const lookback =
      mode.mode === 'percentile' || mode.mode === 'z_score' ? mode.lookbackMs : 600_000;
    const win = this.windows.get(symbol);
    if (win) win.lookbackMs = lookback;
  }

  ingest(trade: TradeTick): DeepTradeBubble | null {
    const symbol = trade.symbol;
    let win = this.windows.get(symbol);
    if (!win) {
      win = { trades: [], lookbackMs: 600_000, cachedSorted: null };
      this.windows.set(symbol, win);
    }
    win.trades.push(trade);
    win.cachedSorted = null;
    const cutoff = trade.eventTime - win.lookbackMs;
    // Find first kept index via binary search, then splice once. The old `shift()` loop
    // was O(n²) per tick for symbols with thousands of trades per window (BTC ~50 tps
    // × 600 s = 30k entries) because each shift() re-indexes the entire array.
    if (win.trades.length > 0 && win.trades[0]!.eventTime < cutoff) {
      let lo = 0;
      let hi = win.trades.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (win.trades[mid]!.eventTime < cutoff) lo = mid + 1;
        else hi = mid;
      }
      if (lo > 0) {
        win.trades.splice(0, lo);
        win.cachedSorted = null;
      }
    }

    const mode = this.modes.get(symbol) ?? { mode: 'percentile', percentile: 0.99, lookbackMs: 600_000 };
    let threshold = this.computeThreshold(win, mode);
    if (!Number.isFinite(threshold) || threshold <= 0) return null;
    // Require a minimum sample before producing bubbles.
    if (win.trades.length < 20 && (mode.mode === 'percentile' || mode.mode === 'z_score')) return null;

    if (trade.notional < threshold) return null;
    const intensity = Math.min(1, trade.notional / Math.max(threshold * 3, 1));
    const bubble: DeepTradeBubble = {
      id: trade.id,
      symbol,
      eventTime: trade.eventTime,
      price: trade.price,
      quantity: trade.quantity,
      notional: trade.notional,
      side: trade.aggressorSide,
      intensity,
    };
    this.appendHistory(symbol, bubble);
    bus.emit({ type: 'deep_trade', symbol, data: bubble });
    return bubble;
  }

  history(symbol: string, limit = 1000): DeepTradeBubble[] {
    const arr = this.bubbleHistory.get(symbol) ?? [];
    return arr.slice(-limit);
  }

  private appendHistory(symbol: string, bubble: DeepTradeBubble): void {
    let arr = this.bubbleHistory.get(symbol);
    if (!arr) {
      arr = [];
      this.bubbleHistory.set(symbol, arr);
    }
    arr.push(bubble);
    if (arr.length > this.historyCap) arr.splice(0, arr.length - this.historyCap);
  }

  private computeThreshold(win: Window, mode: DeepTradeThresholdMode): number {
    switch (mode.mode) {
      case 'fixed_quantity':
        // Convert into notional using the latest trade price.
        return mode.quantity * (win.trades[win.trades.length - 1]?.price ?? 1);
      case 'fixed_notional':
        return mode.notional;
      case 'percentile': {
        if (win.trades.length === 0) return Infinity;
        const sorted = this.ensureSorted(win);
        const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * mode.percentile));
        return sorted[idx]!;
      }
      case 'z_score': {
        if (win.trades.length < 5) return Infinity;
        const sorted = this.ensureSorted(win);
        let sum = 0;
        for (let i = 0; i < sorted.length; i += 1) sum += sorted[i]!;
        const mean = sum / sorted.length;
        let varSum = 0;
        for (let i = 0; i < sorted.length; i += 1) {
          const d = sorted[i]! - mean;
          varSum += d * d;
        }
        const std = Math.sqrt(varSum / sorted.length);
        return mean + mode.z * std;
      }
    }
  }

  private ensureSorted(win: Window): Float64Array {
    if (win.cachedSorted) return win.cachedSorted;
    const arr = new Float64Array(win.trades.length);
    for (let i = 0; i < win.trades.length; i += 1) arr[i] = win.trades[i]!.notional;
    arr.sort();
    win.cachedSorted = arr;
    return arr;
  }
}

export const deepTradeDetector = new DeepTradeDetector();
