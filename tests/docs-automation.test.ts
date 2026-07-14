import { describe, it, expect } from 'vitest';
import { runScript } from '../packages/script-lang/src/interpreter';
import {
  AUTOMATION_STRATEGY_SCRIPT,
  AUTOMATION_DEFAULTS,
  ARM_STEPS,
  SAFETY_RAILS,
  FLIP_TABLE,
} from '../apps/web/features/docs/automation-guide';
import { defaultArmForm } from '../apps/web/lib/automation-arm';
import { buildSupertrendAutomation } from '../apps/api/src/broker/supertrend-automation';
import { k } from './_helpers';

/**
 * FINAL-DELIVERY capstone doc (/docs/automation): "arm this SuperTrend flip on your Kite
 * instrument". The page renders one source of truth — `automation-guide.ts` — so these tests
 * PROVE the docs can't drift:
 *  1. the displayed strategy script actually runs through the REAL interpreter and emits clean
 *     BUY + SELL flip marks (nothing decorative);
 *  2. the documented default arm parameters MATCH the real arm-form (`defaultArmForm`) AND the
 *     real automation builder (`buildSupertrendAutomation`) — so a number on the page can never
 *     silently disagree with what the terminal actually arms.
 */

// Zigzag that forces SuperTrend to flip both ways (same shape the builder test proved flips at
// upFlips [37,97] / downFlips [67,128] with atr 10 × mult 3).
const CLOSES: number[] = [];
for (const [a, b] of [[120, 80], [80, 135], [135, 85], [85, 140], [140, 95]] as const) {
  const n = 30;
  for (let i = 0; i < n; i++) CLOSES.push(a + (b - a) * (i / (n - 1)));
}
const CANDLES = CLOSES.map((c, i) => k(i * 60_000, c, c + 2, c - 2, c, 1));

describe('automation guide — the displayed strategy is a real, running script', () => {
  it('parses, runs clean, and emits BOTH buy and sell flip marks', () => {
    const res = runScript(AUTOMATION_STRATEGY_SCRIPT, CANDLES, { interval: '1m' });
    const buys = res.marks.filter((m) => m.kind === 'buy');
    const sells = res.marks.filter((m) => m.kind === 'sell');
    expect(buys.length, 'no buy flip marks').toBeGreaterThan(0);
    expect(sells.length, 'no sell flip marks').toBeGreaterThan(0);
    // It draws the SuperTrend line too (so the page shows more than dots).
    expect(res.plots.length).toBeGreaterThan(0);
  });

  it('the script inputs default to the SAME atr/multiplier the page documents', () => {
    const res = runScript(AUTOMATION_STRATEGY_SCRIPT, CANDLES, { interval: '1m' });
    const byTitle = (t: string) => res.inputs.find((inp) => inp.title === t);
    expect(byTitle('ATR length')?.default).toBe(AUTOMATION_DEFAULTS.atrLength);
    expect(byTitle('ATR multiplier')?.default).toBe(AUTOMATION_DEFAULTS.multiplier);
  });
});

describe('automation guide — documented defaults match the real arm surface (drift guard)', () => {
  it('AUTOMATION_DEFAULTS equals defaultArmForm() field-for-field', () => {
    const form = defaultArmForm();
    expect(AUTOMATION_DEFAULTS.atrLength).toBe(form.atrLength);
    expect(AUTOMATION_DEFAULTS.multiplier).toBe(form.multiplier);
    expect(AUTOMATION_DEFAULTS.quantity).toBe(form.quantity);
    expect(AUTOMATION_DEFAULTS.product).toBe(form.product);
    expect(AUTOMATION_DEFAULTS.maxTradesPerDay).toBe(form.maxTradesPerDay);
    expect(AUTOMATION_DEFAULTS.telegram).toBe(form.telegram);
  });

  it('the same defaults drive what buildSupertrendAutomation actually arms', () => {
    const { buy, sell } = buildSupertrendAutomation({
      symbol: 'KITE:NSE:RELIANCE',
      interval: '1d',
      tradingSymbol: 'RELIANCE',
      exchange: 'NSE',
      quantity: AUTOMATION_DEFAULTS.quantity,
      product: AUTOMATION_DEFAULTS.product,
      maxTradesPerDay: AUTOMATION_DEFAULTS.maxTradesPerDay,
    });
    // atr/mult defaults the page claims == what the builder bakes into the indicator spec.
    expect(buy.config.indicatorSpecs?.[0]?.inputs).toEqual({
      atrLength: AUTOMATION_DEFAULTS.atrLength,
      multiplier: AUTOMATION_DEFAULTS.multiplier,
    });
    // FLIP semantics the page describes == the real leg conditions.
    expect(buy.config.side).toBe('buy');
    expect(sell.config.side).toBe('sell');
    expect((buy.config.conditions[0] as { operator: string }).operator).toBe('crosses_above');
    expect((sell.config.conditions[0] as { operator: string }).operator).toBe('crosses_below');
    // qty / product / cap / telegram the page claims == what actually gets ordered.
    expect(buy.config.delivery.brokerOrder?.quantity).toBe(AUTOMATION_DEFAULTS.quantity);
    expect(buy.config.delivery.brokerOrder?.product).toBe(AUTOMATION_DEFAULTS.product);
    expect(buy.config.delivery.brokerOrder?.maxTradesPerDay).toBe(AUTOMATION_DEFAULTS.maxTradesPerDay);
    expect(buy.config.delivery.telegram).toBe(AUTOMATION_DEFAULTS.telegram);
  });
});

describe('automation guide — content is complete enough to actually follow', () => {
  it('ships arm steps, safety rails, and a two-sided flip table', () => {
    expect(ARM_STEPS.length).toBeGreaterThanOrEqual(3);
    for (const s of ARM_STEPS) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.body.length).toBeGreaterThan(0);
    }
    expect(SAFETY_RAILS.length).toBeGreaterThanOrEqual(3);
    const signals = FLIP_TABLE.map((r) => r.signal.toLowerCase());
    expect(signals.some((s) => s.includes('buy'))).toBe(true);
    expect(signals.some((s) => s.includes('sell'))).toBe(true);
  });
});
