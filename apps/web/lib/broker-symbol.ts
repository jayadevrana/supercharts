/**
 * Parse a SuperCharts KITE symbol id into the broker exchange + trading symbol an order needs.
 *
 * Chart ids are `KITE:<EXCHANGE>:<PART>` where PART is the canonicalised trading symbol
 * (uppercased, whitespace → `_` — see the kite provider's `canonicalPart`). We reverse the
 * whitespace substitution so the broker receives the real `tradingsymbol` (e.g. `NIFTY 50`).
 * Non-KITE ids (Binance/OANDA/custom) return null — those route through the MT5 panel instead.
 */
export interface BrokerSymbolRef {
  broker: 'kite';
  exchange: string;
  tradingSymbol: string;
}

export function parseBrokerSymbol(symbolId: string): BrokerSymbolRef | null {
  if (!symbolId.startsWith('KITE:')) return null;
  const [, exchange, ...rest] = symbolId.split(':');
  const part = rest.join(':');
  if (!exchange || !part) return null;
  return { broker: 'kite', exchange, tradingSymbol: part.replace(/_/g, ' ') };
}
