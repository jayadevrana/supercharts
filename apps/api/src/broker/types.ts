/**
 * BrokerGateway — the unified EXECUTION abstraction for BYOB trading (spec:
 * docs/superpowers/specs/2026-07-13-byob-broker-platform-design.md §3.1).
 *
 * Market DATA stays in packages/market-data providers (read-only by design);
 * everything that can place/modify/cancel an order lives behind this interface,
 * one adapter per broker. Kite (Zerodha) is the first adapter; OANDA is GW-8.
 */

export type BrokerId = 'kite' | 'oanda';

export interface AccountMeta {
  accountId: string;
  name: string;
  email?: string;
  broker: BrokerId;
}

export interface OrderIntent {
  /** Broker trading symbol, e.g. 'RELIANCE' (not the SuperCharts canonical id). */
  symbol: string;
  /** 'NSE' | 'BSE' | 'NFO' | 'MCX' … */
  exchange: string;
  side: 'buy' | 'sell';
  quantity: number;
  orderType: 'market' | 'limit' | 'sl' | 'sl-m';
  product: 'mis' | 'cnc' | 'nrml';
  /** Required for limit / sl. */
  price?: number;
  /** Required for sl / sl-m. */
  triggerPrice?: number;
  variety?: 'regular' | 'amo';
  validity?: 'day' | 'ioc';
}

export interface BrokerOrderRef {
  brokerOrderId: string;
}

export interface BrokerOrder {
  brokerOrderId: string;
  symbol: string;
  exchange: string;
  side: 'buy' | 'sell';
  quantity: number;
  filledQuantity: number;
  orderType: string;
  product: string;
  price: number | null;
  triggerPrice: number | null;
  /** Broker-native status string, passed through honestly (e.g. Kite 'OPEN'/'COMPLETE'). */
  status: string;
  statusMessage: string | null;
  placedAt: string;
  variety: string;
}

export interface BrokerPosition {
  symbol: string;
  exchange: string;
  product: string;
  /** Signed: positive long, negative short. */
  quantity: number;
  averagePrice: number;
  lastPrice: number;
  pnl: number;
}

export interface BrokerGateway {
  broker: BrokerId;
  validate(): Promise<AccountMeta>;
  placeOrder(intent: OrderIntent): Promise<BrokerOrderRef>;
  modifyOrder(
    brokerOrderId: string,
    changes: Partial<Pick<OrderIntent, 'quantity' | 'price' | 'triggerPrice' | 'orderType'>>,
    variety?: string,
  ): Promise<BrokerOrderRef>;
  cancelOrder(brokerOrderId: string, variety?: string): Promise<void>;
  getOrders(): Promise<BrokerOrder[]>;
  getPositions(): Promise<BrokerPosition[]>;
  exitPosition(position: BrokerPosition): Promise<BrokerOrderRef>;
}
