import { describe, it, expect } from 'vitest';
import { normalizeChannelId, MAX_BROADCAST_LEN } from '../apps/api/src/telegram-broadcast';

describe('normalizeChannelId', () => {
  it('prefixes a bare username with @', () => {
    expect(normalizeChannelId('mychannel')).toBe('@mychannel');
  });
  it('keeps an already-@ handle', () => {
    expect(normalizeChannelId('@mychannel')).toBe('@mychannel');
    expect(normalizeChannelId('@@mychannel')).toBe('@mychannel');
  });
  it('extracts the handle from t.me links (with and without scheme / preview path)', () => {
    expect(normalizeChannelId('https://t.me/mychannel')).toBe('@mychannel');
    expect(normalizeChannelId('t.me/mychannel')).toBe('@mychannel');
    expect(normalizeChannelId('https://t.me/s/mychannel')).toBe('@mychannel');
    expect(normalizeChannelId('https://t.me/@mychannel')).toBe('@mychannel');
  });
  it('passes a numeric channel id through unchanged', () => {
    expect(normalizeChannelId('-1001234567890')).toBe('-1001234567890');
    expect(normalizeChannelId('123456')).toBe('123456');
  });
  it('trims whitespace and handles blanks', () => {
    expect(normalizeChannelId('  @chan  ')).toBe('@chan');
    expect(normalizeChannelId('')).toBe('');
    expect(normalizeChannelId('   ')).toBe('');
  });
  it('exposes the Telegram message limit', () => {
    expect(MAX_BROADCAST_LEN).toBe(4096);
  });
});
