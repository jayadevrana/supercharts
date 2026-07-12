import { describe, expect, it } from 'vitest';
import { KiteProvider } from '../packages/market-data/src/providers/kite';

const CSV = [
  'instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange',
  '256265,1001,NIFTY 50,NIFTY 50,0,,0,0.05,1,EQ,INDICES,NSE',
  '738561,2885,RELIANCE,RELIANCE INDUSTRIES,0,,0,0.05,1,EQ,NSE,NSE',
].join('\n');

function stubFetch() {
  const calls: Array<{ url: string; auth: string }> = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, auth: String((init?.headers as Record<string, string>)?.Authorization ?? '') });
    if (url.includes('/instruments')) return new Response(CSV, { status: 200 });
    return new Response(JSON.stringify({ status: 'error', message: 'no stub' }), { status: 404 });
  }) as typeof fetch;
  return { fn, calls };
}

describe('KiteProvider.setCredentials (daily token hot-swap)', () => {
  it('starts not_configured without creds, connects after setCredentials, uses the new auth header', async () => {
    const { fn, calls } = stubFetch();
    const provider = new KiteProvider({ apiKey: '', accessToken: '', fetchFn: fn });
    await provider.connect();
    expect(provider.health().status).toBe('not_configured');

    await provider.setCredentials('newkey', 'newtoken');
    expect(provider.health().status).toBe('connected');
    expect(calls.some((c) => c.url.includes('/instruments') && c.auth === 'token newkey:newtoken')).toBe(true);

    // The catalog materialised → NIFTY search works (the exact owner symptom this fixes).
    const hits = await provider.searchSymbols('nifty', 10);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.id).toBe('KITE:NSE:NIFTY_50');
  });
});
