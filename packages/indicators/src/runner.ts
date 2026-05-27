/**
 * Indicator runner. Given a list of `IndicatorRef`s and a candle array,
 * computes each requested channel and returns a map keyed by
 * `${indicatorId}.${channel}`. Used by the signal recipe evaluator and the
 * browser chart layer.
 *
 * Each `IndicatorRef.id` is the user-assigned `IndicatorInstance.id`. The
 * server stores per-pane indicator lists with that id, so the runner can
 * look up the type and inputs from a separate metadata map. For the live
 * server we pass the metadata directly when we have it; for cases where
 * only the id+channel are known the runner falls back to default inputs.
 */

import type { Candle, IndicatorInstance } from '@supercharts/types';
import { sma, ema, wma, hma, dema, tema, type PriceSource } from './ma';
import { rsi, macd, stochastic, williamsR, cci, mfi, roc } from './oscillators';
import { atr, bollinger, keltner, donchian } from './volatility';
import { adx, supertrend, psar, ichimoku, aroon } from './trend';
import { vwap, obv, cmf, volumeOscillator } from './volume';
import { INDICATOR_LOOKUP } from './registry';

export interface IndicatorRef {
  id: string;
  channel: string;
}

interface RunnerMetadata {
  /** Maps an indicator id to its definition. */
  byId: Map<string, IndicatorInstance>;
}

let activeMeta: RunnerMetadata | null = null;

/** Provide metadata for the next runner pass. */
export function setIndicatorMetadata(instances: IndicatorInstance[]): void {
  const map = new Map<string, IndicatorInstance>();
  for (const inst of instances) map.set(inst.id, inst);
  activeMeta = { byId: map };
}

export function computeIndicatorChannel(
  candles: Candle[],
  refs: IndicatorRef[],
): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const computedFor = new Set<string>();
  for (const ref of refs) {
    if (computedFor.has(ref.id)) continue;
    computedFor.add(ref.id);
    const meta = activeMeta?.byId.get(ref.id);
    const type = (meta?.type ?? ref.id).toLowerCase();
    const inputs = (meta?.inputs ?? {}) as Record<string, number | string | boolean>;
    const spec = INDICATOR_LOOKUP[type];
    const effectiveInputs = spec
      ? Object.fromEntries(spec.inputs.map((i) => [i.key, inputs[i.key] ?? i.default]))
      : inputs;
    const channels = computeAll(type, candles, effectiveInputs);
    for (const [channel, values] of channels) {
      out.set(`${ref.id}.${channel}`, values);
    }
  }
  return out;
}

export function computeAll(
  type: string,
  candles: Candle[],
  inputs: Record<string, number | string | boolean>,
): Map<string, number[]> {
  const empty = new Map<string, number[]>();
  switch (type) {
    case 'sma': {
      const len = numberInput(inputs.length, 20);
      const src = (inputs.source as PriceSource) ?? 'close';
      return single('value', sma(candles.map((c) => priceField(c, src)), len));
    }
    case 'ema': {
      const len = numberInput(inputs.length, 21);
      const src = (inputs.source as PriceSource) ?? 'close';
      return single('value', ema(candles.map((c) => priceField(c, src)), len));
    }
    case 'wma': {
      const len = numberInput(inputs.length, 20);
      const src = (inputs.source as PriceSource) ?? 'close';
      return single('value', wma(candles.map((c) => priceField(c, src)), len));
    }
    case 'hma': {
      const len = numberInput(inputs.length, 21);
      const src = (inputs.source as PriceSource) ?? 'close';
      return single('value', hma(candles.map((c) => priceField(c, src)), len));
    }
    case 'dema': {
      const len = numberInput(inputs.length, 21);
      const src = (inputs.source as PriceSource) ?? 'close';
      return single('value', dema(candles.map((c) => priceField(c, src)), len));
    }
    case 'tema': {
      const len = numberInput(inputs.length, 21);
      const src = (inputs.source as PriceSource) ?? 'close';
      return single('value', tema(candles.map((c) => priceField(c, src)), len));
    }
    case 'rsi':
      return single(
        'value',
        rsi(candles, {
          length: numberInput(inputs.length, 14),
          source: (inputs.source as PriceSource) ?? 'close',
        }),
      );
    case 'macd': {
      const frame = macd(candles, {
        fast: numberInput(inputs.fast, 12),
        slow: numberInput(inputs.slow, 26),
        signal: numberInput(inputs.signal, 9),
        source: (inputs.source as PriceSource) ?? 'close',
      });
      return new Map<string, number[]>([
        ['macd', frame.macd],
        ['signal', frame.signal],
        ['histogram', frame.histogram],
      ]);
    }
    case 'stochastic': {
      const frame = stochastic(candles, {
        kLength: numberInput(inputs.kLength, 14),
        kSmooth: numberInput(inputs.kSmooth, 3),
        dSmooth: numberInput(inputs.dSmooth, 3),
      });
      return new Map<string, number[]>([
        ['k', frame.k],
        ['d', frame.d],
      ]);
    }
    case 'williams_r':
      return single('value', williamsR(candles, { length: numberInput(inputs.length, 14) }));
    case 'cci':
      return single('value', cci(candles, { length: numberInput(inputs.length, 20) }));
    case 'mfi':
      return single('value', mfi(candles, { length: numberInput(inputs.length, 14) }));
    case 'roc':
      return single(
        'value',
        roc(candles, {
          length: numberInput(inputs.length, 9),
          source: (inputs.source as PriceSource) ?? 'close',
        }),
      );
    case 'atr':
      return single(
        'value',
        atr(candles, {
          length: numberInput(inputs.length, 14),
          smoothing: (inputs.smoothing as 'rma' | 'sma' | 'ema') ?? 'rma',
        }),
      );
    case 'bollinger': {
      const frame = bollinger(candles, {
        length: numberInput(inputs.length, 20),
        multiplier: numberInput(inputs.multiplier, 2),
      });
      return new Map<string, number[]>([
        ['middle', frame.middle],
        ['upper', frame.upper],
        ['lower', frame.lower],
        ['bandwidth', frame.bandwidth],
        ['percentB', frame.percentB],
      ]);
    }
    case 'keltner': {
      const frame = keltner(candles, {
        emaLength: numberInput(inputs.emaLength, 20),
        atrLength: numberInput(inputs.atrLength, 10),
        multiplier: numberInput(inputs.multiplier, 2),
      });
      return new Map<string, number[]>([
        ['middle', frame.middle],
        ['upper', frame.upper],
        ['lower', frame.lower],
      ]);
    }
    case 'donchian': {
      const frame = donchian(candles, { length: numberInput(inputs.length, 20) });
      return new Map<string, number[]>([
        ['upper', frame.upper],
        ['lower', frame.lower],
        ['middle', frame.middle],
      ]);
    }
    case 'adx': {
      const frame = adx(candles, { length: numberInput(inputs.length, 14) });
      return new Map<string, number[]>([
        ['adx', frame.adx],
        ['plusDI', frame.plusDI],
        ['minusDI', frame.minusDI],
      ]);
    }
    case 'supertrend': {
      const frame = supertrend(candles, {
        atrLength: numberInput(inputs.atrLength, 10),
        multiplier: numberInput(inputs.multiplier, 3),
      });
      return new Map<string, number[]>([
        ['line', frame.line],
        ['direction', frame.direction],
      ]);
    }
    case 'psar':
      return single(
        'value',
        psar(candles, {
          start: numberInput(inputs.start, 0.02),
          step: numberInput(inputs.step, 0.02),
          max: numberInput(inputs.max, 0.2),
        }),
      );
    case 'ichimoku': {
      const frame = ichimoku(candles, {
        conversion: numberInput(inputs.conversion, 9),
        base: numberInput(inputs.base, 26),
        spanB: numberInput(inputs.spanB, 52),
        displacement: numberInput(inputs.displacement, 26),
      });
      return new Map<string, number[]>([
        ['conversion', frame.conversion],
        ['base', frame.base],
        ['spanA', frame.spanA],
        ['spanB', frame.spanB],
        ['lagging', frame.lagging],
      ]);
    }
    case 'aroon': {
      const frame = aroon(candles, { length: numberInput(inputs.length, 14) });
      return new Map<string, number[]>([
        ['up', frame.up],
        ['down', frame.down],
        ['oscillator', frame.oscillator],
      ]);
    }
    case 'vwap':
      return single(
        'value',
        vwap(candles, { mode: (inputs.mode as 'session' | 'cumulative') ?? 'session' }),
      );
    case 'obv':
      return single('value', obv(candles));
    case 'cmf':
      return single('value', cmf(candles, { length: numberInput(inputs.length, 20) }));
    case 'volume_oscillator':
      return single(
        'value',
        volumeOscillator(candles, {
          shortLength: numberInput(inputs.shortLength, 5),
          longLength: numberInput(inputs.longLength, 20),
        }),
      );
  }
  return empty;
}

function single(channel: string, values: number[]): Map<string, number[]> {
  return new Map([[channel, values]]);
}

function numberInput(v: unknown, fallback: number): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.length > 0) {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

function priceField(c: Candle, source: PriceSource): number {
  switch (source) {
    case 'open':  return c.open;
    case 'high':  return c.high;
    case 'low':   return c.low;
    case 'close': return c.close;
    case 'hl2':   return (c.high + c.low) / 2;
    case 'hlc3':  return (c.high + c.low + c.close) / 3;
    case 'ohlc4': return (c.open + c.high + c.low + c.close) / 4;
  }
}
