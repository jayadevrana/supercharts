/**
 * Inbound webhook signal parsing (Phase 3 #15).
 *
 * External systems (e.g. a TradingView alert, a cron job, a custom bot) POST a signal to a
 * per-user secret URL. The body may be JSON or plain text — TradingView, for instance, just
 * delivers whatever text sits in the alert's message box. This module is a pure, unit-tested
 * normaliser from that free-form body into our own canonical `WebhookSignal` shape. We define
 * the schema; we don't reproduce any third party's. Unknown shapes are kept verbatim in `raw`.
 */

export interface WebhookSignal {
  /** Instrument, if the sender included one (symbol / ticker). */
  symbol: string | null;
  /** Free-form intent: buy / sell / close / alert / … (lower-cased). */
  action: string | null;
  /** Reference price, if numeric. */
  price: number | null;
  /** Human note / message. */
  note: string | null;
  /** The original parsed payload (object or string) for display + audit. */
  raw: unknown;
}

const FIELD_ALIASES = {
  symbol: ['symbol', 'ticker', 'sym', 'pair', 'instrument'],
  action: ['action', 'side', 'signal', 'event', 'order', 'type'],
  price: ['price', 'close', 'p', 'entry'],
  note: ['note', 'message', 'msg', 'comment', 'text', 'alert', 'reason'],
} as const;

function firstString(obj: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

function firstNumber(obj: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const n = Number(v.replace(/[,$\s]/g, ''));
      if (Number.isFinite(n) && v.trim() !== '') return n;
    }
  }
  return null;
}

/**
 * Normalise an inbound webhook body (already-parsed object, or a raw string) into a WebhookSignal.
 * A string body is parsed as JSON when possible, otherwise treated as a plain message note.
 */
export function parseWebhookPayload(body: unknown): WebhookSignal {
  let payload: unknown = body;

  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (trimmed === '') return { symbol: null, action: null, price: null, note: null, raw: '' };
    try {
      const j = JSON.parse(trimmed);
      payload = j;
    } catch {
      // Not JSON — the whole string is the message.
      return { symbol: null, action: null, price: null, note: trimmed, raw: trimmed };
    }
  }

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const obj = payload as Record<string, unknown>;
    const action = firstString(obj, FIELD_ALIASES.action);
    return {
      symbol: firstString(obj, FIELD_ALIASES.symbol),
      action: action ? action.toLowerCase() : null,
      price: firstNumber(obj, FIELD_ALIASES.price),
      note: firstString(obj, FIELD_ALIASES.note),
      raw: payload,
    };
  }

  // Arrays / numbers / null → no recognisable fields, keep raw.
  return { symbol: null, action: null, price: null, note: null, raw: payload ?? null };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const ACTION_ICON: Record<string, string> = {
  buy: '🟢',
  long: '🟢',
  sell: '🔴',
  short: '🔴',
  close: '⚪️',
  exit: '⚪️',
  alert: '🔔',
};

/** Render a signal as a Telegram HTML message for opt-in forwarding. */
export function formatWebhookTelegram(signal: WebhookSignal): string {
  const icon = (signal.action && ACTION_ICON[signal.action]) || '🔔';
  const head = [signal.action?.toUpperCase(), signal.symbol].filter(Boolean).join(' ') || 'Signal';
  const lines = [`${icon} <b>Webhook: ${escapeHtml(head)}</b>`];
  if (signal.price != null) lines.push(`Price: <code>${signal.price}</code>`);
  if (signal.note) lines.push(escapeHtml(signal.note));
  if (!signal.symbol && !signal.action && !signal.price && !signal.note && typeof signal.raw === 'object') {
    lines.push(`<code>${escapeHtml(JSON.stringify(signal.raw).slice(0, 300))}</code>`);
  }
  return lines.join('\n');
}
