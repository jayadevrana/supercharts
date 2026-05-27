/**
 * MT5 EA <-> backend wire protocol.
 *
 * The MQL5 EA opens a single WebSocket connection to `/mt5` carrying a JWT-like
 * token. The connection then carries two streams in both directions:
 *
 *   EA -> backend:  AccountSnapshot, PositionsSnapshot, Tick, OrderResult, Heartbeat
 *   backend -> EA:  OpenOrder, ModifyOrder, ClosePosition, PartialClose, MoveSL,
 *                   CancelOrder, SetTrailing, SetBreakEven, RequestSnapshot
 *
 * The EA polls OnTick + an OnTimer hook to flush queued outgoing messages and
 * drain incoming server commands. All numeric prices are doubles, lots are
 * MetaTrader lot units (1.0 = 100,000 base for most forex pairs), volumes are
 * normalized for symbol step at the EA side before order placement.
 */

export type MT5OrderSide = 'buy' | 'sell';
export type MT5OrderKind = 'market' | 'limit' | 'stop' | 'stop_limit';
export type MT5TimeInForce = 'gtc' | 'day' | 'ioc' | 'fok' | 'specified';
export type MT5PositionState = 'open' | 'closed' | 'partial';
export type MT5OrderState =
  | 'pending'
  | 'accepted'
  | 'filled'
  | 'partially_filled'
  | 'cancelled'
  | 'rejected'
  | 'expired';

export interface MT5AccountSummary {
  /** Server-side stable account id (login@broker). */
  id: string;
  /** Numeric MT5 login. */
  login: number;
  broker: string;
  server: string;
  currency: string;
  /** Account-level details. */
  name: string;
  leverage: number;
  /** Trade mode. */
  tradeMode: 'demo' | 'real' | 'contest';
  /** Last sync UNIX ms UTC. */
  updatedAt: number;
}

export interface MT5AccountSnapshot {
  account: MT5AccountSummary;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  profit: number;
  /** UNIX ms UTC of server time the EA reported. */
  serverTime: number;
}

export interface MT5SymbolInfo {
  /** Canonical id: `MT5:<broker>:<symbol>` (e.g. `MT5:ICMarkets:EURUSD`). */
  id: string;
  /** Broker raw symbol code, e.g. `EURUSD`, `XAUUSD`, `EURUSD.r`. */
  raw: string;
  description: string;
  digits: number;
  point: number;
  tickValue: number;
  tickSize: number;
  contractSize: number;
  volumeMin: number;
  volumeMax: number;
  volumeStep: number;
  marginInitial: number;
  swapLong: number;
  swapShort: number;
  /** Base currency of the pair, e.g. `EUR`. */
  baseCurrency: string;
  /** Quote currency of the pair, e.g. `USD`. */
  quoteCurrency: string;
  /** Optional broker-specific stop level in points (broker enforced). */
  stopsLevel: number;
}

export interface MT5Tick {
  accountId: string;
  symbol: string;
  bid: number;
  ask: number;
  /** Last traded price (broker may not provide; falls back to mid). */
  last: number;
  /** Tick volume. */
  volume: number;
  /** UNIX ms UTC of the broker timestamp. */
  time: number;
  /** UNIX ms UTC of EA local receive time. */
  receivedAt: number;
  /** Spread in points (10 ** digits). */
  spreadPoints: number;
}

export interface MT5Position {
  /** MT5 ticket id (deal id when closed, position id while open). */
  id: string;
  accountId: string;
  symbol: string;
  side: MT5OrderSide;
  /** Volume in lots remaining. */
  volume: number;
  /** Original entry volume in lots. */
  initialVolume: number;
  openPrice: number;
  /** Current SL price or 0 when not set. */
  sl: number;
  /** Current TP price or 0 when not set. */
  tp: number;
  /** Realized P&L on the position currency (broker quote currency, usually USD). */
  profit: number;
  swap: number;
  commission: number;
  /** UNIX ms UTC. */
  openedAt: number;
  /** UNIX ms UTC if closed, else 0. */
  closedAt: number;
  comment: string;
  /** Magic number written by the EA to tag SuperCharts trades. */
  magic: number;
  /** EA tag this trade belongs to (e.g. a signal recipe id). */
  recipeId?: string;
  /** Optional MT5 group label set by EA. */
  group?: string;
  state: MT5PositionState;
}

export interface MT5PendingOrder {
  id: string;
  accountId: string;
  symbol: string;
  side: MT5OrderSide;
  kind: Exclude<MT5OrderKind, 'market'>;
  /** Volume in lots. */
  volume: number;
  /** Price the entry is waiting at. */
  price: number;
  /** Stop trigger for stop_limit kind. */
  stopLimitPrice?: number;
  sl: number;
  tp: number;
  tif: MT5TimeInForce;
  /** UNIX ms UTC. Zero if not expiring. */
  expiresAt: number;
  placedAt: number;
  comment: string;
  magic: number;
  state: MT5OrderState;
}

export interface MT5OrderResult {
  /** Client id this result is for (sent on OpenOrder/ModifyOrder/etc). */
  clientId: string;
  accountId: string;
  state: MT5OrderState;
  ticket?: string;
  filledVolume?: number;
  filledPrice?: number;
  retcode: number;
  retcodeText: string;
  comment: string;
  /** Net new position (when an order opens or modifies one). */
  position?: MT5Position;
  /** Net new pending order (limit/stop). */
  order?: MT5PendingOrder;
  /** Closing fills. */
  closedDeals?: MT5ClosedDeal[];
  serverTime: number;
}

export interface MT5ClosedDeal {
  ticket: string;
  positionId: string;
  symbol: string;
  side: MT5OrderSide;
  volume: number;
  price: number;
  profit: number;
  commission: number;
  swap: number;
  closedAt: number;
}

/* ===== Commands sent backend -> EA ===== */

export interface MT5OpenOrderCommand {
  type: 'mt5_open';
  clientId: string;
  symbol: string;
  side: MT5OrderSide;
  kind: MT5OrderKind;
  /** Volume in lots, will be normalized to symbol step at EA. */
  volume: number;
  /** Required for limit/stop kinds. */
  price?: number;
  /** Required when kind === 'stop_limit'. */
  stopLimitPrice?: number;
  sl?: number;
  tp?: number;
  tif?: MT5TimeInForce;
  /** UNIX ms UTC expiry; ignored unless tif === 'specified'. */
  expiresAt?: number;
  /** Slippage tolerance in points for market orders. */
  deviationPoints?: number;
  comment?: string;
  magic?: number;
  /** Tag this trade to a signal recipe so the backend can group them. */
  recipeId?: string;
}

export interface MT5ClosePositionCommand {
  type: 'mt5_close';
  clientId: string;
  positionId: string;
  /** Optional fraction (0..1] or explicit volume; if both omitted closes full. */
  fraction?: number;
  volume?: number;
  deviationPoints?: number;
  comment?: string;
}

export interface MT5ModifyOrderCommand {
  type: 'mt5_modify';
  clientId: string;
  /** Either positionId (modify SL/TP of an open trade) or pendingOrderId. */
  positionId?: string;
  pendingOrderId?: string;
  sl?: number;
  tp?: number;
  /** For pending orders, change the resting price. */
  price?: number;
  stopLimitPrice?: number;
  /** UNIX ms UTC expiry. */
  expiresAt?: number;
}

export interface MT5CancelOrderCommand {
  type: 'mt5_cancel';
  clientId: string;
  pendingOrderId: string;
}

export interface MT5SetTrailingCommand {
  type: 'mt5_trailing';
  clientId: string;
  positionId: string;
  /** Trail distance in pips. */
  distancePips: number;
  /** Start trailing after this many pips of profit. */
  activationPips?: number;
  /** Trail step in pips. */
  stepPips?: number;
}

export interface MT5SetBreakEvenCommand {
  type: 'mt5_breakeven';
  clientId: string;
  positionId: string;
  /** Trigger when price reaches entry +/- this many pips. */
  triggerPips: number;
  /** Optional offset in pips above entry. Default 0. */
  offsetPips?: number;
}

export interface MT5RequestSnapshotCommand {
  type: 'mt5_request_snapshot';
  clientId: string;
}

export interface MT5SubscribeSymbolsCommand {
  type: 'mt5_subscribe_symbols';
  clientId: string;
  symbols: string[];
}

export interface MT5UnsubscribeSymbolsCommand {
  type: 'mt5_unsubscribe_symbols';
  clientId: string;
  symbols: string[];
}

export type MT5ServerToEAMessage =
  | MT5OpenOrderCommand
  | MT5ClosePositionCommand
  | MT5ModifyOrderCommand
  | MT5CancelOrderCommand
  | MT5SetTrailingCommand
  | MT5SetBreakEvenCommand
  | MT5RequestSnapshotCommand
  | MT5SubscribeSymbolsCommand
  | MT5UnsubscribeSymbolsCommand;

/* ===== Messages EA -> backend ===== */

export interface MT5HelloMessage {
  type: 'mt5_hello';
  /** EA build id (semver-ish). */
  eaVersion: string;
  account: MT5AccountSummary;
  /** Symbols the EA has access to and basic specs. */
  symbols: MT5SymbolInfo[];
}

export interface MT5AccountSnapshotMessage {
  type: 'mt5_account_snapshot';
  snapshot: MT5AccountSnapshot;
}

export interface MT5PositionsSnapshotMessage {
  type: 'mt5_positions_snapshot';
  accountId: string;
  positions: MT5Position[];
  pending: MT5PendingOrder[];
}

export interface MT5TickMessage {
  type: 'mt5_tick';
  tick: MT5Tick;
}

export interface MT5OrderResultMessage {
  type: 'mt5_order_result';
  result: MT5OrderResult;
}

export interface MT5HeartbeatMessage {
  type: 'mt5_heartbeat';
  accountId: string;
  serverTime: number;
}

export interface MT5LogMessage {
  type: 'mt5_log';
  accountId: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, unknown>;
}

export type MT5EAToServerMessage =
  | MT5HelloMessage
  | MT5AccountSnapshotMessage
  | MT5PositionsSnapshotMessage
  | MT5TickMessage
  | MT5OrderResultMessage
  | MT5HeartbeatMessage
  | MT5LogMessage;
