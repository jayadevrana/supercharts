import { describe, it, expect } from 'vitest';
import {
  runSignalBacktest,
  runMaCrossBacktest,
  type StrategySignal,
} from '../apps/api/src/backtester';
import { computeMaCross } from '../packages/chart-core/src/pure';
import { runScript } from '../packages/script-lang/src/index';
import type { Candle, MaCrossAlertConfig } from '@supercharts/types';

/**
 * PulseScript Strategy Tester core — runSignalBacktest takes arbitrary {index, side}
 * signals (a script's mark buy/sell output) through the EXACT same trade model as the
 * MA-cross backtester. The equivalence test pins that guarantee.
 */

function bar(i: number, close: number, high = close + 1, low = close - 1): Candle {
  return { openTime: i * 3_600_000, closeTime: i * 3_600_000 + 1, open: close, high, low, close, volume: 10 } as Candle;
}

const flat = (n: number, prices: number[]): Candle[] =>
  Array.from({ length: n }, (_, i) => bar(i, prices[i] ?? prices[prices.length - 1] ?? 100));

describe('runSignalBacktest — trade pairing', () => {
  // buy @ bar1 (close 100) → sell @ bar3 (close 110): one long +10%, then flipped short
  // closed at end-of-data (bar4 close 105): +4.545…%
  const candles = flat(5, [100, 100, 105, 110, 105]);
  const signals: StrategySignal[] = [
    { index: 1, side: 'buy' },
    { index: 3, side: 'sell' },
  ];

  it('enters at the signal bar close, exits + flips on the opposite signal, closes at end', () => {
    const r = runSignalBacktest(candles, signals, '1h');
    expect(r.trades).toHaveLength(2);
    const [long, short] = r.trades;
    expect(long!.side).toBe('buy');
    expect(long!.entryPrice).toBe(100);
    expect(long!.exitPrice).toBe(110);
    expect(long!.pnlPercent).toBeCloseTo(10, 6);
    expect(short!.side).toBe('sell');
    expect(short!.entryPrice).toBe(110);
    expect(short!.exitPrice).toBe(105);
    expect(short!.pnlPercent).toBeCloseTo(((110 - 105) / 110) * 100, 6);
  });

  it('ignores same-side re-entries while a position is open', () => {
    const r = runSignalBacktest(
      candles,
      [
        { index: 1, side: 'buy' },
        { index: 2, side: 'buy' }, // ignored — already long
        { index: 3, side: 'sell' },
      ],
      '1h',
    );
    expect(r.trades).toHaveLength(2);
    expect(r.trades[0]!.entryPrice).toBe(100); // still the bar-1 entry
  });

  it('filters out-of-range indices and sorts unsorted signals', () => {
    const r = runSignalBacktest(
      candles,
      [
        { index: 3, side: 'sell' },
        { index: -2, side: 'buy' },
        { index: 99, side: 'buy' },
        { index: 1, side: 'buy' },
      ],
      '1h',
    );
    expect(r.trades).toHaveLength(2);
    expect(r.trades[0]!.side).toBe('buy');
  });

  it('returns the empty result for no usable signals', () => {
    expect(runSignalBacktest(candles, [], '1h').summary.trades).toBe(0);
    expect(runSignalBacktest(candles, [{ index: 99, side: 'buy' }], '1h').summary.trades).toBe(0);
  });
});

describe('equivalence with the MA-cross backtester', () => {
  // Deterministic wave so EMAs genuinely cross several times.
  const candles: Candle[] = Array.from({ length: 500 }, (_, i) =>
    bar(i, 100 + Math.sin(i / 12) * 8 + i * 0.02),
  );
  const config: MaCrossAlertConfig = {
    ma: { type: 'ema', length: 9, source: 'close' },
    crossWith: { type: 'ema', length: 21 },
    labels: { buy: 'BUY', sell: 'SELL' },
    delivery: { web: true, telegram: false },
    timezone: 'UTC',
  };

  it('feeding computeMaCross signals reproduces runMaCrossBacktest exactly (no realism)', () => {
    const { crosses } = computeMaCross(candles, { ...config.ma, crossWith: config.crossWith });
    const viaSignals = runSignalBacktest(
      candles,
      crosses.map((c) => ({ index: c.index, side: c.side })),
      '1h',
    );
    const direct = runMaCrossBacktest(candles, config, '1h');
    expect(viaSignals).toEqual(direct);
  });

  it('…and with the realism layer active', () => {
    const { crosses } = computeMaCross(candles, { ...config.ma, crossWith: config.crossWith });
    const realism = { commissionPct: 0.05, slippagePct: 0.02, stopLossPct: 2, takeProfitPct: 4 };
    const viaSignals = runSignalBacktest(
      candles,
      crosses.map((c) => ({ index: c.index, side: c.side })),
      '1h',
      realism,
    );
    const direct = runMaCrossBacktest(candles, config, '1h', realism);
    expect(viaSignals).toEqual(direct);
  });

  it('commission lowers the signal-backtest return', () => {
    const { crosses } = computeMaCross(candles, { ...config.ma, crossWith: config.crossWith });
    const signals = crosses.map((c) => ({ index: c.index, side: c.side }));
    const plain = runSignalBacktest(candles, signals, '1h');
    const taxed = runSignalBacktest(candles, signals, '1h', { commissionPct: 0.1 });
    expect(taxed.summary.totalReturnPct).toBeLessThan(plain.summary.totalReturnPct);
  });
});

describe('end-to-end: PulseScript marks → backtest', () => {
  it('a mark buy/sell strategy script produces a real trade list', () => {
    const candles: Candle[] = Array.from({ length: 400 }, (_, i) =>
      bar(i, 100 + Math.sin(i / 10) * 6 + i * 0.01),
    );
    const src = `
let fast = ema(close, 7)
let slow = ema(close, 19)
when crossOver(fast, slow) { mark buy "L" }
when crossUnder(fast, slow) { mark sell "S" }
`;
    const run = runScript(src, candles, {});
    const signals = run.marks
      .filter((m) => m.kind === 'buy' || m.kind === 'sell')
      .map((m) => ({ index: m.bar, side: m.kind as 'buy' | 'sell' }));
    expect(signals.length).toBeGreaterThan(4);
    const r = runSignalBacktest(candles, signals, '1h');
    expect(r.trades.length).toBeGreaterThan(3);
    // Every entry price is a real candle close at the mark's bar.
    for (const t of r.trades) {
      const i = t.entryTime / 3_600_000;
      expect(t.entryPrice).toBe(candles[i]!.close);
    }
  });

  it('input.num rejects a non-numeric default loudly (the title-first footgun)', () => {
    const candles = flat(50, [100]);
    expect(() => runScript('let n = input.num("Fast", 9)\ndraw line(ema(close, n))', candles, {})).toThrow(
      /input\.num default must be a number/,
    );
  });
});
