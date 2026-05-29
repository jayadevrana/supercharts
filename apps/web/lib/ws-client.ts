'use client';

import { useEffect, useState } from 'react';
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
 * - Reconnects IMMEDIATELY when the tab is refocused or the network comes back
 *   (a backgrounded tab throttles setTimeout, so backoff alone can leave the chart
 *   frozen for a long time after a server restart / network blip — this self-heals it).
 * - Re-subscribes to whatever the consumer requested; the server replies with a fresh
 *   market_snapshot so any gap is filled on reconnect.
 * - Multiplexes per-symbol listeners.
 *
 * Singleton so multiple panes share one connection.
 */
type Listener = (msg: ServerToClientMessage) => void;
type MT5Listener = (event: unknown) => void;
export type WSStatus = 'connecting' | 'open' | 'closed';
type StatusListener = (status: WSStatus) => void;

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
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private statusListeners = new Set<StatusListener>();
  private status: WSStatus = 'connecting';
  private wakeHandler: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    // Self-heal when the user returns to the tab or the network recovers: a backgrounded
    // tab throttles the backoff timer, so without this the chart can stay frozen long
    // after the server is reachable again.
    if (typeof window !== 'undefined') {
      this.wakeHandler = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        this.reconnectNow();
      };
      window.addEventListener('online', this.wakeHandler);
      window.addEventListener('focus', this.wakeHandler);
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', this.wakeHandler);
      }
    }
  }

  /** Force an immediate reconnect, resetting backoff. No-op if already connected. */
  reconnectNow(): void {
    if (this.closed) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;
    this.open();
  }

  /** Subscribe to connection status. Fires immediately with the current status. */
  onStatus(fn: StatusListener): () => void {
    this.statusListeners.add(fn);
    fn(this.status);
    return () => this.statusListeners.delete(fn);
  }

  private emitStatus(next: WSStatus): void {
    if (this.status === next) return;
    this.status = next;
    for (const fn of this.statusListeners) fn(next);
  }

  start(): void {
    if (this.ws || this.closed) return;
    this.open();
  }

  stop(): void {
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.wakeHandler && typeof window !== 'undefined') {
      window.removeEventListener('online', this.wakeHandler);
      window.removeEventListener('focus', this.wakeHandler);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.wakeHandler);
    }
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.emitStatus('closed');
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
    if (typeof WebSocket === 'undefined' || this.closed) return;
    // Guard against opening a second socket (reconnectNow + a pending backoff timer
    // could otherwise race).
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) return;
    this.reconnectTimer = null;
    this.emitStatus('connecting');
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.emitStatus('open');
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
      this.emitStatus('connecting');
      this.reconnectAttempt += 1;
      // Clamp the exponent so the multiplier doesn't balloon to absurd numbers
      // before Math.min caps it; we still cap at 30 s. (A tab refocus / network-online
      // event triggers reconnectNow() out-of-band so we don't wait the full delay.)
      const exp = Math.min(this.reconnectAttempt, 10);
      const delay = Math.min(30_000, 500 * 2 ** exp) + Math.random() * 200;
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => this.open(), delay);
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

/** React hook: live WebSocket connection status for a status indicator. */
export function useWSStatus(): WSStatus {
  const [status, setStatus] = useState<WSStatus>('connecting');
  useEffect(() => getWSClient().onStatus(setStatus), []);
  return status;
}
