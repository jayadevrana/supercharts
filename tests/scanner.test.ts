import { describe, expect, it } from 'vitest';
import { runScan, type ScanScreen } from '../apps/api/src/scanner';
import { SCAN_PRESETS, presetScreen } from '../apps/api/src/scan-presets';
import { rsi } from '../packages/indicators/src/oscillators';
import { ema } from '../packages/indicators/src/ma';
import { k, series } from './_helpers';
import type { Candle, IndicatorInstance } from '@supercharts/types';

/** Deterministic pseudo-random walk long enough for RSI/EMA/ATR warmup. */
function walk(n: number, seed = 1, start = 100): number[] {
  let x = seed;
  const closes: number[] = [];
  let price = start;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    price = Math.max(1, price + ((x / 2 ** 31) - 0.5) * 2);
    closes.push(price);
  }
  return closes;
}

/** A steadily falling series → deeply oversold RSI on the last bar. */
const FALLING = series(Array.from({ length: 120 }, (_, i) => 200 - i));
/** A steadily rising series → overbought RSI. */
const RISING = series(Array.from({ length: 120 }, (_, i) => 100 + i));
const NOW = 120 * 60_000 + 1; // after every closeTime → all bars closed

const spec = (id: string, type: string, inputs: Record<string, number | string | boolean> = {}): IndicatorInstance => ({
  id, type, name: id, paneId: 'price', inputs, style: {}, visible: true, locked: false,
});

function screen(conditions: ScanScreen['conditions'], specs: IndicatorInstance[] = []): ScanScreen {
  return { conditions, logic: 'all', indicatorSpecs: specs };
}

describe('runScan', () => {
  it('computes real metric columns that match the indicators package', () => {
    const bySymbol = new Map<string, Candle[]>([['BINANCE:AAAUSDT', FALLING as unknown as Candle[]]]);
    const res = runScan(bySymbol, { interval: '1m', screen: screen([]), now: NOW });
    const row = res.rows[0]!;
    expect(row.status).toBe('ok');
    const closes = FALLING.map((c) => c.close);
    const expectedRsi = rsi(FALLING as unknown as Candle[], { length: 14 });
    const expectedEma = ema(closes, 21);
    expect(row.metrics.rsi).toBeCloseTo(expectedRsi[expectedRsi.length - 1]!, 6);
    const lastClose = closes[closes.length - 1]!;
    const lastEma = expectedEma[expectedEma.length - 1]!;
    expect(row.metrics.emaDistPct).toBeCloseTo(((lastClose - lastEma) / lastEma) * 100, 6);
    expect(row.metrics.close).toBe(lastClose);
  });

  it('drops a still-forming last bar before computing (closed-bar semantics)', () => {
    const bars = [...FALLING] as unknown as Candle[];
    // A forming bar whose closeTime is in the future relative to `now`.
    const forming = k(120 * 60_000, 80, 999, 79, 998);
    const withForming = [...bars, forming] as unknown as Candle[];
    const a = runScan(new Map([['S', bars]]), { interval: '1m', screen: screen([]), now: NOW });
    const b = runScan(new Map([['S', withForming]]), { interval: '1m', screen: screen([]), now: NOW });
    expect(b.rows[0]!.metrics.close).toBe(a.rows[0]!.metrics.close); // 998 never leaks in
    expect(b.rows[0]!.bars).toBe(a.rows[0]!.bars);
  });

  it('flags empty symbols unavailable and short histories insufficient, without metrics', () => {
    const bySymbol = new Map<string, Candle[]>([
      ['EMPTY', []],
      ['SHORT', series([1, 2, 3, 4, 5]) as unknown as Candle[]],
      ['OK', FALLING as unknown as Candle[]],
    ]);
    const res = runScan(bySymbol, { interval: '1m', screen: screen([]), now: NOW });
    const by = Object.fromEntries(res.rows.map((r) => [r.symbol, r]));
    expect(by.EMPTY!.status).toBe('unavailable');
    expect(by.SHORT!.status).toBe('insufficient_data');
    expect(by.OK!.status).toBe('ok');
    expect(by.EMPTY!.metrics).toEqual({});
    expect(res.total).toBe(3);
  });

  it('oversold preset matches the falling series and not the rising one', () => {
    const bySymbol = new Map<string, Candle[]>([
      ['FALLING', FALLING as unknown as Candle[]],
      ['RISING', RISING as unknown as Candle[]],
    ]);
    const res = runScan(bySymbol, { interval: '1m', screen: presetScreen('oversold'), now: NOW });
    const by = Object.fromEntries(res.rows.map((r) => [r.symbol, r.matched]));
    expect(by.FALLING).toBe(true);
    expect(by.RISING).toBe(false);
    expect(res.matchedCount).toBe(1);
  });

  it('custom indicatorSpecs override defaults (RSI length 7 vs 14 disagree on a crafted tail)', () => {
    const closes = [...walk(100, 7), 101, 102, 103, 100, 99, 98]; // short down-tail
    const bars = series(closes) as unknown as Candle[];
    const rsi7 = rsi(bars, { length: 7 });
    const rsi14 = rsi(bars, { length: 14 });
    const last7 = rsi7[rsi7.length - 1]!;
    const last14 = rsi14[rsi14.length - 1]!;
    expect(Math.abs(last7 - last14)).toBeGreaterThan(1); // premise: they differ
    const threshold = (last7 + last14) / 2;
    const cond = [{
      type: 'indicator_compare' as const,
      indicator: 'myRsi', channel: 'value',
      operator: (last7 < last14 ? '<' : '>') as '<' | '>',
      right: { kind: 'constant' as const, value: threshold },
    }];
    const withSpec = runScan(new Map([['S', bars]]), {
      interval: '1m', now: NOW,
      screen: { conditions: cond, logic: 'all', indicatorSpecs: [spec('myRsi', 'rsi', { length: 7 })] },
    });
    expect(withSpec.rows[0]!.matched).toBe(true); // only true under length 7
  });

  it('MA-cross preset matches only a symbol whose cross happened on the LAST closed bar', () => {
    // Build a series where ema9 crosses above ema21 exactly at the end: long decline, sharp rally.
    const closes = [...Array.from({ length: 80 }, (_, i) => 200 - i), ...Array.from({ length: 9 }, (_, i) => 121 + i * 8)];
    const crossing = series(closes) as unknown as Candle[];
    const flat = series(Array.from({ length: 89 }, () => 100)) as unknown as Candle[];
    const res = runScan(new Map([['CROSS', crossing], ['FLAT', flat]]), {
      interval: '1m', screen: presetScreen('ma_cross_bull'), now: NOW,
    });
    const by = Object.fromEntries(res.rows.map((r) => [r.symbol, r.matched]));
    expect(by.FLAT).toBe(false);
    // Verify the premise independently: ema9 crossed above ema21 on the final bar.
    const e9 = ema(closes, 9); const e21 = ema(closes, 21);
    const n = closes.length - 1;
    const crossedNow = e9[n]! > e21[n]! && e9[n - 1]! <= e21[n - 1]!;
    expect(by.CROSS).toBe(crossedNow);
  });

  it('every preset is well-formed and evaluates without throwing', () => {
    const bySymbol = new Map<string, Candle[]>([['S', FALLING as unknown as Candle[]]]);
    for (const p of SCAN_PRESETS) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      const res = runScan(bySymbol, { interval: '1m', screen: presetScreen(p.id), now: NOW });
      expect(res.rows[0]!.status).toBe('ok');
      expect(typeof res.rows[0]!.matched).toBe('boolean');
    }
  });

  it('empty condition list = pure metrics table (every ok row matches)', () => {
    const res = runScan(new Map([['S', RISING as unknown as Candle[]]]), { interval: '1m', screen: screen([]), now: NOW });
    expect(res.rows[0]!.matched).toBe(true);
  });
});
