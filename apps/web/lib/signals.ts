import type { Interval, SignalRecipe } from '@supercharts/types';
import { api } from './api';

export type MaType = 'sma' | 'ema' | 'rma' | 'wma';
export type MaSource = 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4';

export interface SignalBulkPayload {
  accountId: string;
  interval: Interval;
  symbols?: string[];
  ma: { type: MaType; length: number; source: MaSource };
  sides: Array<'buy' | 'sell'>;
  sizing:
    | { mode: 'fixed_lots'; lots: number }
    | { mode: 'risk_percent'; percent: number; slPips: number }
    | { mode: 'cash_risk'; amount: number; slPips: number };
  sl?: { price?: number; pips?: number };
  tp?: { price?: number; pips?: number };
  maxOpen?: number;
  cooldownSec?: number;
  maxTradesPerDay?: number;
}

export interface SignalBulkResult {
  created: number;
  skipped: number;
  items: SignalRecipe[];
}

export async function fetchSignals(): Promise<SignalRecipe[]> {
  const r = await api<{ items: SignalRecipe[] }>('/signals');
  return r.items;
}

export async function deleteSignal(id: string): Promise<void> {
  await api(`/signals/${id}`, { method: 'DELETE' });
}

export async function bulkSubscribeSignals(payload: SignalBulkPayload): Promise<SignalBulkResult> {
  return api<SignalBulkResult>('/signals/bulk-subscribe', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
