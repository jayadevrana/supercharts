import { describe, it, expect } from 'vitest';
import { buildAttribution, strategySignature } from '../apps/api/src/pnl-attribution';

const cfg = (fast: number, slow: number) =>
  ({
    ma: { type: 'ema', length: fast, source: 'close' },
    crossWith: { type: 'ema', length: slow },
    labels: { buy: 'B', sell: 'S' },
    delivery: { web: true, telegram: false },
    timezone: 'UTC',
  }) as never;

describe('strategySignature', () => {
  it('formats a dual-MA recipe', () => {
    const sig = strategySignature(cfg(5, 10));
    expect(sig).toContain('EMA(5)');
    expect(sig).toContain('EMA(10)');
  });
});

describe('buildAttribution', () => {
  it('rolls realised + open P&L per alert and by strategy / asset class', () => {
    const meta = new Map<string, never>([
      ['a1', { symbol: 'BINANCE:BTCUSDT', interval: '1d', config: cfg(5, 10) } as never],
      ['a2', { symbol: 'BINANCE:ETHUSDT', interval: '1d', config: cfg(5, 10) } as never],
    ]);
    const closed = [
      { alertId: 'a1', pnlPercent: 2 },
      { alertId: 'a1', pnlPercent: -1 },
      { alertId: 'a2', pnlPercent: 3 },
    ];
    const open = [{ alertId: 'a1', side: 'buy' as const, unrealizedPct: 0.5 }];

    const r = buildAttribution(closed, open, meta);
    const a1 = r.rows.find((x) => x.alertId === 'a1')!;
    expect(a1.realisedPct).toBeCloseTo(1);
    expect(a1.unrealizedPct).toBeCloseTo(0.5);
    expect(a1.totalPct).toBeCloseTo(1.5);
    expect(a1.wins).toBe(1);
    expect(a1.losses).toBe(1);
    expect(a1.winRate).toBeCloseTo(0.5);

    expect(r.totals.closedTrades).toBe(3);
    expect(r.totals.realisedPct).toBeCloseTo(4); // 1 + 3
    expect(r.byStrategy.length).toBe(1); // same signature across both alerts
    expect(r.byCategory.length).toBe(1); // both crypto
    expect(r.byCategory[0]!.label.toLowerCase()).toContain('crypto');
  });
});
