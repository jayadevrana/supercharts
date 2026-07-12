import { describe, expect, it } from 'vitest';
import { buildKiteLoginUrl } from '../apps/api/src/routes/broker';

describe('broker route helpers', () => {
  it('builds the Kite login URL with the api key encoded', () => {
    expect(buildKiteLoginUrl('abc123')).toBe('https://kite.zerodha.com/connect/login?v=3&api_key=abc123');
    expect(buildKiteLoginUrl('k+y/=')).toBe(`https://kite.zerodha.com/connect/login?v=3&api_key=${encodeURIComponent('k+y/=')}`);
  });
});
