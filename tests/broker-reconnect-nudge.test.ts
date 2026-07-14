import { describe, expect, it } from 'vitest';
import {
  istTokenResetBoundary,
  istClock,
  isTokenStale,
  computeReconnectNudges,
  formatReconnectNudge,
  runReconnectNudge,
  type ArmedConnection,
} from '../apps/api/src/broker/reconnect-nudge';

const utc = (s: string) => Date.parse(s);

// GW-7 polish (a): the "who to nudge" helper for the daily 9:00 IST Kite-token reconnect reminder.
// Kite Connect access tokens invalidate once per IST morning (default 06:00); an armed automation
// silently stops trading until the owner reconnects. These are pure, deterministic (IST is a fixed
// +5:30 offset, no DST) — no broker, DB, or network is touched. The runner sends NOTHING itself; it
// composes over injected deps so a stub proves it never places an order and never spams.

describe('istTokenResetBoundary (IST, fixed +5:30, no DST)', () => {
  it('after 06:00 IST → today 06:00 IST (in UTC)', () => {
    const now = utc('2026-07-14T04:30:00Z'); // 10:00 IST
    expect(istTokenResetBoundary(now, 6)).toBe(utc('2026-07-14T00:30:00Z')); // 06:00 IST today
  });
  it('before 06:00 IST → yesterday 06:00 IST', () => {
    const now = utc('2026-07-13T23:30:00Z'); // 05:00 IST on Jul 14
    expect(istTokenResetBoundary(now, 6)).toBe(utc('2026-07-13T00:30:00Z')); // 06:00 IST Jul 13
  });
});

describe('istClock', () => {
  it('reports the IST wall-clock hour', () => {
    expect(istClock(utc('2026-07-14T04:30:00Z')).hour).toBe(10); // 10:00 IST
    expect(istClock(utc('2026-07-14T03:30:00Z')).hour).toBe(9); // 09:00 IST
  });
  it('rolls the day index at IST midnight, not UTC midnight', () => {
    const lateIst = istClock(utc('2026-07-14T20:00:00Z')); // 01:30 IST Jul 15
    const earlyIst = istClock(utc('2026-07-14T10:00:00Z')); // 15:30 IST Jul 14
    expect(lateIst.dayIndex).toBe(earlyIst.dayIndex + 1);
  });
});

describe('isTokenStale', () => {
  const now = utc('2026-07-14T04:30:00Z'); // 10:00 IST → boundary = 06:00 IST today (00:30Z)
  it('null lastLogin → stale', () => expect(isTokenStale(null, now)).toBe(true));
  it('login before today 06:00 IST → stale', () =>
    expect(isTokenStale(utc('2026-07-13T20:00:00Z'), now)).toBe(true));
  it('login after today 06:00 IST → fresh', () =>
    expect(isTokenStale(utc('2026-07-14T02:00:00Z'), now)).toBe(false)); // 07:30 IST today
});

describe('computeReconnectNudges', () => {
  const now = utc('2026-07-14T04:30:00Z');
  const base = (o: Partial<ArmedConnection>): ArmedConnection => ({
    userId: 'u', broker: 'kite', status: 'active', lastLoginAt: null, armedAutomationCount: 1, ...o,
  });

  it('active + armed + stale token → candidate', () => {
    const r = computeReconnectNudges([base({ userId: 'a' })], { now });
    expect(r.map((c) => c.userId)).toEqual(['a']);
  });
  it('skips pending/inactive connections', () => {
    const r = computeReconnectNudges([base({ userId: 'b', status: 'pending' })], { now });
    expect(r).toHaveLength(0);
  });
  it('skips users with no armed automation by default', () => {
    const r = computeReconnectNudges([base({ userId: 'c', armedAutomationCount: 0 })], { now });
    expect(r).toHaveLength(0);
  });
  it('skips fresh tokens (already reconnected today)', () => {
    const r = computeReconnectNudges([base({ userId: 'd', lastLoginAt: utc('2026-07-14T02:00:00Z') })], { now });
    expect(r).toHaveLength(0);
  });
  it('requireArmed:false nudges even a connection with no automation', () => {
    const r = computeReconnectNudges([base({ userId: 'e', armedAutomationCount: 0 })], { now, requireArmed: false });
    expect(r.map((c) => c.userId)).toEqual(['e']);
  });
});

describe('formatReconnectNudge', () => {
  it('names the broker + plural armed count + optional terminal link', () => {
    const msg = formatReconnectNudge(
      { userId: 'u', broker: 'kite', armedAutomationCount: 2, lastLoginAt: null },
      { appUrl: 'https://supercharting.com' },
    );
    expect(msg).toContain('Zerodha Kite');
    expect(msg).toContain('2 armed automations');
    expect(msg).toContain('https://supercharting.com/terminal');
  });
  it('singular for one automation; no link when appUrl omitted', () => {
    const msg = formatReconnectNudge({ userId: 'u', broker: 'kite', armedAutomationCount: 1, lastLoginAt: null });
    expect(msg).toContain('1 armed automation');
    expect(msg).not.toContain('automations');
    expect(msg).not.toContain('/terminal');
  });
});

describe('runReconnectNudge', () => {
  const now = utc('2026-07-14T04:30:00Z');

  it('sends only to stale+armed users with an enabled bot; skips those without; never touches fresh/unarmed', async () => {
    const conns: ArmedConnection[] = [
      { userId: 'stale-bot', broker: 'kite', status: 'active', lastLoginAt: null, armedAutomationCount: 1 },
      { userId: 'stale-nobot', broker: 'kite', status: 'active', lastLoginAt: null, armedAutomationCount: 2 },
      { userId: 'fresh', broker: 'kite', status: 'active', lastLoginAt: utc('2026-07-14T02:00:00Z'), armedAutomationCount: 1 },
    ];
    const sends: Array<{ chatId: string; text: string }> = [];
    const res = await runReconnectNudge({
      now,
      loadArmedConnections: () => conns,
      resolveBot: (u) => (u === 'stale-bot' ? { botToken: 'T', chatId: 'C', enabled: 1 } : undefined),
      send: async ({ chatId, text }) => { sends.push({ chatId, text }); },
    });
    expect(res.sent).toEqual(['stale-bot']);
    expect(res.skipped).toEqual([{ userId: 'stale-nobot', reason: 'no_enabled_bot' }]);
    expect(res.candidates.map((c) => c.userId)).toEqual(['stale-bot', 'stale-nobot']);
    expect(sends).toHaveLength(1);
    expect(sends[0].chatId).toBe('C');
  });

  it('a send failure is captured as skipped, never thrown', async () => {
    const res = await runReconnectNudge({
      now,
      loadArmedConnections: () => [{ userId: 'x', broker: 'kite', status: 'active', lastLoginAt: null, armedAutomationCount: 1 }],
      resolveBot: () => ({ botToken: 'T', chatId: 'C', enabled: 1 }),
      send: async () => { throw new Error('telegram down'); },
    });
    expect(res.sent).toEqual([]);
    expect(res.skipped).toEqual([{ userId: 'x', reason: 'send_failed' }]);
  });

  it('a disabled bot → skipped, no send', async () => {
    let calls = 0;
    const res = await runReconnectNudge({
      now,
      loadArmedConnections: () => [{ userId: 'y', broker: 'kite', status: 'active', lastLoginAt: null, armedAutomationCount: 1 }],
      resolveBot: () => ({ botToken: 'T', chatId: 'C', enabled: 0 }),
      send: async () => { calls += 1; },
    });
    expect(res.skipped).toEqual([{ userId: 'y', reason: 'no_enabled_bot' }]);
    expect(calls).toBe(0);
  });
});
