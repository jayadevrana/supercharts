import { describe, it, expect } from 'vitest';
import {
  buildSupertrendAutomation,
  type SupertrendAutomationParams,
} from '../apps/api/src/broker/supertrend-automation';
import { evaluateConditionSet, collectIndicatorRefs } from '../apps/api/src/signal-eval';
import { supertrend } from '../packages/indicators/src/trend';
import type { Candle, SignalCondition } from '@supercharts/types';

/**
 * GW-7 final-delivery surface. `buildSupertrendAutomation` is the pure translation from a
 * SuperTrend + Kite-instrument config into the ARMED alert pair the owner runs on any instrument:
 * a BUY-side indicator alert (SuperTrend direction flips up) and a SELL-side one (flips down),
 * both carrying the SAME `delivery.brokerOrder`. The GW-7 executor turns each fire into a
 * position-FLIP through the audited pipeline (BUY→long, SELL→short), so the pair = full flip
 * automation. These tests pin the shape AND prove the conditions fire on the real indicator.
 */

const baseParams: SupertrendAutomationParams = {
  symbol: 'KITE:NSE:RELIANCE',
  interval: '15m',
  tradingSymbol: 'RELIANCE',
  exchange: 'NSE',
  quantity: 5,
  product: 'mis',
};

describe('buildSupertrendAutomation — structure', () => {
  it('builds a buy + sell indicator-alert pair for the same symbol/interval', () => {
    const { buy, sell } = buildSupertrendAutomation(baseParams);
    for (const leg of [buy, sell]) {
      expect(leg.type).toBe('indicator');
      expect(leg.symbol).toBe('KITE:NSE:RELIANCE');
      expect(leg.interval).toBe('15m');
      expect(leg.enabled).toBe(true);
      expect(leg.config.conditions).toHaveLength(1);
    }
    expect(buy.config.side).toBe('buy');
    expect(sell.config.side).toBe('sell');
  });

  it('the buy leg fires on a direction flip UP (crosses_above 0), the sell leg on flip DOWN', () => {
    const { buy, sell } = buildSupertrendAutomation(baseParams);
    const buyCond = buy.config.conditions[0] as SignalCondition;
    const sellCond = sell.config.conditions[0] as SignalCondition;
    expect(buyCond).toMatchObject({
      type: 'indicator_compare',
      channel: 'direction',
      operator: 'crosses_above',
      right: { kind: 'constant', value: 0 },
    });
    expect(sellCond).toMatchObject({
      type: 'indicator_compare',
      channel: 'direction',
      operator: 'crosses_below',
      right: { kind: 'constant', value: 0 },
    });
  });

  it('both legs reference ONE supertrend instance carrying the tuned atr/multiplier inputs', () => {
    const { buy, sell } = buildSupertrendAutomation({ ...baseParams, atrLength: 7, multiplier: 2.5 });
    const spec = buy.config.indicatorSpecs?.[0];
    expect(spec?.type).toBe('supertrend');
    expect(spec?.inputs).toEqual({ atrLength: 7, multiplier: 2.5 });
    // The condition's `indicator` id must match the spec id on BOTH legs (else the runner
    // computes nothing and the alert never fires).
    const buyId = (buy.config.conditions[0] as { indicator: string }).indicator;
    const sellId = (sell.config.conditions[0] as { indicator: string }).indicator;
    expect(buyId).toBe(spec?.id);
    expect(sellId).toBe(buy.config.indicatorSpecs?.[0]?.id);
    expect(sell.config.indicatorSpecs?.[0]?.id).toBe(spec?.id);
  });

  it('threads the SAME broker-order config onto both legs (flip = one instrument)', () => {
    const { buy, sell } = buildSupertrendAutomation({ ...baseParams, quantity: 50, product: 'nrml', maxTradesPerDay: 4 });
    const expected = {
      broker: 'kite',
      tradingSymbol: 'RELIANCE',
      exchange: 'NSE',
      quantity: 50,
      product: 'nrml',
      maxTradesPerDay: 4,
    };
    expect(buy.config.delivery.brokerOrder).toEqual(expected);
    expect(sell.config.delivery.brokerOrder).toEqual(expected);
  });

  it('defaults: atr 10 · mult 3 · telegram on · IST timezone · maxTradesPerDay omitted', () => {
    const { buy } = buildSupertrendAutomation(baseParams);
    expect(buy.config.indicatorSpecs?.[0]?.inputs).toEqual({ atrLength: 10, multiplier: 3 });
    expect(buy.config.delivery.telegram).toBe(true);
    expect(buy.config.timezone).toBe('Asia/Kolkata');
    expect(buy.config.delivery.brokerOrder?.maxTradesPerDay).toBeUndefined();
  });

  it('passes a chosen telegram bot + cap through, and keeps web delivery on', () => {
    const { buy, sell } = buildSupertrendAutomation({
      ...baseParams,
      telegramBotId: 'bot_9',
      maxTradesPerDay: 2,
    });
    expect(buy.config.delivery.telegramBotId).toBe('bot_9');
    expect(sell.config.delivery.web).toBe(true);
    expect(buy.config.delivery.brokerOrder?.maxTradesPerDay).toBe(2);
  });
});

describe('buildSupertrendAutomation — validation (fails loud, never arms a bad order)', () => {
  it('rejects a non-positive or non-integer quantity', () => {
    expect(() => buildSupertrendAutomation({ ...baseParams, quantity: 0 })).toThrow();
    expect(() => buildSupertrendAutomation({ ...baseParams, quantity: -3 })).toThrow();
    expect(() => buildSupertrendAutomation({ ...baseParams, quantity: 1.5 })).toThrow();
  });
  it('rejects an empty trading symbol or exchange', () => {
    expect(() => buildSupertrendAutomation({ ...baseParams, tradingSymbol: '' })).toThrow();
    expect(() => buildSupertrendAutomation({ ...baseParams, exchange: '  ' })).toThrow();
  });
  it('rejects a non-positive multiplier or atrLength < 1', () => {
    expect(() => buildSupertrendAutomation({ ...baseParams, multiplier: 0 })).toThrow();
    expect(() => buildSupertrendAutomation({ ...baseParams, atrLength: 0 })).toThrow();
  });
});

/**
 * Integration: run the built conditions through the REAL shared evaluator + REAL supertrend
 * indicator. We reference the same indicator to find the true flip bars, then assert the buy leg
 * fires exactly on an up-flip (and not on a random non-flip bar), the sell leg on a down-flip.
 * This ties the builder's channel name/operator/constant to the actual indicator output.
 */
describe('buildSupertrendAutomation — fires on real SuperTrend flips', () => {
  // Zigzag that forces SuperTrend to flip both ways (verified: upFlips [37,97], downFlips [67,128]).
  const closes: number[] = [];
  for (const [a, b] of [[120, 80], [80, 135], [135, 85], [85, 140], [140, 95]] as const) {
    const n = 30;
    for (let i = 0; i < n; i++) closes.push(a + (b - a) * (i / (n - 1)));
  }
  const bars: Candle[] = closes.map(
    (c, i) => ({ openTime: i, closeTime: i, open: c, high: c + 2, low: c - 2, close: c, volume: 1 } as Candle),
  );
  const { direction } = supertrend(bars, { multiplier: 3, atrLength: 10 });
  const upFlips: number[] = [];
  const downFlips: number[] = [];
  for (let i = 1; i < direction.length; i++) {
    if (direction[i - 1]! < 0 && direction[i]! > 0) upFlips.push(i);
    if (direction[i - 1]! > 0 && direction[i]! < 0) downFlips.push(i);
  }

  const { buy, sell } = buildSupertrendAutomation({ ...baseParams, atrLength: 10, multiplier: 3 });
  const buyConds = buy.config.conditions as SignalCondition[];
  const sellConds = sell.config.conditions as SignalCondition[];
  const specs = buy.config.indicatorSpecs;

  const firesAt = (conds: SignalCondition[], k: number): boolean =>
    evaluateConditionSet(conds, 'all', bars.slice(0, k + 1), collectIndicatorRefs(conds), specs);

  it('the fixture actually flips both ways', () => {
    expect(upFlips.length).toBeGreaterThan(0);
    expect(downFlips.length).toBeGreaterThan(0);
  });

  it('buy leg fires on an up-flip bar and not on a down-flip bar', () => {
    expect(firesAt(buyConds, upFlips[0]!)).toBe(true);
    expect(firesAt(buyConds, downFlips[0]!)).toBe(false);
  });

  it('sell leg fires on a down-flip bar and not on an up-flip bar', () => {
    expect(firesAt(sellConds, downFlips[0]!)).toBe(true);
    expect(firesAt(sellConds, upFlips[0]!)).toBe(false);
  });

  it('neither leg fires on a quiet mid-trend bar (no flip)', () => {
    const quiet = upFlips[0]! + 5; // a few bars into the up-leg, no sign change
    expect(direction[quiet]).toBe(direction[quiet - 1]); // sanity: same regime
    expect(firesAt(buyConds, quiet)).toBe(false);
    expect(firesAt(sellConds, quiet)).toBe(false);
  });
});
