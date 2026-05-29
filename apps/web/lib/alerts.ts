import { api } from './api';
import type {
  AlertDefinition,
  AlertEvent,
  Interval,
  MaCrossAlertConfig,
  PaperPortfolio,
  PaperSummary,
  PaperTrade,
  TelegramBot,
  TelegramConfig,
} from '@supercharts/types';

/* ────── Watchlists ────── */

export interface Watchlist {
  id: string;
  name: string;
  symbols: string[];
}

export async function fetchWatchlists(): Promise<Watchlist[]> {
  const r = await api<{ items: Watchlist[] }>('/watchlists');
  return r.items;
}

export async function createWatchlist(name: string): Promise<{ id: string }> {
  return api<{ id: string }>('/watchlists', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function updateWatchlist(id: string, patch: Partial<Pick<Watchlist, 'name' | 'symbols'>>): Promise<void> {
  await api(`/watchlists/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export async function deleteWatchlist(id: string): Promise<void> {
  await api(`/watchlists/${id}`, { method: 'DELETE' });
}

export interface AlertCreatePayload {
  symbol: string;
  interval: Interval;
  type: 'ma_cross';
  enabled: boolean;
  config: MaCrossAlertConfig;
}

export interface AlertUpdatePayload {
  symbol?: string;
  interval?: Interval;
  enabled?: boolean;
  config?: MaCrossAlertConfig;
}

export async function fetchAlerts(): Promise<AlertDefinition[]> {
  const r = await api<{ items: AlertDefinition[] }>('/alerts');
  return r.items;
}

export async function fetchAlertEvents(limit = 50): Promise<AlertEvent[]> {
  const r = await api<{ items: AlertEvent[] }>('/alerts/events', {
    searchParams: { limit: String(limit) },
  });
  return r.items;
}

export async function deleteAlertEvent(id: string): Promise<void> {
  await api(`/alerts/events/${id}`, { method: 'DELETE' });
}

export async function clearAlertEvents(alertId?: string): Promise<void> {
  await api('/alerts/events', {
    method: 'DELETE',
    searchParams: alertId ? { alertId } : undefined,
  });
}

/* ────── Backtest ────── */

export interface BacktestTrade {
  side: 'buy' | 'sell';
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  bars: number;
  pnlPercent: number;
  rsiAtEntry?: number;
}

export interface BacktestEquityPoint {
  time: number;
  equity: number;
  drawdown: number;
}

export interface BacktestSummary {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  finalEquity: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  sharpe: number;
  profitFactor: number;
  avgWinPct: number;
  avgLossPct: number;
  avgBars: number;
}

export interface BacktestResponse {
  alertId: string;
  symbol: string;
  interval: Interval;
  barsTested: number;
  first: number;
  last: number;
  trades: BacktestTrade[];
  equity: BacktestEquityPoint[];
  summary: BacktestSummary;
}

export async function runBacktest(id: string): Promise<BacktestResponse> {
  return api<BacktestResponse>(`/alerts/${id}/backtest`, {
    method: 'POST',
    body: '{}',
  });
}

/* ────── Optimizer ────── */

export interface OptimizerCombo {
  config: MaCrossAlertConfig;
  summary: BacktestSummary;
  score: number;
}

export interface OptimizeResponse {
  alertId: string;
  symbol: string;
  interval: Interval;
  barsTested: number;
  evaluated: number;
  qualifying: number;
  combos: OptimizerCombo[];
}

export async function runOptimize(
  id: string,
  body: {
    topN?: number;
    minTrades?: number;
    ddPenalty?: number;
  } = {},
): Promise<OptimizeResponse> {
  return api<OptimizeResponse>(`/alerts/${id}/optimize`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/* ────── Walk-forward ────── */

export interface WalkForwardWindow {
  trainStart: number;
  trainEnd: number;
  testStart: number;
  testEnd: number;
  trainCombos: number;
  trainScore: number;
  trainSummary: BacktestSummary;
  pickedConfig: MaCrossAlertConfig;
  testSummary: BacktestSummary;
}

export interface WalkForwardAggregate {
  windows: number;
  oosReturnPct: number;
  oosTrades: number;
  oosWinRate: number;
  oosMaxDrawdownPct: number;
  oosSharpe: number;
  meanTrainSharpe: number;
  robustness: number;
}

export interface WalkForwardResponse {
  alertId: string;
  symbol: string;
  interval: Interval;
  barsTested: number;
  windows: WalkForwardWindow[];
  aggregate: WalkForwardAggregate;
}

export async function runWalkForward(
  id: string,
  body: { trainBars?: number; testBars?: number; step?: number } = {},
): Promise<WalkForwardResponse> {
  return api<WalkForwardResponse>(`/alerts/${id}/walk-forward`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/* ────── Paper trading ────── */

export async function fetchPaperTrades(alertId: string, limit = 50): Promise<PaperTrade[]> {
  const r = await api<{ items: PaperTrade[] }>(`/alerts/${alertId}/paper-trades`, {
    searchParams: { limit: String(limit) },
  });
  return r.items;
}

export async function fetchPaperSummary(): Promise<PaperSummary[]> {
  const r = await api<{ items: PaperSummary[] }>('/alerts/paper/summary');
  return r.items;
}

export async function resetPaperTrades(alertId: string, wipe = false): Promise<void> {
  await api(`/alerts/${alertId}/paper/reset`, {
    method: 'POST',
    body: '{}',
    searchParams: wipe ? { wipe: '1' } : undefined,
  });
}

/** Portfolio-level paper aggregate — realised + unrealized across all alerts. */
export async function fetchPaperPortfolio(): Promise<PaperPortfolio> {
  return api<PaperPortfolio>('/alerts/paper/portfolio');
}

/* ────── Portfolio heat ────── */

export interface HeatCorrelatedPair {
  a: string;
  b: string;
  corr: number;
  /** true → positions amplify each other (stacked risk); false → they hedge. */
  stacked: boolean;
  n: number;
}

export interface HeatAssetClass {
  category: string;
  label: string;
  longs: number;
  shorts: number;
  count: number;
}

export interface HeatCurrency {
  currency: string;
  net: number;
  longs: number;
  shorts: number;
}

export interface PortfolioHeatResponse {
  empty: boolean;
  reason?: 'no_open_positions' | 'need_two_symbols';
  positions?: number;
  symbols?: string[];
  labels?: Record<string, string>;
  matrix?: (number | null)[][];
  pairs?: HeatCorrelatedPair[];
  assetClasses?: HeatAssetClass[];
  currencies?: HeatCurrency[];
  concentration?: number;
  concentrationLabel?: 'Low' | 'Moderate' | 'High';
  avgAbsCorr?: number;
  barsUsed?: Record<string, number>;
  lookback: number;
  interval: string;
  warnings?: string[];
  threshold?: number;
}

export async function fetchPortfolioHeat(params?: {
  symbols?: string;
  lookback?: number;
  interval?: string;
}): Promise<PortfolioHeatResponse> {
  const qs = new URLSearchParams();
  if (params?.symbols) qs.set('symbols', params.symbols);
  if (params?.lookback) qs.set('lookback', String(params.lookback));
  if (params?.interval) qs.set('interval', params.interval);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return api<PortfolioHeatResponse>(`/portfolio/heat${suffix}`);
}

/* ────── Position sizer ────── */

export type SizingMode = 'fixed_lots' | 'risk_percent' | 'cash_risk' | 'kelly' | 'atr_scaled';

export interface SizerRow {
  mode: SizingMode;
  lots: number;
  riskAmount: number;
  formula: string;
  unavailable?: string;
}

export interface SizerPreviewResponse {
  alertId: string;
  symbol: string;
  interval: Interval;
  backtest: { trades: number; winRate: number; avgWinPct: number; avgLossPct: number };
  atrValue: number;
  rows: SizerRow[];
}

export interface SizerPreviewBody {
  balance?: number;
  riskPercent?: number;
  riskAmount?: number;
  slPips?: number;
  pipValue?: number;
  fixedLots?: number;
  atrPeriod?: number;
  atrMultiplier?: number;
  kellyFraction?: number;
}

export async function runSizerPreview(
  alertId: string,
  body: SizerPreviewBody,
): Promise<SizerPreviewResponse> {
  return api<SizerPreviewResponse>(`/alerts/${alertId}/sizer-preview`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function createAlert(payload: AlertCreatePayload): Promise<AlertDefinition> {
  return api<AlertDefinition>('/alerts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateAlert(id: string, payload: AlertUpdatePayload): Promise<AlertDefinition> {
  return api<AlertDefinition>(`/alerts/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function toggleAlert(id: string): Promise<AlertDefinition> {
  // Send an explicit empty body — Fastify rejects `content-type: application/json`
  // POSTs with no body (FST_ERR_CTP_EMPTY_JSON_BODY).
  return api<AlertDefinition>(`/alerts/${id}/toggle`, { method: 'POST', body: '{}' });
}

export async function deleteAlert(id: string): Promise<void> {
  await api(`/alerts/${id}`, { method: 'DELETE' });
}

export interface BulkSubscribeResult {
  created: number;
  skipped: number;
  items: AlertDefinition[];
}

/**
 * Create the same MA-cross alert across every catalog symbol (or the optional subset)
 * at the given interval. Idempotent: existing alerts on (symbol, interval, ma_cross)
 * are skipped, never overwritten.
 */
export async function bulkSubscribeAlerts(payload: {
  interval: Interval;
  config: MaCrossAlertConfig;
  symbols?: string[];
}): Promise<BulkSubscribeResult> {
  return api<BulkSubscribeResult>('/alerts/bulk-subscribe', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchTelegramConfig(): Promise<TelegramConfig> {
  return api<TelegramConfig>('/alerts/telegram');
}

export async function saveTelegramConfig(payload: {
  botToken: string;
  chatId: string;
  enabled: boolean;
}): Promise<TelegramConfig> {
  return api<TelegramConfig>('/alerts/telegram', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteTelegramConfig(): Promise<void> {
  await api('/alerts/telegram', { method: 'DELETE' });
}

export async function sendTelegramTest(): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>('/alerts/telegram/test', { method: 'POST', body: '{}' });
}

/* ────── Multi-bot ────── */

export async function fetchTelegramBots(): Promise<TelegramBot[]> {
  const r = await api<{ items: TelegramBot[] }>('/alerts/telegram/bots');
  return r.items;
}

export async function createTelegramBot(payload: {
  label: string;
  botToken: string;
  chatId: string;
  enabled?: boolean;
}): Promise<TelegramBot> {
  return api<TelegramBot>('/alerts/telegram/bots', {
    method: 'POST',
    body: JSON.stringify({ enabled: true, ...payload }),
  });
}

export async function updateTelegramBot(
  id: string,
  patch: Partial<{ label: string; botToken: string; chatId: string; enabled: boolean }>,
): Promise<TelegramBot> {
  return api<TelegramBot>(`/alerts/telegram/bots/${id}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export async function deleteTelegramBot(id: string): Promise<void> {
  await api(`/alerts/telegram/bots/${id}`, { method: 'DELETE' });
}

export async function testTelegramBot(id: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/alerts/telegram/bots/${id}/test`, {
    method: 'POST',
    body: '{}',
  });
}

export async function discoverTelegramChatsForBot(botToken: string): Promise<DiscoveredChat[]> {
  const r = await api<{ chats: DiscoveredChat[] }>('/alerts/telegram/bots/discover-chat', {
    method: 'POST',
    body: JSON.stringify({ botToken }),
  });
  return r.chats;
}

export interface DiscoveredChat {
  chatId: string;
  type: string;
  title?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Ask the server to call Telegram's `getUpdates` and return the chats that have
 * messaged the bot. Pass a `botToken` when configuring for the first time; omit it
 * to re-detect using already-saved credentials.
 */
export async function discoverTelegramChats(botToken?: string): Promise<DiscoveredChat[]> {
  const r = await api<{ chats: DiscoveredChat[] }>('/alerts/telegram/discover-chat', {
    method: 'POST',
    body: JSON.stringify(botToken ? { botToken } : {}),
  });
  return r.chats;
}

export const TIMEZONE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'UTC', label: 'UTC' },
  { value: 'IST', label: 'IST (Asia/Kolkata)' },
  { value: 'America/New_York', label: 'EST/EDT (New York)' },
  { value: 'America/Chicago', label: 'CST/CDT (Chicago)' },
  { value: 'America/Los_Angeles', label: 'PST/PDT (Los Angeles)' },
  { value: 'Europe/London', label: 'GMT/BST (London)' },
  { value: 'Europe/Berlin', label: 'CET/CEST (Berlin)' },
  { value: 'Asia/Tokyo', label: 'JST (Tokyo)' },
  { value: 'Asia/Singapore', label: 'SGT (Singapore)' },
  { value: 'Australia/Sydney', label: 'AEST/AEDT (Sydney)' },
  { value: 'Asia/Dubai', label: 'GST (Dubai)' },
];

export const MA_TYPE_OPTIONS: Array<{ value: 'sma' | 'ema' | 'rma' | 'wma'; label: string }> = [
  { value: 'ema', label: 'EMA · Exponential' },
  { value: 'sma', label: 'SMA · Simple' },
  { value: 'wma', label: 'WMA · Weighted' },
  { value: 'rma', label: "RMA · Wilder's" },
];

export const MA_SOURCE_OPTIONS: Array<{
  value: 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4';
  label: string;
}> = [
  { value: 'close', label: 'Close' },
  { value: 'open', label: 'Open' },
  { value: 'high', label: 'High' },
  { value: 'low', label: 'Low' },
  { value: 'hl2', label: '(H + L) / 2' },
  { value: 'hlc3', label: '(H + L + C) / 3' },
  { value: 'ohlc4', label: '(O + H + L + C) / 4' },
];
