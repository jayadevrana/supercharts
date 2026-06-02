import { describe, it, expect } from 'vitest';
import { parseWebhookPayload, formatWebhookTelegram } from '../apps/api/src/webhook-signal';

describe('parseWebhookPayload', () => {
  it('extracts canonical fields from a JSON object', () => {
    const s = parseWebhookPayload({ symbol: 'BINANCE:BTCUSDT', action: 'BUY', price: 67000, note: 'EMA cross' });
    expect(s).toMatchObject({ symbol: 'BINANCE:BTCUSDT', action: 'buy', price: 67000, note: 'EMA cross' });
  });

  it('accepts generic aliases (ticker/side/message)', () => {
    const s = parseWebhookPayload({ ticker: 'EURUSD', side: 'Sell', message: 'breakdown' });
    expect(s.symbol).toBe('EURUSD');
    expect(s.action).toBe('sell');
    expect(s.note).toBe('breakdown');
  });

  it('parses a JSON string body', () => {
    const s = parseWebhookPayload('{"symbol":"XAUUSD","action":"close","price":"2350.5"}');
    expect(s.symbol).toBe('XAUUSD');
    expect(s.action).toBe('close');
    expect(s.price).toBe(2350.5);
  });

  it('treats a non-JSON string as a plain note', () => {
    const s = parseWebhookPayload('RSI overbought on BTC');
    expect(s.note).toBe('RSI overbought on BTC');
    expect(s.symbol).toBeNull();
    expect(s.raw).toBe('RSI overbought on BTC');
  });

  it('coerces numeric strings and ignores blanks', () => {
    const s = parseWebhookPayload({ symbol: 'BTC', price: '1,234.5', action: '' });
    expect(s.price).toBe(1234.5);
    expect(s.action).toBeNull();
  });

  it('keeps the raw payload and nulls fields for unrecognised shapes', () => {
    const s = parseWebhookPayload([1, 2, 3]);
    expect(s.symbol).toBeNull();
    expect(s.note).toBeNull();
    expect(s.raw).toEqual([1, 2, 3]);
  });

  it('handles an empty string body without throwing', () => {
    const s = parseWebhookPayload('');
    expect(s).toMatchObject({ symbol: null, action: null, price: null, note: null });
  });
});

describe('formatWebhookTelegram', () => {
  it('renders an action + symbol header with a price line', () => {
    const msg = formatWebhookTelegram(parseWebhookPayload({ symbol: 'BTCUSDT', action: 'buy', price: 67000 }));
    expect(msg).toContain('Webhook: BUY BTCUSDT');
    expect(msg).toContain('67000');
    expect(msg.startsWith('🟢')).toBe(true);
  });

  it('escapes HTML in user-supplied notes', () => {
    const msg = formatWebhookTelegram(parseWebhookPayload({ note: '<script>alert(1)</script>' }));
    expect(msg).toContain('&lt;script&gt;');
    expect(msg).not.toContain('<script>');
  });

  it('falls back to a compact raw dump when nothing is recognised', () => {
    const msg = formatWebhookTelegram(parseWebhookPayload({ foo: 'bar' }));
    expect(msg).toContain('foo');
  });
});
