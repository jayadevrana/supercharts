/**
 * GW-7 polish (a): the daily Kite-token reconnect nudge.
 *
 * Zerodha Kite Connect access tokens are invalidated once per IST morning (default 06:00 IST). When
 * that happens a user's ARMED SuperTrend flip automations silently stop trading until they reconnect
 * and mint a fresh daily token. This module answers "who needs a morning reminder?" and composes the
 * Telegram send over injected deps — it PLACES NO ORDER, touches no DB, and sends nothing itself, so
 * the build loop can prove every path against a stub.
 *
 * IST is a fixed +05:30 offset (India observes no DST), so all the time math here is deterministic —
 * no timezone library, no ambiguity.
 */

import type { BrokerId } from './types';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/**
 * The most recent daily Kite-token reset instant (UTC ms) at or before `now`. A user who last logged
 * in before this boundary is on a stale token. `resetHourIst` defaults to 6 (06:00 IST — Kite's daily
 * invalidation window).
 */
export function istTokenResetBoundary(now: number, resetHourIst = 6): number {
  const istNow = now + IST_OFFSET_MS; // shift into IST wall-clock space
  const istMidnight = Math.floor(istNow / DAY_MS) * DAY_MS; // start of the IST calendar day
  let resetIst = istMidnight + resetHourIst * HOUR_MS;
  if (resetIst > istNow) resetIst -= DAY_MS; // reset hasn't happened yet today → use yesterday's
  return resetIst - IST_OFFSET_MS; // back to UTC ms
}

/** IST wall-clock hour (0–23) and calendar-day index for `now`. Used by the scheduler tick. */
export function istClock(now: number): { hour: number; dayIndex: number } {
  const ist = now + IST_OFFSET_MS;
  const dayIndex = Math.floor(ist / DAY_MS);
  const hour = Math.floor((ist - dayIndex * DAY_MS) / HOUR_MS);
  return { hour, dayIndex };
}

/** True when a token last minted at `lastLoginAt` is stale relative to the most-recent IST reset. */
export function isTokenStale(lastLoginAt: number | null, now: number, resetHourIst = 6): boolean {
  if (lastLoginAt == null) return true;
  return lastLoginAt < istTokenResetBoundary(now, resetHourIst);
}

export interface ArmedConnection {
  userId: string;
  broker: BrokerId;
  status: string;
  lastLoginAt: number | null;
  armedAutomationCount: number;
}

export interface NudgeCandidate {
  userId: string;
  broker: BrokerId;
  armedAutomationCount: number;
  lastLoginAt: number | null;
}

export interface ComputeNudgeOptions {
  now: number;
  resetHourIst?: number;
  /** Only nudge users who have ≥1 armed automation (default true — an unarmed connection needs no reminder). */
  requireArmed?: boolean;
}

/** Filter connections down to those that should get a reconnect nudge right now. */
export function computeReconnectNudges(
  conns: ArmedConnection[],
  opts: ComputeNudgeOptions,
): NudgeCandidate[] {
  const requireArmed = opts.requireArmed ?? true;
  const out: NudgeCandidate[] = [];
  for (const c of conns) {
    if (c.status !== 'active') continue;
    if (requireArmed && c.armedAutomationCount <= 0) continue;
    if (!isTokenStale(c.lastLoginAt, opts.now, opts.resetHourIst)) continue;
    out.push({
      userId: c.userId,
      broker: c.broker,
      armedAutomationCount: c.armedAutomationCount,
      lastLoginAt: c.lastLoginAt,
    });
  }
  return out;
}

const BROKER_LABEL: Record<BrokerId, string> = { kite: 'Zerodha Kite', oanda: 'OANDA' };

/** HTML-parse-mode Telegram body for a reconnect reminder. */
export function formatReconnectNudge(candidate: NudgeCandidate, opts?: { appUrl?: string }): string {
  const label = BROKER_LABEL[candidate.broker] ?? candidate.broker;
  const n = candidate.armedAutomationCount;
  const noun = n === 1 ? 'automation' : 'automations';
  const link = opts?.appUrl ? `\n\nReconnect now: ${opts.appUrl}/terminal` : '';
  return (
    `🔑 <b>Reconnect ${label} for today</b>\n` +
    `Your daily access token has expired. ${n} armed ${noun} won't place orders until you reconnect ` +
    `and mint a fresh token.${link}`
  );
}

export interface ReconnectNudgeRunDeps {
  now: number;
  resetHourIst?: number;
  appUrl?: string;
  /** Active broker connections + their armed-automation counts (DB-backed in production). */
  loadArmedConnections: () => ArmedConnection[];
  /** Resolve a user's first enabled Telegram bot (undefined → skip). */
  resolveBot: (userId: string) => { botToken: string; chatId: string; enabled: number } | undefined;
  /** Deliver one message. Injected so tests never hit Telegram. */
  send: (args: { botToken: string; chatId: string; text: string }) => Promise<void>;
  log?: (msg: string, extra?: unknown) => void;
}

export interface ReconnectNudgeRunResult {
  candidates: NudgeCandidate[];
  sent: string[];
  skipped: Array<{ userId: string; reason: 'no_enabled_bot' | 'send_failed' }>;
}

/**
 * Compute the nudge list and deliver each via the injected sender. Never throws — a wedged Telegram
 * or a missing bot is captured as a `skipped` entry, exactly like the alert engine's fire-and-forget
 * delivery, so the scheduler can't crash the process.
 */
export async function runReconnectNudge(deps: ReconnectNudgeRunDeps): Promise<ReconnectNudgeRunResult> {
  const candidates = computeReconnectNudges(deps.loadArmedConnections(), {
    now: deps.now,
    resetHourIst: deps.resetHourIst,
  });
  const sent: string[] = [];
  const skipped: ReconnectNudgeRunResult['skipped'] = [];
  for (const c of candidates) {
    const bot = deps.resolveBot(c.userId);
    if (!bot || !bot.enabled || !bot.botToken || !bot.chatId) {
      skipped.push({ userId: c.userId, reason: 'no_enabled_bot' });
      continue;
    }
    try {
      await deps.send({
        botToken: bot.botToken,
        chatId: bot.chatId,
        text: formatReconnectNudge(c, { appUrl: deps.appUrl }),
      });
      sent.push(c.userId);
    } catch (err) {
      deps.log?.('[gw7] reconnect nudge send failed', { userId: c.userId, err });
      skipped.push({ userId: c.userId, reason: 'send_failed' });
    }
  }
  return { candidates, sent, skipped };
}
