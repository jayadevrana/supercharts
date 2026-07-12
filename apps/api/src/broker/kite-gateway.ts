import { createHash } from 'node:crypto';
import type {
  AccountMeta, BrokerGateway, BrokerOrder, BrokerOrderRef, BrokerPosition, OrderIntent,
} from './types';

const KITE_REST = 'https://api.kite.trade';

/**
 * Zerodha Kite Connect v3 EXECUTION adapter — the deliberate, separate order path.
 * (The market-data provider in packages/market-data stays read-only by design.)
 * Bodies are form-encoded; responses are { status, data } envelopes; errors are
 * surfaced verbatim as `${error_type}: ${message}` so the UI can show the truth.
 */
export interface KiteGatewayOptions {
  apiKey: string;
  accessToken: string;
  fetchFn?: typeof fetch;
  restEndpoint?: string;
  /** undici ProxyAgent for the egress-IP write plane (GW-5); reads never set it. */
  proxyDispatcher?: unknown;
}

interface KiteEnvelope<T> {
  status: 'success' | 'error';
  data?: T;
  message?: string;
  error_type?: string;
}

export class KiteGateway implements BrokerGateway {
  public readonly broker = 'kite' as const;
  private readonly fetchFn: typeof fetch;
  private readonly rest: string;

  constructor(private readonly opts: KiteGatewayOptions) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.rest = opts.restEndpoint ?? KITE_REST;
  }

  static async exchangeRequestToken(
    apiKey: string,
    apiSecret: string,
    requestToken: string,
    fetchFn: typeof fetch = fetch,
  ): Promise<{ accessToken: string; meta: AccountMeta }> {
    const checksum = createHash('sha256').update(apiKey + requestToken + apiSecret).digest('hex');
    const res = await fetchFn(`${KITE_REST}/session/token`, {
      method: 'POST',
      headers: { 'X-Kite-Version': '3', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ api_key: apiKey, request_token: requestToken, checksum }).toString(),
    });
    const json = (await res.json()) as KiteEnvelope<{
      access_token: string; user_id: string; user_name?: string; email?: string;
    }>;
    if (json.status !== 'success' || !json.data) throw kiteError(json);
    return {
      accessToken: json.data.access_token,
      meta: {
        accountId: json.data.user_id,
        name: json.data.user_name ?? json.data.user_id,
        email: json.data.email,
        broker: 'kite',
      },
    };
  }

  async validate(): Promise<AccountMeta> {
    const data = await this.request<{ user_id: string; user_name?: string; email?: string }>('GET', '/user/profile');
    return { accountId: data.user_id, name: data.user_name ?? data.user_id, email: data.email, broker: 'kite' };
  }

  async placeOrder(intent: OrderIntent): Promise<BrokerOrderRef> {
    const variety = intent.variety ?? 'regular';
    const body: Record<string, string> = {
      tradingsymbol: intent.symbol,
      exchange: intent.exchange,
      transaction_type: intent.side.toUpperCase(),
      quantity: String(intent.quantity),
      order_type: intent.orderType.toUpperCase(),
      product: intent.product.toUpperCase(),
      validity: (intent.validity ?? 'day').toUpperCase(),
    };
    if (intent.price !== undefined) body.price = String(intent.price);
    if (intent.triggerPrice !== undefined) body.trigger_price = String(intent.triggerPrice);
    const data = await this.request<{ order_id: string }>('POST', `/orders/${variety}`, body);
    return { brokerOrderId: data.order_id };
  }

  async modifyOrder(
    brokerOrderId: string,
    changes: Partial<Pick<OrderIntent, 'quantity' | 'price' | 'triggerPrice' | 'orderType'>>,
    variety = 'regular',
  ): Promise<BrokerOrderRef> {
    const body: Record<string, string> = {};
    if (changes.quantity !== undefined) body.quantity = String(changes.quantity);
    if (changes.price !== undefined) body.price = String(changes.price);
    if (changes.triggerPrice !== undefined) body.trigger_price = String(changes.triggerPrice);
    if (changes.orderType !== undefined) body.order_type = changes.orderType.toUpperCase();
    const data = await this.request<{ order_id: string }>('PUT', `/orders/${variety}/${brokerOrderId}`, body);
    return { brokerOrderId: data.order_id };
  }

  async cancelOrder(brokerOrderId: string, variety = 'regular'): Promise<void> {
    await this.request<{ order_id: string }>('DELETE', `/orders/${variety}/${brokerOrderId}`);
  }

  async getOrders(): Promise<BrokerOrder[]> {
    const data = await this.request<Array<Record<string, unknown>>>('GET', '/orders');
    return (data ?? []).map((o) => ({
      brokerOrderId: String(o.order_id),
      symbol: String(o.tradingsymbol),
      exchange: String(o.exchange),
      side: String(o.transaction_type).toLowerCase() === 'sell' ? ('sell' as const) : ('buy' as const),
      quantity: Number(o.quantity) || 0,
      filledQuantity: Number(o.filled_quantity) || 0,
      orderType: String(o.order_type),
      product: String(o.product),
      price: o.price == null ? null : Number(o.price),
      triggerPrice: o.trigger_price == null ? null : Number(o.trigger_price),
      status: String(o.status),
      statusMessage: o.status_message == null ? null : String(o.status_message),
      placedAt: String(o.order_timestamp ?? ''),
      variety: String(o.variety ?? 'regular'),
    }));
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const data = await this.request<{ net?: Array<Record<string, unknown>> }>('GET', '/portfolio/positions');
    return (data.net ?? []).map((p) => ({
      symbol: String(p.tradingsymbol),
      exchange: String(p.exchange),
      product: String(p.product),
      quantity: Number(p.quantity) || 0,
      averagePrice: Number(p.average_price) || 0,
      lastPrice: Number(p.last_price) || 0,
      pnl: Number(p.pnl) || 0,
    }));
  }

  async exitPosition(position: BrokerPosition): Promise<BrokerOrderRef> {
    if (position.quantity === 0) throw new Error('position_already_flat');
    return this.placeOrder({
      symbol: position.symbol,
      exchange: position.exchange,
      side: position.quantity > 0 ? 'sell' : 'buy',
      quantity: Math.abs(position.quantity),
      orderType: 'market',
      product: position.product.toLowerCase() as OrderIntent['product'],
    });
  }

  private async request<T>(method: string, path: string, body?: Record<string, string>): Promise<T> {
    const init: RequestInit = {
      method,
      headers: {
        'X-Kite-Version': '3',
        Authorization: `token ${this.opts.apiKey}:${this.opts.accessToken}`,
        ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(body ? { body: new URLSearchParams(body).toString() } : {}),
    };
    if (this.opts.proxyDispatcher) (init as Record<string, unknown>).dispatcher = this.opts.proxyDispatcher;
    const res = await this.fetchFn(`${this.rest}${path}`, init);
    const json = (await res.json()) as KiteEnvelope<T>;
    if (json.status !== 'success') throw kiteError(json);
    return json.data as T;
  }
}

function kiteError(json: { message?: string; error_type?: string }): Error {
  return new Error(`${json.error_type ?? 'KiteError'}: ${json.message ?? 'unknown error'}`);
}
