'use client';

import { create } from 'zustand';
import type {
  MT5AccountSnapshot,
  MT5PendingOrder,
  MT5Position,
} from '@supercharts/types';
import { api } from '@/lib/api';

export interface MT5AccountView {
  accountId: string;
  connected: boolean;
  eaVersion: string;
  snapshot: MT5AccountSnapshot | null;
  symbols: Array<{ id: string; raw: string; description: string; digits: number; baseCurrency: string; quoteCurrency: string }>;
  lastSeenAt: number;
}

/** Account that paired at some point (persisted server-side), may be offline now. */
export interface MT5KnownAccount {
  accountId: string;
  broker: string;
  server: string;
  currency: string;
  firstSeenAt: number;
  lastSeenAt: number;
  connected: boolean;
}

export interface MT5BridgeStatus {
  bridgePort: number;
  bridgeHost: string;
  connectedAccounts: number;
  knownAccounts: MT5KnownAccount[];
}

interface MT5StoreState {
  accounts: MT5AccountView[];
  positions: MT5Position[];
  pending: MT5PendingOrder[];
  /** Currently focused account id (used by the order panel). */
  activeAccountId: string | null;
  pairingToken: string | null;
  pairingExpiresAt: number | null;
  /** Honest failure message when token generation hit the API and failed. */
  pairingError: string | null;
  /** Live bridge status (null until first successful fetch). */
  bridgeStatus: MT5BridgeStatus | null;
  /** Honest failure message when the status fetch failed (API down). */
  statusError: string | null;
  refreshAccounts: () => Promise<void>;
  refreshPositions: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  setActiveAccount: (id: string | null) => void;
  generatePairingToken: () => Promise<void>;
  /** WebSocket dispatcher — call from the main ws client. */
  ingestEvent: (event: unknown) => void;
}

export const useMT5Store = create<MT5StoreState>((set, get) => ({
  accounts: [],
  positions: [],
  pending: [],
  activeAccountId: null,
  pairingToken: null,
  pairingExpiresAt: null,
  pairingError: null,
  bridgeStatus: null,
  statusError: null,

  async refreshAccounts() {
    try {
      const r = await api<{ accounts: MT5AccountView[] }>('/mt5/accounts');
      const cur = get();
      const next = r.accounts;
      const activeStillThere = next.some((a) => a.accountId === cur.activeAccountId);
      set({
        accounts: next,
        activeAccountId: activeStillThere ? cur.activeAccountId : next[0]?.accountId ?? null,
      });
    } catch {
      /* offline ok */
    }
  },

  async refreshPositions() {
    try {
      const r = await api<{ positions: MT5Position[]; pending: MT5PendingOrder[] }>(
        '/mt5/positions',
      );
      set({ positions: r.positions, pending: r.pending });
    } catch {
      /* offline ok */
    }
  },

  async refreshStatus() {
    try {
      const r = await api<MT5BridgeStatus>('/mt5/status');
      set({ bridgeStatus: r, statusError: null });
    } catch (err) {
      set({ statusError: (err as Error).message || 'API unreachable' });
    }
  },

  setActiveAccount(id) {
    set({ activeAccountId: id });
  },

  async generatePairingToken() {
    try {
      const r = await api<{ token: string; expiresInMs: number }>('/mt5/pair-tokens', {
        method: 'POST',
      });
      set({
        pairingToken: r.token,
        pairingExpiresAt: Date.now() + r.expiresInMs,
        pairingError: null,
      });
    } catch (err) {
      // Surface the failure instead of showing "Generating…" forever.
      set({ pairingError: (err as Error).message || 'Token request failed' });
    }
  },

  ingestEvent(event) {
    if (!event || typeof event !== 'object' || !('kind' in event)) return;
    const e = event as { kind: string } & Record<string, unknown>;
    switch (e.kind) {
      case 'account_added':
      case 'account_removed':
        void get().refreshAccounts();
        void get().refreshStatus();
        return;
      case 'account_snapshot': {
        const snap = e.snapshot as MT5AccountSnapshot;
        const accountId = e.accountId as string;
        set((s) => ({
          accounts: s.accounts.map((a) =>
            a.accountId === accountId ? { ...a, snapshot: snap, lastSeenAt: Date.now() } : a,
          ),
        }));
        return;
      }
      case 'positions': {
        const accountId = e.accountId as string;
        const positions = e.positions as MT5Position[];
        const pending = e.pending as MT5PendingOrder[];
        set((s) => ({
          positions: [
            ...s.positions.filter((p) => p.accountId !== accountId),
            ...positions,
          ],
          pending: [
            ...s.pending.filter((p) => p.accountId !== accountId),
            ...pending,
          ],
        }));
        return;
      }
      case 'order_result': {
        // Refresh positions to reflect any new fills/closes.
        void get().refreshPositions();
        return;
      }
      case 'tick':
      case 'log':
        return;
    }
  },
}));
