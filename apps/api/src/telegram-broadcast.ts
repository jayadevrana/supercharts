/**
 * Telegram broadcast-channel helpers (Phase 4 #17).
 *
 * Pure + unit-tested. The broadcast feature lets a user push messages to a Telegram *channel*
 * (one-to-many) via a bot that admins it, separate from the private alert chat. This module only
 * normalises the channel identifier a user pastes — the network calls live in telegram.ts and the
 * route. We never touch the live alert/Telegram config here.
 */

/** Telegram's hard message length limit. */
export const MAX_BROADCAST_LEN = 4096;

/**
 * Normalise whatever a user pastes for a channel into a Telegram-acceptable chat id:
 *   - "@name", "name", "https://t.me/name", "t.me/s/name" → "@name"
 *   - a numeric id (e.g. "-1001234567890") → unchanged
 *   - blank → ""
 */
export function normalizeChannelId(input: string): string {
  let s = (input ?? '').trim();
  if (s === '') return '';

  // Pull the handle out of any t.me link form (with optional https:// and /s/ preview path).
  const link = s.match(/(?:https?:\/\/)?t\.me\/(?:s\/)?@?([A-Za-z0-9_]+)/i);
  if (link) return `@${link[1]}`;

  // A numeric chat id (channels are large negatives) is used verbatim.
  if (/^-?\d+$/.test(s)) return s;

  s = s.replace(/^@+/, '');
  return s === '' ? '' : `@${s}`;
}
