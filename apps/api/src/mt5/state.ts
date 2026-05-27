/**
 * In-memory MT5 state: accounts, positions, pending orders, last ticks, and
 * intents in flight. The TCP bridge writes to this store as it parses messages
 * from each EA; the REST + WS layers read from it.
 */

import { EventEmitter } from 'node:events';
import type {
  MT5AccountSnapshot,
  MT5PendingOrder,
  MT5Position,
  MT5SymbolInfo,
  MT5Tick,
  OrderIntent,
  OrderIntentResult,
} from '@supercharts/types';

export interface MT5AccountState {
  accountId: string;
  /** SuperCharts user id that paired this account. */
  userId: string;
  /** Token used during pairing (kept for audit; rotated on each reconnect). */
  token: string;
  /** Last hello from EA. */
  eaVersion: string;
  symbols: Map<string, MT5SymbolInfo>;
  snapshot: MT5AccountSnapshot | null;
  positions: Map<string, MT5Position>;
  pending: Map<string, MT5PendingOrder>;
  /** Latest tick per symbol (raw broker symbol code). */
  ticks: Map<string, MT5Tick>;
  /** Connected flag is driven by bridge layer. */
  connected: boolean;
  /** UNIX ms UTC of last heartbeat (or any inbound message). */
  lastSeenAt: number;
}

type MT5Event =
  | { kind: 'account_snapshot'; accountId: string; snapshot: MT5AccountSnapshot }
  | { kind: 'positions'; accountId: string; positions: MT5Position[]; pending: MT5PendingOrder[] }
  | { kind: 'tick'; accountId: string; tick: MT5Tick }
  | { kind: 'order_result'; accountId: string; intentId: string; result: OrderIntentResult }
  | { kind: 'account_added'; accountId: string }
  | { kind: 'account_removed'; accountId: string }
  | { kind: 'log'; accountId: string; level: 'info' | 'warn' | 'error'; message: string };

export class MT5Store extends EventEmitter {
  private accounts = new Map<string, MT5AccountState>();
  /** Pairing tokens that have been issued but not yet attached. */
  private pairingTokens = new Map<string, { userId: string; createdAt: number }>();
  /** In-flight intents keyed by clientId → intent + state. */
  private intents = new Map<string, OrderIntentResult & { intent: OrderIntent }>();

  issuePairingToken(userId: string, token: string): void {
    this.pairingTokens.set(token, { userId, createdAt: Date.now() });
  }

  redeemPairingToken(token: string): string | null {
    const row = this.pairingTokens.get(token);
    if (!row) return null;
    // Tokens are single-use but stay valid for 24h until first attach.
    if (Date.now() - row.createdAt > 24 * 60 * 60_000) {
      this.pairingTokens.delete(token);
      return null;
    }
    return row.userId;
  }

  ensureAccount(accountId: string, userId: string, token: string, eaVersion: string): MT5AccountState {
    const existing = this.accounts.get(accountId);
    if (existing) {
      existing.userId = userId;
      existing.token = token;
      existing.eaVersion = eaVersion;
      existing.connected = true;
      existing.lastSeenAt = Date.now();
      this.emit('event', { kind: 'account_added', accountId } satisfies MT5Event);
      return existing;
    }
    const state: MT5AccountState = {
      accountId,
      userId,
      token,
      eaVersion,
      symbols: new Map(),
      snapshot: null,
      positions: new Map(),
      pending: new Map(),
      ticks: new Map(),
      connected: true,
      lastSeenAt: Date.now(),
    };
    this.accounts.set(accountId, state);
    this.emit('event', { kind: 'account_added', accountId } satisfies MT5Event);
    return state;
  }

  markDisconnected(accountId: string): void {
    const state = this.accounts.get(accountId);
    if (!state) return;
    state.connected = false;
    this.emit('event', { kind: 'account_removed', accountId } satisfies MT5Event);
  }

  applyHelloSymbols(accountId: string, symbols: MT5SymbolInfo[]): void {
    const state = this.accounts.get(accountId);
    if (!state) return;
    state.symbols.clear();
    for (const s of symbols) state.symbols.set(s.raw, s);
  }

  applyAccountSnapshot(accountId: string, snapshot: MT5AccountSnapshot): void {
    const state = this.accounts.get(accountId);
    if (!state) return;
    state.snapshot = snapshot;
    state.lastSeenAt = Date.now();
    this.emit('event', { kind: 'account_snapshot', accountId, snapshot } satisfies MT5Event);
  }

  applyPositionsSnapshot(
    accountId: string,
    positions: MT5Position[],
    pending: MT5PendingOrder[],
  ): void {
    const state = this.accounts.get(accountId);
    if (!state) return;
    state.positions.clear();
    state.pending.clear();
    for (const p of positions) state.positions.set(p.id, p);
    for (const o of pending) state.pending.set(o.id, o);
    state.lastSeenAt = Date.now();
    this.emit('event', { kind: 'positions', accountId, positions, pending } satisfies MT5Event);
  }

  applyTick(accountId: string, tick: MT5Tick): void {
    const state = this.accounts.get(accountId);
    if (!state) return;
    state.ticks.set(tick.symbol, tick);
    state.lastSeenAt = Date.now();
    this.emit('event', { kind: 'tick', accountId, tick } satisfies MT5Event);
  }

  applyHeartbeat(accountId: string): void {
    const state = this.accounts.get(accountId);
    if (!state) return;
    state.lastSeenAt = Date.now();
  }

  applyLog(accountId: string, level: 'info' | 'warn' | 'error', message: string): void {
    this.emit('event', { kind: 'log', accountId, level, message } satisfies MT5Event);
  }

  registerIntent(intentId: string, intent: OrderIntent): void {
    this.intents.set(intentId, {
      intentId,
      intent,
      state: 'queued',
      mt5Results: [],
    });
  }

  updateIntent(intentId: string, patch: Partial<OrderIntentResult>): OrderIntentResult | null {
    const cur = this.intents.get(intentId);
    if (!cur) return null;
    Object.assign(cur, patch);
    const { intent, ...result } = cur;
    void intent; // retained on the stored record for retry/audit
    return result;
  }

  emitIntent(intentId: string): void {
    const cur = this.intents.get(intentId);
    if (!cur) return;
    const { intent, ...result } = cur;
    void intent;
    this.emit('event', {
      kind: 'order_result',
      accountId: cur.intent.accountId,
      intentId,
      result,
    } satisfies MT5Event);
  }

  intent(intentId: string): (OrderIntentResult & { intent: OrderIntent }) | undefined {
    return this.intents.get(intentId);
  }

  account(accountId: string): MT5AccountState | undefined {
    return this.accounts.get(accountId);
  }

  listAccountsForUser(userId: string): MT5AccountState[] {
    const out: MT5AccountState[] = [];
    for (const a of this.accounts.values()) if (a.userId === userId) out.push(a);
    return out;
  }

  positionsForUser(userId: string, accountId?: string): MT5Position[] {
    const out: MT5Position[] = [];
    for (const a of this.accounts.values()) {
      if (a.userId !== userId) continue;
      if (accountId && a.accountId !== accountId) continue;
      for (const p of a.positions.values()) out.push(p);
    }
    return out;
  }

  pendingForUser(userId: string, accountId?: string): MT5PendingOrder[] {
    const out: MT5PendingOrder[] = [];
    for (const a of this.accounts.values()) {
      if (a.userId !== userId) continue;
      if (accountId && a.accountId !== accountId) continue;
      for (const o of a.pending.values()) out.push(o);
    }
    return out;
  }

  /** Garbage collect accounts that haven't sent heartbeats for too long. */
  reapStale(maxAgeMs: number): void {
    const now = Date.now();
    for (const [id, a] of this.accounts) {
      if (!a.connected) continue;
      if (now - a.lastSeenAt > maxAgeMs) {
        a.connected = false;
        this.emit('event', { kind: 'account_removed', accountId: id } satisfies MT5Event);
      }
    }
  }
}

export type { MT5Event };
