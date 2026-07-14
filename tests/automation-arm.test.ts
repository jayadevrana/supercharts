import { describe, expect, it } from 'vitest';
import {
  defaultArmForm,
  validateArmForm,
  describeAutomation,
  type ArmForm,
  type ArmedAutomation,
} from '../apps/web/lib/automation-arm';

const goodForm: ArmForm = {
  interval: '1d',
  atrLength: 10,
  multiplier: 3,
  quantity: 1,
  product: 'mis',
  maxTradesPerDay: 5,
  telegram: true,
};

describe('defaultArmForm', () => {
  it('gives SuperTrend-flip defaults (atr 10 × mult 3, qty 1, MIS, cap 5, telegram on)', () => {
    const f = defaultArmForm();
    expect(f).toEqual({
      interval: '1d',
      atrLength: 10,
      multiplier: 3,
      quantity: 1,
      product: 'mis',
      maxTradesPerDay: 5,
      telegram: true,
    });
  });

  it('adopts a supplied chart interval when it is one the arm surface offers', () => {
    expect(defaultArmForm('15m').interval).toBe('15m');
  });

  it('falls back to 1d when the pane interval is not offered (e.g. tick)', () => {
    expect(defaultArmForm('tick').interval).toBe('1d');
  });
});

describe('validateArmForm', () => {
  it('accepts a KITE instrument + good form and derives tradingSymbol/exchange from the id', () => {
    const r = validateArmForm('KITE:NSE:RELIANCE', goodForm);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected ok');
    expect(r.payload).toEqual({
      symbol: 'KITE:NSE:RELIANCE',
      interval: '1d',
      atrLength: 10,
      multiplier: 3,
      tradingSymbol: 'RELIANCE',
      exchange: 'NSE',
      quantity: 1,
      product: 'mis',
      maxTradesPerDay: 5,
      telegram: true,
    });
  });

  it('restores canonical underscores back to broker spaces in the trading symbol', () => {
    const r = validateArmForm('KITE:NFO:NIFTY_50', goodForm);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected ok');
    expect(r.payload.tradingSymbol).toBe('NIFTY 50');
    expect(r.payload.exchange).toBe('NFO');
  });

  it('omits maxTradesPerDay from the payload when left blank (unlimited, still kill-switch gated)', () => {
    const r = validateArmForm('KITE:NSE:RELIANCE', { ...goodForm, maxTradesPerDay: null });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('expected ok');
    expect('maxTradesPerDay' in r.payload).toBe(false);
  });

  it('rejects a non-KITE symbol — you can only arm a broker instrument', () => {
    const r = validateArmForm('BINANCE:BTCUSDT', goodForm);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected error');
    expect(r.errors.join(' ')).toMatch(/instrument/i);
  });

  it('rejects a non-integer / < 1 ATR length', () => {
    expect(validateArmForm('KITE:NSE:RELIANCE', { ...goodForm, atrLength: 0 }).ok).toBe(false);
    expect(validateArmForm('KITE:NSE:RELIANCE', { ...goodForm, atrLength: 2.5 }).ok).toBe(false);
  });

  it('rejects a multiplier ≤ 0', () => {
    expect(validateArmForm('KITE:NSE:RELIANCE', { ...goodForm, multiplier: 0 }).ok).toBe(false);
    expect(validateArmForm('KITE:NSE:RELIANCE', { ...goodForm, multiplier: -1 }).ok).toBe(false);
  });

  it('rejects a non-integer / < 1 quantity', () => {
    expect(validateArmForm('KITE:NSE:RELIANCE', { ...goodForm, quantity: 0 }).ok).toBe(false);
    expect(validateArmForm('KITE:NSE:RELIANCE', { ...goodForm, quantity: 1.5 }).ok).toBe(false);
  });

  it('rejects a max-trades cap of 0 (but null is fine — blank means unlimited)', () => {
    expect(validateArmForm('KITE:NSE:RELIANCE', { ...goodForm, maxTradesPerDay: 0 }).ok).toBe(false);
  });

  it('reports every problem at once so the form can list them', () => {
    const r = validateArmForm('BINANCE:BTCUSDT', { ...goodForm, atrLength: 0, quantity: 0 });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('expected error');
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('describeAutomation', () => {
  const full: ArmedAutomation = {
    automationId: 'a1',
    symbol: 'KITE:NSE:RELIANCE',
    interval: '1d',
    enabled: true,
    atrLength: 10,
    multiplier: 3,
    brokerOrder: { broker: 'kite', tradingSymbol: 'RELIANCE', exchange: 'NSE', quantity: 1, product: 'mis', maxTradesPerDay: 5 },
    buy: { id: 'b', enabled: true },
    sell: { id: 's', enabled: true },
  };

  it('summarises a fully-armed pair in one line', () => {
    expect(describeAutomation(full)).toBe('SuperTrend(10×3) · RELIANCE NSE · 1d · flip · 1 MIS · max 5/day · both legs');
  });

  it('says "no cap" when the pair has no daily cap and flags a single armed leg', () => {
    const partial: ArmedAutomation = {
      ...full,
      brokerOrder: { ...full.brokerOrder!, maxTradesPerDay: null },
      sell: null,
    };
    expect(describeAutomation(partial)).toBe('SuperTrend(10×3) · RELIANCE NSE · 1d · flip · 1 MIS · no cap · buy leg only');
  });

  it('degrades gracefully when broker/indicator meta is missing', () => {
    const bare: ArmedAutomation = {
      automationId: 'a2',
      symbol: 'KITE:NSE:INFY',
      interval: '15m',
      enabled: false,
      atrLength: null,
      multiplier: null,
      brokerOrder: null,
      buy: null,
      sell: null,
    };
    expect(describeAutomation(bare)).toContain('SuperTrend');
    expect(describeAutomation(bare)).toContain('KITE:NSE:INFY');
  });
});
