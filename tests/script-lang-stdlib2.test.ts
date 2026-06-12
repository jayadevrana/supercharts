import { describe, it, expect } from 'vitest';
import { runScript, type RunResult } from '../packages/script-lang/src/interpreter';
import { hma, dema, tema } from '../packages/indicators/src/ma';
import { cci, mfi, williamsR, macd, stochastic } from '../packages/indicators/src/oscillators';
import { bollinger, keltner, donchian, stdev } from '../packages/indicators/src/volatility';
import { adx, supertrend, psar, aroon, ichimoku } from '../packages/indicators/src/trend';
import { obv, cmf } from '../packages/indicators/src/volume';
import { series, k } from './_helpers';

/** Stdlib expansion: new ta.* / math.* — every reused study pinned against @supercharts/indicators. */

const vals = (res: RunResult, title: string): (number | null)[] => res.plots.find((p) => p.title === title)!.values;

/** Plot values (null = none) must match a package array (NaN = warm-up) bar for bar. */
function expectSeries(actual: (number | null)[], expected: readonly number[], digits = 7): void {
  expect(actual.length).toBeGreaterThan(0);
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i]!;
    if (!Number.isFinite(e)) expect(actual[i] ?? null).toBeNull();
    else expect(actual[i]).toBeCloseTo(e, digits);
  }
}

// A wavy but deterministic candle set, volumes varying — exercises warm-ups and direction flips.
const CLOSES = [10, 11, 13, 12, 14, 15, 13, 12, 14, 16, 17, 15, 14, 16, 18, 19, 17, 16, 18, 20, 21, 19, 18, 20, 22];
const CANDLES = CLOSES.map((c, i) => k(i * 60_000, c - 0.5, c + 1, c - 1.5, c, 100 + (i % 5) * 50));

describe('ta.* moving averages (pinned to @supercharts/indicators)', () => {
  it('hma / dema / tema match the package bar-for-bar', () => {
    const res = runScript(
      'draw line(ta.hma(close, 9), title: "h")\ndraw line(ta.dema(close, 9), title: "d")\ndraw line(ta.tema(close, 9), title: "t")',
      CANDLES,
    );
    expectSeries(vals(res, 'h'), hma(CLOSES, 9));
    expectSeries(vals(res, 'd'), dema(CLOSES, 9));
    expectSeries(vals(res, 't'), tema(CLOSES, 9));
  });

  it('vwma equals sma when volume is constant, and weights by volume otherwise', () => {
    const flat = series([10, 12, 14, 16]); // constant volume 100
    const res = runScript('draw line(ta.vwma(close, 3), title: "v")\ndraw line(ta.sma(close, 3), title: "s")', flat);
    for (let i = 2; i < 4; i++) expect(vals(res, 'v')[i]).toBeCloseTo(vals(res, 's')[i]!, 9);
    // hand case: closes 10,20 vols 100,300 → vwma2 = (10*100+20*300)/400 = 17.5
    const c2 = [k(0, 10, 11, 9, 10, 100), k(60_000, 20, 21, 19, 20, 300)];
    const res2 = runScript('draw line(ta.vwma(close, 2), title: "v")', c2);
    expect(vals(res2, 'v')[1]).toBeCloseTo(17.5, 9);
  });

  it('linreg of a perfectly linear series reproduces the line; swma is the fixed 4-bar kernel', () => {
    const lin = series([1, 2, 3, 4, 5, 6, 7, 8]);
    const res = runScript('draw line(ta.linreg(close, 5), title: "lr")\ndraw line(ta.swma(close), title: "sw")', lin);
    for (let i = 4; i < 8; i++) expect(vals(res, 'lr')[i]).toBeCloseTo(i + 1, 7); // fit endpoint = close
    // swma at i=3: (1*1 + 2*2 + 2*3 + 1*4)/6 = 15/6
    expect(vals(res, 'sw')[3]).toBeCloseTo(15 / 6, 9);
  });

  it('alma stays inside the window envelope and tracks a trend upward', () => {
    const res = runScript('draw line(ta.alma(close, 9, 0.85, 6), title: "a")', CANDLES);
    const a = vals(res, 'a');
    for (let i = 8; i < CLOSES.length; i++) {
      const win = CLOSES.slice(i - 8, i + 1);
      expect(a[i]!).toBeGreaterThanOrEqual(Math.min(...win) - 1e-9);
      expect(a[i]!).toBeLessThanOrEqual(Math.max(...win) + 1e-9);
    }
  });
});

describe('ta.* oscillators & stats', () => {
  it('variance is stdev² (same window convention)', () => {
    const res = runScript('draw line(ta.variance(close, 5), title: "v")', CANDLES);
    const sd = stdev(CLOSES, 5);
    for (let i = 4; i < CLOSES.length; i++) {
      if (Number.isFinite(sd[i]!)) expect(vals(res, 'v')[i]).toBeCloseTo(sd[i]! * sd[i]!, 6);
    }
  });

  it('median / percentRank / dev hand cases', () => {
    const res = runScript(
      'draw line(ta.median(close, 3), title: "m")\ndraw line(ta.percentRank(close, 5), title: "pr")\ndraw line(ta.dev(close, 3), title: "dv")',
      series([1, 9, 5, 3, 7]),
    );
    expect(vals(res, 'm')[2]).toBe(5); // median(1,9,5)
    expect(vals(res, 'm')[4]).toBe(5); // median(5,3,7)
    // percentRank at i=4 (window 1,9,5,3,7): of the 4 prior values, 3 are ≤ 7 → 75
    expect(vals(res, 'pr')[4]).toBe(75);
    // dev at i=2: mean(1,9,5)=5 → (4+4+0)/3
    expect(vals(res, 'dv')[2]).toBeCloseTo(8 / 3, 9);
  });

  it('cmo: all-up window → +100; tsi is bounded and positive in a steady uptrend', () => {
    const up = series([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    const res = runScript('draw line(ta.cmo(close, 5), title: "c")\ndraw line(ta.tsi(close, 3, 5), title: "t")', up);
    expect(vals(res, 'c')[10]).toBeCloseTo(100, 9);
    const t = vals(res, 't')[19]!;
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThanOrEqual(100);
  });

  it('roc & mom: hand math', () => {
    const res = runScript('draw line(ta.roc(close, 2), title: "r")\ndraw line(ta.mom(close, 2), title: "m")', series([10, 11, 12, 15]));
    expect(vals(res, 'r')[3]).toBeCloseTo((100 * (15 - 11)) / 11, 9);
    expect(vals(res, 'm')[3]).toBe(4);
  });

  it('cum / rolling sum', () => {
    const res = runScript('draw line(ta.cum(close), title: "c")\ndraw line(ta.sum(close, 3), title: "s")', series([1, 2, 3, 4]));
    expect(vals(res, 'c')).toEqual([1, 3, 6, 10]);
    expect(vals(res, 's')[3]).toBe(9);
  });

  it('correlation: +1 with itself, −1 against its negation', () => {
    const res = runScript(
      'draw line(ta.correlation(close, close, 5), title: "cp")\ndraw line(ta.correlation(close, 0 - close, 5), title: "cn")',
      CANDLES,
    );
    expect(vals(res, 'cp')[10]).toBeCloseTo(1, 9);
    expect(vals(res, 'cn')[10]).toBeCloseTo(-1, 9);
  });

  it('cog of a constant series is -(len+1)/2', () => {
    const res = runScript('draw line(ta.cog(close, 4), title: "g")', series([5, 5, 5, 5, 5, 5]));
    // weights 1..4 over equal prices → -(1+2+3+4)/4 = -2.5
    expect(vals(res, 'g')[5]).toBeCloseTo(-2.5, 9);
  });
});

describe('ta.* event/state helpers', () => {
  it('cross fires on either direction; since counts bars since true', () => {
    const src = [
      'let up = close > open',
      'draw line(ta.cross(close, open) ? 1 : 0, title: "x")',
      'draw line(nz(ta.since(up), -1), title: "s")',
    ].join('\n');
    const res = runScript(src, [
      k(0, 10, 11, 9, 11), // up (cross over: first bar = false by definition)
      k(60_000, 11, 12, 9, 10), // down → cross
      k(120_000, 10, 12, 9, 11), // up → cross
      k(180_000, 10, 12, 9, 11.5), // up stays
    ]);
    expect(vals(res, 'x')).toEqual([0, 1, 1, 0]);
    expect(vals(res, 's')).toEqual([0, 1, 0, 0]);
  });

  it('lastWhen picks the n-th most recent value where the condition held', () => {
    const src = 'draw line(nz(ta.lastWhen(close > open, close, 0), -1), title: "w0")\ndraw line(nz(ta.lastWhen(close > open, close, 1), -1), title: "w1")';
    const res = runScript(src, [
      k(0, 10, 12, 9, 11), // up → close 11
      k(60_000, 11, 12, 9, 10), // down
      k(120_000, 10, 13, 9, 12), // up → close 12
      k(180_000, 12, 13, 9, 11), // down
    ]);
    expect(vals(res, 'w0')).toEqual([11, 11, 12, 12]);
    expect(vals(res, 'w1')).toEqual([-1, -1, 11, 11]);
  });

  it('hold carries the last finite value (fix-the-gaps)', () => {
    // pivotHigh is none on most bars — hold() turns it into a steppy level line.
    const src = 'let ph = ta.pivotHigh(high, 1, 1)\ndraw line(nz(ta.hold(ph), -1), title: "lvl")';
    const res = runScript(src, [
      k(0, 10, 11, 9, 10),
      k(60_000, 10, 15, 9, 14), // pivot high 15 (confirmed at bar 2)
      k(120_000, 14, 13.5, 9, 10),
      k(180_000, 10, 12, 9, 11),
    ]);
    expect(vals(res, 'lvl')).toEqual([-1, -1, 15, 15]);
  });

  it('pivotHigh/pivotLow appear on the confirmation bar only (no repaint)', () => {
    const candles = [
      k(0, 10, 12, 8, 10),
      k(60_000, 10, 16, 9, 14),
      k(120_000, 14, 13, 7, 9), // low 7 → pivot low candidate
      k(180_000, 9, 14, 8, 12),
      k(240_000, 12, 15, 10, 13),
    ];
    const res = runScript('draw line(nz(ta.pivotHigh(high, 1, 1), -1), title: "ph")\ndraw line(nz(ta.pivotLow(low, 1, 2), -1), title: "pl")', candles);
    expect(vals(res, 'ph')).toEqual([-1, -1, 16, -1, -1]); // high 16 at bar 1, confirmed at bar 2
    expect(vals(res, 'pl')).toEqual([-1, -1, -1, -1, 7]); // low 7 at bar 2, right=2 → bar 4
  });

  it('sinceHighest/sinceLowest give bars-ago of the window extreme', () => {
    const res = runScript('draw line(ta.sinceHighest(close, 3), title: "sh")\ndraw line(ta.sinceLowest(close, 3), title: "sl")', series([5, 9, 7, 6, 8]));
    expect(vals(res, 'sh')[2]).toBe(1); // window 5,9,7 → 9 is 1 bar ago
    expect(vals(res, 'sh')[4]).toBe(0); // window 7,6,8 → 8 is current
    expect(vals(res, 'sl')[3]).toBe(0); // window 9,7,6 → 6 is current
  });
});

describe('ta.* candle-based studies (pinned to @supercharts/indicators)', () => {
  it('cci / mfi / willr / obv / cmf / sar match the package', () => {
    const src = [
      'draw line(ta.cci(14), title: "cci")',
      'draw line(ta.mfi(10), title: "mfi")',
      'draw line(ta.willr(10), title: "wr")',
      'draw line(ta.obv(), title: "obv")',
      'draw line(ta.cmf(10), title: "cmf")',
      'draw line(ta.sar(0.02, 0.02, 0.2), title: "sar")',
    ].join('\n');
    const res = runScript(src, CANDLES);
    expectSeries(vals(res, 'cci'), cci(CANDLES, { length: 14 }));
    expectSeries(vals(res, 'mfi'), mfi(CANDLES, { length: 10 }));
    expectSeries(vals(res, 'wr'), williamsR(CANDLES, { length: 10 }));
    expectSeries(vals(res, 'obv'), obv(CANDLES));
    expectSeries(vals(res, 'cmf'), cmf(CANDLES, { length: 10 }));
    expectSeries(vals(res, 'sar'), psar(CANDLES, { start: 0.02, step: 0.02, max: 0.2 }));
  });
});

describe('ta.* multi-output records', () => {
  it('bands(BB) fields match the package and order upper ≥ mid ≥ lower', () => {
    const src = [
      'let b = ta.bands(10, 2)',
      'draw line(b.upper, title: "u")',
      'draw line(b.mid, title: "m")',
      'draw line(b.lower, title: "l")',
      'draw line(b.pctB, title: "pb")',
    ].join('\n');
    const res = runScript(src, CANDLES);
    const ref = bollinger(CANDLES, { length: 10, multiplier: 2 });
    expectSeries(vals(res, 'u'), ref.upper);
    expectSeries(vals(res, 'm'), ref.middle);
    expectSeries(vals(res, 'l'), ref.lower);
    expectSeries(vals(res, 'pb'), ref.percentB);
    for (let i = 9; i < CLOSES.length; i++) {
      expect(vals(res, 'u')[i]!).toBeGreaterThanOrEqual(vals(res, 'm')[i]!);
      expect(vals(res, 'm')[i]!).toBeGreaterThanOrEqual(vals(res, 'l')[i]!);
    }
  });

  it('channel(Keltner) / donchian / dmi / aroon fields match the package', () => {
    const src = [
      'draw line(ta.channel(10, 5, 2).upper, title: "ku")',
      'draw line(ta.donchian(10).mid, title: "dm")',
      'draw line(ta.dmi(7).adx, title: "adx")',
      'draw line(ta.dmi(7).plus, title: "dip")',
      'draw line(ta.aroon(7).up, title: "au")',
    ].join('\n');
    const res = runScript(src, CANDLES);
    expectSeries(vals(res, 'ku'), keltner(CANDLES, { emaLength: 10, atrLength: 5, multiplier: 2 }).upper);
    expectSeries(vals(res, 'dm'), donchian(CANDLES, { length: 10 }).middle);
    expectSeries(vals(res, 'adx'), adx(CANDLES, { length: 7 }).adx);
    expectSeries(vals(res, 'dip'), adx(CANDLES, { length: 7 }).plusDI);
    expectSeries(vals(res, 'au'), aroon(CANDLES, { length: 7 }).up);
  });

  it('supertrend / ichimoku / macdFull / stochFull fields match the package', () => {
    const src = [
      'let st = ta.supertrend(3, 7)',
      'draw line(st.line, title: "stl")',
      'draw line(st.dir, title: "std")',
      'draw line(ta.ichimoku(3, 5, 8).conversion, title: "ic")',
      'let m = ta.macdFull(5, 8, 3)',
      'draw line(m.line, title: "ml")',
      'draw line(m.signal, title: "ms")',
      'draw line(m.histo, title: "mh")',
      'draw line(ta.stochFull(5, 3, 3).d, title: "sd")',
    ].join('\n');
    const res = runScript(src, CANDLES);
    const st = supertrend(CANDLES, { multiplier: 3, atrLength: 7 });
    expectSeries(vals(res, 'stl'), st.line);
    expectSeries(vals(res, 'std'), st.direction);
    expectSeries(vals(res, 'ic'), ichimoku(CANDLES, { conversion: 3, base: 5, spanB: 8 }).conversion);
    const m = macd(CANDLES, { fast: 5, slow: 8, signal: 3 });
    expectSeries(vals(res, 'ml'), m.macd);
    expectSeries(vals(res, 'ms'), m.signal);
    expectSeries(vals(res, 'mh'), m.histogram);
    expectSeries(vals(res, 'sd'), stochastic(CANDLES, { kLength: 5, kSmooth: 3, dSmooth: 3 }).d);
  });

  it('record history works: bands(...).upper[1] equals the prior bar value', () => {
    const src = 'let b = ta.bands(5, 2)\ndraw line(nz(b.upper[1], -1), title: "u1")\ndraw line(nz(b.upper, -1), title: "u0")';
    const res = runScript(src, CANDLES);
    const u0 = vals(res, 'u0');
    const u1 = vals(res, 'u1');
    for (let i = 6; i < CLOSES.length; i++) expect(u1[i]).toBeCloseTo(u0[i - 1]!, 9);
  });

  it('a wrong field name lists the real fields', () => {
    expect(() => runScript('let x = ta.bands(5, 2).top', CANDLES)).toThrowError(/fields: upper, mid, lower/);
  });
});

describe('math.* expansion', () => {
  it('trig, log10, clamp, round(x, decimals), constants', () => {
    const src = [
      'draw line(math.sin(math.pi / 2), title: "s")',
      'draw line(math.log10(1000), title: "lg")',
      'draw line(math.clamp(15, 0, 10), title: "cl")',
      'draw line(math.round(3.14159, 2), title: "r2")',
      'draw line(math.atan2(1, 1), title: "a2")',
      'draw line(math.toDegrees(math.pi), title: "dg")',
      'draw line(math.e, title: "e")',
    ].join('\n');
    const res = runScript(src, series([1]));
    expect(vals(res, 's')[0]).toBeCloseTo(1, 12);
    expect(vals(res, 'lg')[0]).toBeCloseTo(3, 12);
    expect(vals(res, 'cl')[0]).toBe(10);
    expect(vals(res, 'r2')[0]).toBeCloseTo(3.14, 12);
    expect(vals(res, 'a2')[0]).toBeCloseTo(Math.PI / 4, 12);
    expect(vals(res, 'dg')[0]).toBeCloseTo(180, 12);
    expect(vals(res, 'e')[0]).toBeCloseTo(Math.E, 12);
  });

  it('new ta functions are bare-callable too (hma, cross)', () => {
    // CLOSES is wavy, so close crosses its own 3-bar SMA repeatedly.
    const res = runScript('draw line(hma(close, 5), title: "h")\ndraw line(cross(close, sma(close, 3)) ? 1 : 0, title: "x")', CANDLES);
    expectSeries(vals(res, 'h'), hma(CLOSES, 5));
    expect(vals(res, 'x').some((v) => v === 1)).toBe(true);
  });
});
