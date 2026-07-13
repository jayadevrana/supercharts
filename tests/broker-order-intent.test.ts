import { describe, expect, it } from 'vitest';
import { validateOrderIntent } from '../apps/api/src/broker/order-intent';

const base = { symbol: 'SBIN', exchange: 'NSE', side: 'buy', quantity: 1, product: 'mis' };

describe('validateOrderIntent', () => {
  it('accepts a market order and defaults variety/validity', () => {
    const r = validateOrderIntent({ ...base, orderType: 'market' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.intent).toMatchObject({
        symbol: 'SBIN', exchange: 'NSE', side: 'buy', quantity: 1, orderType: 'market', product: 'mis',
      });
    }
  });

  it('requires a price for limit orders', () => {
    expect(validateOrderIntent({ ...base, orderType: 'limit' }).ok).toBe(false);
    expect(validateOrderIntent({ ...base, orderType: 'limit', price: 700 }).ok).toBe(true);
  });

  it('requires a trigger for sl-m and both price+trigger for sl', () => {
    expect(validateOrderIntent({ ...base, orderType: 'sl-m' }).ok).toBe(false);
    expect(validateOrderIntent({ ...base, orderType: 'sl-m', triggerPrice: 690 }).ok).toBe(true);
    expect(validateOrderIntent({ ...base, orderType: 'sl', triggerPrice: 690 }).ok).toBe(false);
    expect(validateOrderIntent({ ...base, orderType: 'sl', price: 700, triggerPrice: 690 }).ok).toBe(true);
  });

  it('rejects non-positive / non-integer quantity and bad enums', () => {
    expect(validateOrderIntent({ ...base, orderType: 'market', quantity: 0 }).ok).toBe(false);
    expect(validateOrderIntent({ ...base, orderType: 'market', quantity: 1.5 }).ok).toBe(false);
    expect(validateOrderIntent({ ...base, orderType: 'market', product: 'xxx' }).ok).toBe(false);
    expect(validateOrderIntent({ ...base, orderType: 'weird' }).ok).toBe(false);
  });
});
