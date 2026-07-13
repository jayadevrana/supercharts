import { describe, expect, it } from 'vitest';
import { planFlip } from '../apps/api/src/broker/flip-planner';

const target = {
  symbol: 'RELIANCE',
  exchange: 'NSE',
  product: 'mis' as const,
  quantity: 10,
};

describe('planFlip — position-flip order planning (GW-7)', () => {
  it('flat + BUY → single open-long market order', () => {
    const r = planFlip({ currentSigned: 0, side: 'buy', ...target });
    expect(r.reason).toBe('open');
    expect(r.intents).toHaveLength(1);
    expect(r.intents[0]).toMatchObject({
      symbol: 'RELIANCE', exchange: 'NSE', side: 'buy', quantity: 10, orderType: 'market', product: 'mis',
    });
  });

  it('flat + SELL → single open-short market order', () => {
    const r = planFlip({ currentSigned: 0, side: 'sell', ...target });
    expect(r.reason).toBe('open');
    expect(r.intents).toHaveLength(1);
    expect(r.intents[0]).toMatchObject({ side: 'sell', quantity: 10, orderType: 'market' });
  });

  it('short + BUY → close short THEN open long (two orders, close first)', () => {
    const r = planFlip({ currentSigned: -7, side: 'buy', ...target });
    expect(r.reason).toBe('flip');
    expect(r.intents).toHaveLength(2);
    // Order 1: close the 7-lot short (a BUY of exactly the open qty).
    expect(r.intents[0]).toMatchObject({ side: 'buy', quantity: 7, orderType: 'market', product: 'mis' });
    // Order 2: open the fresh 10-lot long.
    expect(r.intents[1]).toMatchObject({ side: 'buy', quantity: 10, orderType: 'market' });
  });

  it('long + SELL → close long THEN open short (two orders, close first)', () => {
    const r = planFlip({ currentSigned: 4, side: 'sell', ...target });
    expect(r.reason).toBe('flip');
    expect(r.intents).toHaveLength(2);
    expect(r.intents[0]).toMatchObject({ side: 'sell', quantity: 4, orderType: 'market' });
    expect(r.intents[1]).toMatchObject({ side: 'sell', quantity: 10, orderType: 'market' });
  });

  it('already long + BUY → no-op (idempotent, never stacks)', () => {
    const r = planFlip({ currentSigned: 5, side: 'buy', ...target });
    expect(r.reason).toBe('already_long');
    expect(r.intents).toHaveLength(0);
  });

  it('already short + SELL → no-op (idempotent)', () => {
    const r = planFlip({ currentSigned: -5, side: 'sell', ...target });
    expect(r.reason).toBe('already_short');
    expect(r.intents).toHaveLength(0);
  });

  it('uses the configured product on every emitted intent', () => {
    const r = planFlip({ currentSigned: -3, side: 'buy', symbol: 'X', exchange: 'NFO', product: 'nrml', quantity: 50 });
    expect(r.intents.every((i) => i.product === 'nrml')).toBe(true);
    expect(r.intents[0]!.quantity).toBe(3);
    expect(r.intents[1]!.quantity).toBe(50);
  });

  it('rejects a non-positive target quantity (never emits a broken intent)', () => {
    expect(() => planFlip({ currentSigned: 0, side: 'buy', ...target, quantity: 0 })).toThrow();
    expect(() => planFlip({ currentSigned: 0, side: 'buy', ...target, quantity: -1 })).toThrow();
  });
});
