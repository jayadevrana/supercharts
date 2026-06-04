import { describe, it, expect } from 'vitest';
import { sanitizeStrategyForShare } from '../apps/api/src/strategy-share';
import type { SignalRecipe } from '@supercharts/types';

const fullRecipe: SignalRecipe = {
  id: 'rec_1',
  userId: 'user_secret_123',
  accountId: 'mt5-acct-999',
  name: 'EMA 9/21 Momentum',
  symbol: 'BINANCE:BTCUSDT',
  interval: '1h',
  enabled: true,
  logic: 'all',
  conditions: [
    { type: 'indicator_compare', indicator: 'ema_fast', channel: 'value', operator: 'crosses_above', right: { kind: 'indicator', indicator: 'ema_slow', channel: 'value' } },
  ],
  actions: [
    {
      type: 'open_position',
      side: 'buy',
      kind: 'market',
      sizing: { mode: 'risk_percent', percent: 1, slPips: 150 },
      sl: { pips: 150 },
      tp: { pips: 300 },
      filter: { recipeId: 'rec_1', side: 'buy' },
    },
  ],
  indicatorSpecs: [
    { id: 'ema_fast', type: 'ema', name: 'EMA 9', paneId: 'price', inputs: { length: 9 }, style: {}, visible: true, locked: false },
  ],
  maxTradesPerDay: 5,
  maxDailyDrawdownPercent: 4,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
};

describe('sanitizeStrategyForShare', () => {
  it('keeps the strategy-describing fields', () => {
    const s = sanitizeStrategyForShare(fullRecipe);
    expect(s.name).toBe('EMA 9/21 Momentum');
    expect(s.symbol).toBe('BINANCE:BTCUSDT');
    expect(s.interval).toBe('1h');
    expect(s.logic).toBe('all');
    expect(s.conditions).toHaveLength(1);
    expect(s.actions).toHaveLength(1);
    expect(s.indicatorSpecs[0].inputs.length).toBe(9);
    expect(s.maxTradesPerDay).toBe(5);
    expect(s.maxDailyDrawdownPercent).toBe(4);
  });

  it('never leaks owner / account / internal identifiers', () => {
    const s = sanitizeStrategyForShare(fullRecipe);
    const json = JSON.stringify(s);
    expect(json).not.toContain('user_secret_123');
    expect(json).not.toContain('mt5-acct-999');
    expect(s).not.toHaveProperty('userId');
    expect(s).not.toHaveProperty('accountId');
    expect(s).not.toHaveProperty('id');
    expect(s).not.toHaveProperty('enabled');
  });

  it('strips the internal recipeId from action filters', () => {
    const s = sanitizeStrategyForShare(fullRecipe);
    const action = s.actions[0] as { filter?: Record<string, unknown> };
    expect(action.filter).toBeDefined();
    expect(action.filter).not.toHaveProperty('recipeId');
    expect(action.filter?.side).toBe('buy'); // non-identifying filter fields stay
  });

  it('defaults missing optional collections without throwing', () => {
    const minimal = { name: 'Bare', symbol: 'X', interval: '5m', logic: 'any' as const, conditions: [], actions: [] };
    const s = sanitizeStrategyForShare(minimal);
    expect(s.conditions).toEqual([]);
    expect(s.actions).toEqual([]);
    expect(s.indicatorSpecs).toEqual([]);
    expect(s.maxTradesPerDay).toBeUndefined();
  });
});
