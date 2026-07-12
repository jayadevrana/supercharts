import { describe, expect, it } from 'vitest';
import { KiteGateway } from '../apps/api/src/broker/kite-gateway';

function stubFetch(routes: Record<string, { status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) return new Response(JSON.stringify({ status: 'error', message: 'no stub' }), { status: 404 });
    return new Response(JSON.stringify(hit[1].body), { status: hit[1].status ?? 200 });
  }) as typeof fetch;
  return { fn, calls };
}

describe('KiteGateway reads', () => {
  it('validate() maps /user/profile and sends the Kite auth header', async () => {
    const { fn, calls } = stubFetch({
      '/user/profile': { body: { status: 'success', data: { user_id: 'AB1234', user_name: 'Test Trader', email: 't@x.com' } } },
    });
    const gw = new KiteGateway({ apiKey: 'key1', accessToken: 'tok1', fetchFn: fn });
    const meta = await gw.validate();
    expect(meta).toEqual({ accountId: 'AB1234', name: 'Test Trader', email: 't@x.com', broker: 'kite' });
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe('token key1:tok1');
    expect(headers['X-Kite-Version']).toBe('3');
  });

  it('surfaces Kite errors verbatim (never swallowed)', async () => {
    const { fn } = stubFetch({
      '/user/profile': { status: 403, body: { status: 'error', message: 'Incorrect `api_key` or `access_token`.', error_type: 'TokenException' } },
    });
    const gw = new KiteGateway({ apiKey: 'k', accessToken: 'bad', fetchFn: fn });
    await expect(gw.validate()).rejects.toThrow('TokenException: Incorrect `api_key` or `access_token`.');
  });

  it('getPositions maps data.net with signed quantities', async () => {
    const { fn } = stubFetch({
      '/portfolio/positions': { body: { status: 'success', data: { net: [
        { tradingsymbol: 'RELIANCE', exchange: 'NSE', product: 'MIS', quantity: 5, average_price: 2900.5, last_price: 2910, pnl: 47.5 },
        { tradingsymbol: 'INFY', exchange: 'NSE', product: 'MIS', quantity: -10, average_price: 1500, last_price: 1495, pnl: 50 },
      ] } } },
    });
    const gw = new KiteGateway({ apiKey: 'k', accessToken: 't', fetchFn: fn });
    const pos = await gw.getPositions();
    expect(pos).toHaveLength(2);
    expect(pos[0]).toEqual({ symbol: 'RELIANCE', exchange: 'NSE', product: 'MIS', quantity: 5, averagePrice: 2900.5, lastPrice: 2910, pnl: 47.5 });
    expect(pos[1]!.quantity).toBe(-10);
  });

  it('getOrders maps the broker-native status through honestly', async () => {
    const { fn } = stubFetch({
      '/orders': { body: { status: 'success', data: [
        { order_id: '151220000000000', tradingsymbol: 'SBIN', exchange: 'NSE', transaction_type: 'BUY', quantity: 1,
          filled_quantity: 0, order_type: 'LIMIT', product: 'MIS', price: 700, trigger_price: 0,
          status: 'OPEN', status_message: null, order_timestamp: '2026-07-13 10:00:00', variety: 'regular' },
      ] } },
    });
    const gw = new KiteGateway({ apiKey: 'k', accessToken: 't', fetchFn: fn });
    const orders = await gw.getOrders();
    expect(orders[0]).toMatchObject({ brokerOrderId: '151220000000000', symbol: 'SBIN', side: 'buy', status: 'OPEN', price: 700 });
  });

  it('exchangeRequestToken posts the sha256 checksum form-encoded', async () => {
    const { fn, calls } = stubFetch({
      '/session/token': { body: { status: 'success', data: { access_token: 'newtok', user_id: 'AB1234', user_name: 'Test Trader' } } },
    });
    const out = await KiteGateway.exchangeRequestToken('key1', 'sec1', 'req1', fn);
    expect(out.accessToken).toBe('newtok');
    expect(out.meta.accountId).toBe('AB1234');
    const body = String(calls[0]!.init!.body);
    expect(body).toContain('api_key=key1');
    expect(body).toContain('request_token=req1');
    expect(body).toMatch(/checksum=[0-9a-f]{64}/);
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers['content-type']).toContain('application/x-www-form-urlencoded');
  });
});

describe('KiteGateway writes', () => {
  it('placeOrder posts form-encoded fields to /orders/regular', async () => {
    const { fn, calls } = stubFetch({ '/orders/regular': { body: { status: 'success', data: { order_id: 'OID1' } } } });
    const gw = new KiteGateway({ apiKey: 'k', accessToken: 't', fetchFn: fn });
    const ref = await gw.placeOrder({ symbol: 'SBIN', exchange: 'NSE', side: 'buy', quantity: 1, orderType: 'limit', product: 'mis', price: 700 });
    expect(ref.brokerOrderId).toBe('OID1');
    const body = String(calls[0]!.init!.body);
    expect(body).toContain('tradingsymbol=SBIN');
    expect(body).toContain('transaction_type=BUY');
    expect(body).toContain('order_type=LIMIT');
    expect(body).toContain('product=MIS');
    expect(body).toContain('price=700');
    expect(calls[0]!.init!.method).toBe('POST');
  });

  it('placeOrder routes AMO variety to /orders/amo', async () => {
    const { fn, calls } = stubFetch({ '/orders/amo': { body: { status: 'success', data: { order_id: 'OID2' } } } });
    const gw = new KiteGateway({ apiKey: 'k', accessToken: 't', fetchFn: fn });
    await gw.placeOrder({ symbol: 'SBIN', exchange: 'NSE', side: 'buy', quantity: 1, orderType: 'limit', product: 'cnc', price: 500, variety: 'amo' });
    expect(calls[0]!.url).toContain('/orders/amo');
  });

  it('modifyOrder PUTs only the changed fields; cancelOrder DELETEs', async () => {
    const { fn, calls } = stubFetch({ '/orders/regular/OID1': { body: { status: 'success', data: { order_id: 'OID1' } } } });
    const gw = new KiteGateway({ apiKey: 'k', accessToken: 't', fetchFn: fn });
    await gw.modifyOrder('OID1', { price: 710 });
    expect(calls[0]!.init!.method).toBe('PUT');
    expect(String(calls[0]!.init!.body)).toBe('price=710');
    await gw.cancelOrder('OID1');
    expect(calls[1]!.init!.method).toBe('DELETE');
  });

  it('exitPosition flips side and uses market order; rejects flat positions', async () => {
    const { fn, calls } = stubFetch({ '/orders/regular': { body: { status: 'success', data: { order_id: 'OID3' } } } });
    const gw = new KiteGateway({ apiKey: 'k', accessToken: 't', fetchFn: fn });
    await gw.exitPosition({ symbol: 'INFY', exchange: 'NSE', product: 'MIS', quantity: -10, averagePrice: 0, lastPrice: 0, pnl: 0 });
    const body = String(calls[0]!.init!.body);
    expect(body).toContain('transaction_type=BUY');
    expect(body).toContain('quantity=10');
    expect(body).toContain('order_type=MARKET');
    await expect(gw.exitPosition({ symbol: 'X', exchange: 'NSE', product: 'MIS', quantity: 0, averagePrice: 0, lastPrice: 0, pnl: 0 }))
      .rejects.toThrow('position_already_flat');
  });
});
