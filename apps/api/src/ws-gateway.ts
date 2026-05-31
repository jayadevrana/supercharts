import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { nanoid } from 'nanoid';
import type { IngestionContext } from '@supercharts/ingestion';
import type {
  AlertEvent,
  ClientToServerMessage,
  HelloMessage,
  Interval,
  MarketSnapshotMessage,
  ServerToClientMessage,
  SubscribeMarketMessage,
} from '@supercharts/types';
// Hoisted to module-level so the gateway's per-message hot path doesn't pay the cost
// of resolving a dynamic ESM import on every `request_volume_profile` frame.
import { buildVisibleRangeProfile } from '@supercharts/chart-core/pure';
import type { MT5Store, MT5Event } from './mt5/state';

const PROTOCOL_VERSION = 1;
const MAX_SUBS_PER_CONN = 32;
/** Default overlays carried across change_interval when the prior set is unknown. */
const DEFAULT_OVERLAYS: SubscribeMarketMessage['overlays'] = [
  'candles',
  'volume',
  'deepTrades',
  'heatmap',
];

interface Connection {
  id: string;
  /** Session user id this connection belongs to. Defaults to `demo` until auth ships. */
  userId: string;
  socket: WebSocket;
  /** Set of (symbol, interval) keys this connection wants candle/trade/orderbook fanout for. */
  subs: Map<
    string,
    {
      symbol: string;
      interval: Interval;
      overlays: SubscribeMarketMessage['overlays'];
      offs: Array<() => void>;
    }
  >;
  /**
   * Per-symbol refcount of standalone orderbook acquisitions made by `request_heatmap`
   * outside the regular subscribe_market path. Released on close so we don't leak
   * provider subscriptions when a client disconnects after polling the heatmap.
   */
  heatmapAcquires: Map<string, number>;
  newsOff?: () => void;
  /** True when the client has opted in to MT5 events for any of its accounts. */
  mt5: boolean;
  /** Off function for the MT5 store listener. */
  mt5Off?: () => void;
  closed: boolean;
}

export interface WsBroadcaster {
  broadcastAlertFired: (userId: string, event: AlertEvent) => void;
}

export function registerWebSocketGateway(
  fastify: FastifyInstance,
  ctx: IngestionContext,
  mt5Store?: MT5Store,
): WsBroadcaster {
  const connections = new Set<Connection>();
  fastify.get('/ws', { websocket: true }, (socket /* , req */) => {
    const conn: Connection = {
      id: nanoid(10),
      // Until Auth.js lands every WS belongs to `demo`. The auth route module is the
      // sole owner of "who is this" — when it returns a real session, lift it here.
      userId: 'demo',
      socket,
      subs: new Map(),
      heatmapAcquires: new Map(),
      closed: false,
      mt5: false,
    };
    connections.add(conn);

    const hello: HelloMessage = {
      type: 'hello',
      connectionId: conn.id,
      serverTime: Date.now(),
      protocolVersion: PROTOCOL_VERSION,
    };
    send(socket, hello);

    // Push a periodic health update so the data-health panel stays warm.
    const healthInterval = setInterval(() => {
      if (conn.closed) return;
      for (const h of ctx.subscriptions.health()) {
        send(socket, { type: 'provider_health', status: h });
      }
    }, 5_000);

    socket.on('message', (raw) => {
      let parsed: ClientToServerMessage | { type: 'subscribe_mt5' } | null;
      try {
        parsed = JSON.parse(raw.toString()) as ClientToServerMessage | { type: 'subscribe_mt5' };
      } catch {
        send(socket, {
          type: 'subscription_error',
          code: 'internal',
          message: 'malformed_json',
        });
        return;
      }
      // The MT5 opt-in lives outside the typed client schema so legacy
      // clients keep their existing union; it is handled inline here.
      if (parsed && typeof parsed === 'object' && 'type' in parsed && parsed.type === 'subscribe_mt5') {
        if (!conn.mt5 && mt5Store) {
          conn.mt5 = true;
          const listener = (e: MT5Event): void => {
            socket.send(JSON.stringify({ type: 'mt5_event', event: e }));
          };
          mt5Store.on('event', listener);
          conn.mt5Off = () => mt5Store.off('event', listener);
        }
        return;
      }
      handleClientMessage(conn, parsed as ClientToServerMessage, ctx).catch((err) => {
         
        console.error('[ws] handler error', err);
        // Never echo raw error text back to the client — server stack/trace strings
        // can leak DB paths, file system layout, internal IPs, etc.
        send(socket, {
          type: 'subscription_error',
          code: 'internal',
          message: 'internal_error',
        });
      });
    });

    socket.on('close', () => {
      conn.closed = true;
      connections.delete(conn);
      clearInterval(healthInterval);
      for (const sub of conn.subs.values()) {
        for (const off of sub.offs) off();
        ctx.subscriptions.release({ symbol: sub.symbol, kind: 'candles', interval: sub.interval });
        ctx.subscriptions.release({ symbol: sub.symbol, kind: 'trades' });
        ctx.subscriptions.release({ symbol: sub.symbol, kind: 'orderbook' });
      }
      conn.subs.clear();
      // Release any standalone orderbook acquisitions made via request_heatmap so we
      // don't leak provider subscriptions per disconnect.
      for (const [symbol, count] of conn.heatmapAcquires) {
        for (let i = 0; i < count; i += 1) {
          ctx.subscriptions.release({ symbol, kind: 'orderbook' });
        }
      }
      conn.heatmapAcquires.clear();
      conn.newsOff?.();
      conn.mt5Off?.();
    });
  });

  return {
    broadcastAlertFired(userId, event) {
      for (const conn of connections) {
        if (conn.closed) continue;
        if (conn.userId !== userId) continue;
        send(conn.socket, { type: 'alert_fired', event });
      }
    },
  };
}

async function handleClientMessage(
  conn: Connection,
  msg: ClientToServerMessage,
  ctx: IngestionContext,
): Promise<void> {
  switch (msg.type) {
    case 'ping':
      send(conn.socket, { type: 'pong', ts: msg.ts, serverTime: Date.now() });
      return;
    case 'subscribe_market':
      await subscribeMarket(conn, msg, ctx);
      return;
    case 'unsubscribe_market':
      unsubscribeMarket(conn, msg.symbol, ctx);
      return;
    case 'change_interval': {
      const existing = [...conn.subs.values()].find((s) => s.symbol === msg.symbol);
      if (existing) {
        // Preserve the overlays the client originally subscribed with so a timeframe
        // change doesn't silently re-enable things they had toggled off (or vice versa).
        const overlays = existing.overlays ?? DEFAULT_OVERLAYS;
        unsubscribeMarket(conn, msg.symbol, ctx);
        await subscribeMarket(
          conn,
          {
            type: 'subscribe_market',
            symbol: msg.symbol,
            interval: msg.interval,
            range: 'live',
            overlays,
          },
          ctx,
        );
      }
      return;
    }
    case 'request_heatmap': {
      // Track the acquisition so close-handler can release it; previously each request
      // acquired an orderbook subscription that never got released, leaking provider
      // subscriptions for every disconnected client that touched the heatmap.
      ctx.subscriptions.acquire({ symbol: msg.symbol, kind: 'orderbook' });
      conn.heatmapAcquires.set(msg.symbol, (conn.heatmapAcquires.get(msg.symbol) ?? 0) + 1);
      const cells = ctx.heatmapAggregator.history(msg.symbol);
      send(conn.socket, { type: 'heatmap_update', symbol: msg.symbol, cells });
      return;
    }
    case 'request_volume_profile': {
      const interval: Interval = '1m';
      const candles = ctx.candleStore.query(msg.symbol, interval, msg.from, msg.to, 5000);
      const rowSize = msg.rowSize ?? 1;
      const profile = buildVisibleRangeProfile(candles, rowSize, msg.valueAreaPercent ?? 0.7);
      send(conn.socket, {
        type: 'volume_profile_update',
        symbol: msg.symbol,
        profile: { mode: msg.mode, symbol: msg.symbol, fromTime: msg.from, toTime: msg.to, ...profile, valueAreaPercent: msg.valueAreaPercent ?? 0.7 },
      });
      return;
    }
    case 'request_footprint':
      // Footprint generation lives in a follow-up phase; ack so client knows it was received.
      send(conn.socket, {
        type: 'subscription_error',
        code: 'internal',
        message: 'footprint_pending_phase_11',
      });
      return;
    case 'set_visible_range':
      // No-op for the gateway: when the client requests deeper history it calls REST /api/candles.
      return;
    case 'subscribe_news':
      // News piggy-backs on HTTP polling for now (low cardinality).
      return;
    case 'unsubscribe_news':
      conn.newsOff?.();
      conn.newsOff = undefined;
      return;
  }
}

async function subscribeMarket(
  conn: Connection,
  msg: SubscribeMarketMessage,
  ctx: IngestionContext,
): Promise<void> {
  if (conn.subs.size >= MAX_SUBS_PER_CONN) {
    send(conn.socket, {
      type: 'subscription_error',
      code: 'rate_limited',
      message: `subscription_limit_${MAX_SUBS_PER_CONN}`,
    });
    return;
  }
  const symbol = msg.symbol;
  const interval = msg.interval;
  const key = `${symbol}:${interval}`;
  if (conn.subs.has(key)) return;

  ctx.subscriptions.acquire({ symbol, kind: 'candles', interval });
  ctx.subscriptions.acquire({ symbol, kind: 'trades' });
  ctx.subscriptions.acquire({ symbol, kind: 'orderbook' });

  // Initial snapshot from cache.
  const candles = ctx.candleStore.query(symbol, interval, undefined, undefined, 500);
  const snapshot: MarketSnapshotMessage = {
    type: 'market_snapshot',
    symbol,
    interval,
    candles,
    heatmap: ctx.heatmapAggregator.history(symbol, 500),
    deepTrades: ctx.deepTradeDetector.history(symbol, 300),
    serverTime: Date.now(),
  };
  send(conn.socket, snapshot);

  const offs: Array<() => void> = [];
  offs.push(
    ctx.bus.onSymbol('candle', symbol, (e) => {
      if (e.data.interval !== interval) return;
      send(conn.socket, { type: 'candle_update', symbol, interval, candle: e.data });
    }),
    ctx.bus.onSymbol('trade', symbol, (e) => {
      send(conn.socket, { type: 'trade_tick', symbol, trade: e.data });
    }),
    ctx.bus.onSymbol('deep_trade', symbol, (e) => {
      send(conn.socket, { type: 'deep_trade', symbol, bubble: e.data });
    }),
    ctx.bus.onSymbol('heatmap', symbol, (e) => {
      send(conn.socket, { type: 'heatmap_update', symbol, cells: e.data });
    }),
    ctx.bus.onSymbol('orderbook', symbol, (e) => {
      send(conn.socket, { type: 'orderbook_delta', symbol, delta: e.data });
    }),
  );

  conn.subs.set(key, { symbol, interval, overlays: msg.overlays, offs });
}

function unsubscribeMarket(conn: Connection, symbol: string, ctx: IngestionContext): void {
  for (const [key, sub] of conn.subs) {
    if (sub.symbol !== symbol) continue;
    for (const off of sub.offs) off();
    conn.subs.delete(key);
    ctx.subscriptions.release({ symbol, kind: 'candles', interval: sub.interval });
    ctx.subscriptions.release({ symbol, kind: 'trades' });
    ctx.subscriptions.release({ symbol, kind: 'orderbook' });
  }
}

function send(socket: WebSocket, msg: ServerToClientMessage): void {
  if (socket.readyState !== 1) return;
  try {
    socket.send(JSON.stringify(msg));
  } catch {
    /* socket may be mid-close */
  }
}
