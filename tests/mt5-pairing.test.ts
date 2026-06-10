import { describe, it, expect } from 'vitest';
import { MT5Store } from '../apps/api/src/mt5/state';
import type { MT5AccountSummary } from '@supercharts/types';

/**
 * MT5 pairing-token lifecycle: hydration after a restart, expiry, and the
 * touch-on-attach renewal that keeps a live EA paired across the 24h boundary.
 */

const summary: MT5AccountSummary = {
  id: '12345@TestBroker',
  login: 12345,
  broker: 'TestBroker',
  server: 'TestBroker-Demo',
  currency: 'USD',
  name: 'Unit Test',
  leverage: 100,
  tradeMode: 'demo',
  updatedAt: 0,
};

describe('MT5Store pairing tokens', () => {
  it('redeems a freshly issued token', () => {
    const store = new MT5Store();
    store.issuePairingToken('user-1', 'tok-a');
    expect(store.redeemPairingToken('tok-a')).toBe('user-1');
  });

  it('redeem is repeatable (EA reconnects reuse the same token)', () => {
    const store = new MT5Store();
    store.issuePairingToken('user-1', 'tok-a');
    expect(store.redeemPairingToken('tok-a')).toBe('user-1');
    expect(store.redeemPairingToken('tok-a')).toBe('user-1');
  });

  it('rejects unknown tokens', () => {
    const store = new MT5Store();
    expect(store.redeemPairingToken('nope')).toBeNull();
  });

  it('honours a hydrated createdAt: a >24h-old persisted token is expired', () => {
    const store = new MT5Store();
    const dayAgo = Date.now() - 25 * 60 * 60_000;
    store.issuePairingToken('user-1', 'tok-old', dayAgo);
    expect(store.redeemPairingToken('tok-old')).toBeNull();
    // Expired tokens are dropped on redeem.
    expect(store.redeemPairingToken('tok-old')).toBeNull();
  });

  it('hydrated token within 24h still redeems (restart survival)', () => {
    const store = new MT5Store();
    const twoHoursAgo = Date.now() - 2 * 60 * 60_000;
    store.issuePairingToken('user-1', 'tok-recent', twoHoursAgo);
    expect(store.redeemPairingToken('tok-recent')).toBe('user-1');
  });

  it('touchPairingToken renews an almost-expired token', () => {
    const store = new MT5Store();
    const almostExpired = Date.now() - 23.9 * 60 * 60_000;
    store.issuePairingToken('user-1', 'tok-live', almostExpired);
    store.touchPairingToken('tok-live');
    // Now anchored to "now", so it must survive well past the old deadline.
    expect(store.redeemPairingToken('tok-live')).toBe('user-1');
  });

  it('touchPairingToken on an unknown token is a no-op', () => {
    const store = new MT5Store();
    expect(() => store.touchPairingToken('ghost')).not.toThrow();
  });
});

describe('MT5Store account summary', () => {
  it('ensureAccount stores the hello summary for persistence/audit', () => {
    const store = new MT5Store();
    const state = store.ensureAccount('12345@TestBroker', 'user-1', 'tok-a', '1.0.0', summary);
    expect(state.summary?.broker).toBe('TestBroker');
    expect(state.summary?.server).toBe('TestBroker-Demo');
    expect(state.summary?.currency).toBe('USD');
  });

  it('re-attach without a summary keeps the previous one', () => {
    const store = new MT5Store();
    store.ensureAccount('12345@TestBroker', 'user-1', 'tok-a', '1.0.0', summary);
    const again = store.ensureAccount('12345@TestBroker', 'user-1', 'tok-a', '1.0.1');
    expect(again.summary?.broker).toBe('TestBroker');
    expect(again.eaVersion).toBe('1.0.1');
  });

  it('emits account_added with the account retrievable for persistence', () => {
    const store = new MT5Store();
    const events: string[] = [];
    store.on('event', (e: { kind: string; accountId?: string }) => {
      if (e.kind === 'account_added' && e.accountId) {
        const acc = store.account(e.accountId);
        events.push(`${e.kind}:${acc?.summary?.broker ?? '?'}`);
      }
    });
    store.ensureAccount('12345@TestBroker', 'user-1', 'tok-a', '1.0.0', summary);
    expect(events).toEqual(['account_added:TestBroker']);
  });
});
