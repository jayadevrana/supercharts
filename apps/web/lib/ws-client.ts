'use client';

import type {
  ClientToServerMessage,
  Interval,
  ServerToClientMessage,
} from '@supercharts/types';
import { wsUrl } from './api';

/**
 * Browser ↔ API WebSocket client.
 *
 * - Auto-reconnects with exponential backoff.
 * - Re-subscribes to whatever the consumer requested.
 * - Multiplexes per-symbol listeners.
 *
 * Singleton so multiple panes share one connection.
 */
type Listener = (msg: ServerToClientMessage) => void;
type MT5Listener = (event: unknown) => void;

export class WSClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private mt5Listeners = new Set<MT5Listener>();
  private mt5Subscribed = false;
  private outgoingQueue: ClientToServerMessage[] = [];
  private subscribedSymbols = new Set<string>();
  private interval: Record<string, Interval> = {};
  private reconnectAttempt = 0;
  private closed = false;
  private url: string;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(url: string) {
    this.url = url;
  }

  start(): void {
    if (this.ws || this.closed) return;
    this.open();
  }

  stop(): void {
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onMT5(fn: MT5Listener): () => void {
    this.mt5Listeners.add(fn);
    this.requestMT5Stream();
    return () => this.mt5Listeners.delete(fn);
  }

  private requestMT5Stream(): void {
    if (this.mt5Subscribed) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'subscribe_mt5' }));
        this.mt5Subscribed = true;
      } catch {
        /* will retry on next open */
      }
    }
  }

  send(msg: ClientToServerMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.outgoingQueue.push(msg);
      this.start();
      return;
    }
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
      this.outgoingQueue.push(msg);
    }
  }

  subscribe(
    symbol: string,
    interval: Interval,
    overlays: Array<'candles' | 'volume' | 'heatmap' | 'deepTrades' | 'footprint'> = [
      'candles',
      'volume',
      'heatmap',
      'deepTrades',
    ],
  ): void {
    this.subscribedSymbols.add(symbol);
    this.interval[symbol] = interval;
    this.send({
      type: 'subscribe_market',
      symbol,
      interval,
      range: 'live',
      overlays,
    });
  }

  unsubscribe(symbol: string): void {
    this.subscribedSymbols.delete(symbol);
    delete this.interval[symbol];
    this.send({ type: 'unsubscribe_market', symbol });
  }

  changeInterval(symbol: string, interval: Interval): void {
    this.interval[symbol] = interval;
    this.send({
      type: 'change_interval',
      symbol,
      interval,
    });
  }

  private open(): void {
    if (typeof WebSocket === 'undefined') return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.reconnectAttempt = 0;
      // Re-subscribe MT5 if anyone is listening.
      if (this.mt5Listeners.size > 0) {
        this.mt5Subscribed = false;
        this.requestMT5Stream();
      }
      // Re-subscribe
      for (const symbol of this.subscribedSymbols) {
        const interval: Interval = this.interval[symbol] ?? '1m';
        try {
          ws.send(
            JSON.stringify({
              type: 'subscribe_market',
              symbol,
              interval,
              range: 'live',
              overlays: ['candles', 'volume', 'heatmap', 'deepTrades'],
            } satisfies ClientToServerMessage),
          );
        } catch {
          /* ignore */
        }
      }
      // Drain queue
      for (const m of this.outgoingQueue) {
        try {
          ws.send(JSON.stringify(m));
        } catch {
          /* ignore */
        }
      }
      this.outgoingQueue = [];
      // Heartbeat
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
        }
      }, 20_000);
    };
    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as ServerToClientMessage | { type: 'mt5_event'; event: unknown };
        if (parsed && typeof parsed === 'object' && 'type' in parsed && parsed.type === 'mt5_event') {
          for (const fn of this.mt5Listeners) fn((parsed as { event: unknown }).event);
          return;
        }
        for (const fn of this.listeners) fn(parsed as ServerToClientMessage);
      } catch {
        /* malformed */
      }
    };
    ws.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.ws = null;
      this.mt5Subscribed = false;
      if (this.closed) return;
      this.reconnectAttempt += 1;
      // Clamp the exponent so the multiplier doesn't balloon to absurd numbers
      // before Math.min caps it; we still cap at 30 s.
      const exp = Math.min(this.reconnectAttempt, 10);
      const delay = Math.min(30_000, 500 * 2 ** exp) + Math.random() * 200;
      setTimeout(() => this.open(), delay);
    };
    ws.onerror = () => {
      // Close handler will retry.
    };
  }
}

let singleton: WSClient | null = null;

export function getWSClient(): WSClient {
  if (!singleton) {
    singleton = new WSClient(wsUrl());
    singleton.start();
  }
  return singleton;
}
