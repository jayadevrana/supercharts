/**
 * TCP bridge that accepts connections from MetaTrader 5 EAs.
 *
 * Wire format: one JSON object per line, UTF-8. See
 * `packages/types/src/mt5.ts` for message shapes.
 */

import { createServer, type Server, type Socket } from 'node:net';
import type {
  MT5AccountSnapshotMessage,
  MT5EAToServerMessage,
  MT5HelloMessage,
  MT5HeartbeatMessage,
  MT5LogMessage,
  MT5OrderResultMessage,
  MT5PositionsSnapshotMessage,
  MT5ServerToEAMessage,
  MT5TickMessage,
} from '@supercharts/types';
import type { MT5Store } from './state';

const PARTIAL_LINE_MAX = 1 * 1024 * 1024; // 1 MiB safety net for a single JSON line

interface EAConnection {
  socket: Socket;
  /** Set once we see a valid mt5_hello message. */
  accountId: string | null;
  buffer: string;
  /** intent ids that are tied to clientIds the bridge sent on behalf of the server. */
  pendingClientIds: Map<string, string>;
}

export interface MT5Bridge {
  close: () => Promise<void>;
  send: (accountId: string, msg: MT5ServerToEAMessage) => boolean;
  trackClientId: (accountId: string, clientId: string, intentId: string) => void;
  isOnline: (accountId: string) => boolean;
}

export function startMT5Bridge(opts: {
  port: number;
  host?: string;
  store: MT5Store;
  log: (msg: string, level?: 'info' | 'warn' | 'error') => void;
}): Promise<MT5Bridge> {
  const { port, host = '0.0.0.0', store, log } = opts;
  /** accountId -> connection. Only one EA per account. */
  const byAccount = new Map<string, EAConnection>();

  function handleLine(conn: EAConnection, line: string): void {
    let parsed: MT5EAToServerMessage | null = null;
    try {
      parsed = JSON.parse(line) as MT5EAToServerMessage;
    } catch (err) {
      log(`[mt5] parse error from EA: ${String(err)}`, 'warn');
      return;
    }
    if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) return;
    switch (parsed.type) {
      case 'mt5_hello':
        applyHello(conn, parsed);
        return;
      case 'mt5_account_snapshot':
        applyAccountSnapshot(conn, parsed);
        return;
      case 'mt5_positions_snapshot':
        applyPositions(conn, parsed);
        return;
      case 'mt5_tick':
        applyTick(conn, parsed);
        return;
      case 'mt5_order_result':
        applyOrderResult(conn, parsed);
        return;
      case 'mt5_heartbeat':
        applyHeartbeat(conn, parsed);
        return;
      case 'mt5_log':
        applyLog(conn, parsed);
        return;
    }
  }

  function applyHello(conn: EAConnection, msg: MT5HelloMessage): void {
    const tokenMaybe = (msg as MT5HelloMessage & { token?: string }).token;
    if (!tokenMaybe) {
      log('[mt5] hello without token, refusing', 'warn');
      conn.socket.end();
      return;
    }
    const userId = store.redeemPairingToken(tokenMaybe);
    if (!userId) {
      log('[mt5] hello with invalid pairing token', 'warn');
      conn.socket.end();
      return;
    }
    const accountId = msg.account.id;
    conn.accountId = accountId;
    byAccount.set(accountId, conn);
    store.ensureAccount(accountId, userId, tokenMaybe, msg.eaVersion);
    store.applyHelloSymbols(accountId, msg.symbols);
    log(`[mt5] EA paired account=${accountId} user=${userId} version=${msg.eaVersion}`);
  }

  function applyAccountSnapshot(conn: EAConnection, msg: MT5AccountSnapshotMessage): void {
    if (!conn.accountId) return;
    store.applyAccountSnapshot(conn.accountId, msg.snapshot);
  }

  function applyPositions(conn: EAConnection, msg: MT5PositionsSnapshotMessage): void {
    if (!conn.accountId) return;
    store.applyPositionsSnapshot(conn.accountId, msg.positions, msg.pending);
  }

  function applyTick(conn: EAConnection, msg: MT5TickMessage): void {
    if (!conn.accountId) return;
    store.applyTick(conn.accountId, msg.tick);
  }

  function applyOrderResult(conn: EAConnection, msg: MT5OrderResultMessage): void {
    if (!conn.accountId) return;
    const intentId = conn.pendingClientIds.get(msg.result.clientId);
    if (intentId) {
      const existing = store.intent(intentId);
      const merged = [
        ...(existing?.mt5Results ?? []),
        {
          clientId: msg.result.clientId,
          state: msg.result.state,
          ticket: msg.result.ticket,
          retcodeText: msg.result.retcodeText,
          filledPrice: msg.result.filledPrice,
          filledVolume: msg.result.filledVolume,
        },
      ];
      const next = store.updateIntent(intentId, {
        state:
          msg.result.state === 'filled'
            ? 'filled'
            : msg.result.state === 'rejected'
              ? 'rejected'
              : msg.result.state === 'partially_filled'
                ? 'partial'
                : 'sent',
        mt5Results: merged,
        position: msg.result.position,
        order: msg.result.order,
        message: msg.result.retcodeText,
      });
      if (next) store.emitIntent(intentId);
      if (msg.result.state === 'filled' || msg.result.state === 'rejected') {
        conn.pendingClientIds.delete(msg.result.clientId);
      }
    }
  }

  function applyHeartbeat(conn: EAConnection, _msg: MT5HeartbeatMessage): void {
    if (!conn.accountId) return;
    store.applyHeartbeat(conn.accountId);
  }

  function applyLog(conn: EAConnection, msg: MT5LogMessage): void {
    if (!conn.accountId) return;
    store.applyLog(conn.accountId, msg.level, msg.message);
  }

  function send(accountId: string, msg: MT5ServerToEAMessage): boolean {
    const conn = byAccount.get(accountId);
    if (!conn || conn.socket.destroyed) return false;
    try {
      conn.socket.write(JSON.stringify(msg) + '\n');
      return true;
    } catch (err) {
      log(`[mt5] write failed account=${accountId} err=${String(err)}`, 'warn');
      return false;
    }
  }

  function trackClientId(accountId: string, clientId: string, intentId: string): void {
    const conn = byAccount.get(accountId);
    if (!conn) return;
    conn.pendingClientIds.set(clientId, intentId);
  }

  function isOnline(accountId: string): boolean {
    const conn = byAccount.get(accountId);
    return Boolean(conn && !conn.socket.destroyed);
  }

  const server: Server = createServer((socket) => {
    socket.setKeepAlive(true, 5_000);
    socket.setNoDelay(true);
    const conn: EAConnection = {
      socket,
      accountId: null,
      buffer: '',
      pendingClientIds: new Map(),
    };
    log(`[mt5] EA socket open from ${socket.remoteAddress}:${socket.remotePort}`);
    socket.on('data', (chunk) => {
      conn.buffer += chunk.toString('utf8');
      if (conn.buffer.length > PARTIAL_LINE_MAX) {
        log('[mt5] dropping connection — line buffer overflow', 'warn');
        socket.destroy();
        return;
      }
      let nl: number;
      while ((nl = conn.buffer.indexOf('\n')) >= 0) {
        const line = conn.buffer.slice(0, nl).trim();
        conn.buffer = conn.buffer.slice(nl + 1);
        if (line.length > 0) handleLine(conn, line);
      }
    });
    socket.on('close', () => {
      if (conn.accountId) {
        byAccount.delete(conn.accountId);
        store.markDisconnected(conn.accountId);
      }
      log(`[mt5] EA socket closed account=${conn.accountId ?? 'unpaired'}`);
    });
    socket.on('error', (err) => {
      log(`[mt5] EA socket error: ${err.message}`, 'warn');
    });
  });

  const reaper = setInterval(() => store.reapStale(20_000), 5_000);

  return new Promise<MT5Bridge>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      log(`[mt5] bridge listening on tcp://${host}:${port}`);
      resolve({
        send,
        trackClientId,
        isOnline,
        close: () =>
          new Promise<void>((res) => {
            clearInterval(reaper);
            for (const c of byAccount.values()) c.socket.destroy();
            server.close(() => res());
          }),
      });
    });
  });
}
