/**
 * Shared signal-condition evaluator.
 *
 * The MT5 SignalRunner and the indicator-alert path in the AlertEngine both need to evaluate the
 * same `SignalCondition` union (indicator_compare / price_crosses / session / time_window /
 * pattern) on a closed-bar window. This module is the single pure implementation both import, so
 * an alert and a strategy recipe agree bit-for-bit. All TA/math comes from @supercharts/indicators.
 */

import type { Candle, IndicatorInstance, SignalCondition, SignalConditionLogic } from '@supercharts/types';
import {
  computeIndicatorChannel,
  setIndicatorMetadata,
  type IndicatorRef,
} from '@supercharts/indicators/runner';
import {
  detectBullishEngulfing,
  detectBearishEngulfing,
  detectHammer,
  detectShootingStar,
  detectInsideBar,
  detectOutsideBar,
  detectPinBarBull,
  detectPinBarBear,
} from '@supercharts/indicators/patterns';

export type { IndicatorRef };

/** Collect every indicator (id, channel) a condition list references, so the runner computes them once. */
export function collectIndicatorRefs(conditions: SignalCondition[]): IndicatorRef[] {
  const refs: IndicatorRef[] = [];
  for (const c of conditions) {
    if (c.type === 'indicator_compare') {
      refs.push({ id: c.indicator, channel: c.channel });
      if (c.right.kind === 'indicator') {
        refs.push({ id: c.right.indicator, channel: c.right.channel });
      }
    } else if (c.type === 'price_crosses' && c.target.kind === 'indicator') {
      refs.push({ id: c.target.indicator, channel: c.target.channel });
    }
  }
  return refs;
}

/**
 * Evaluate ALL/ANY of a condition set on the latest closed bar of `bars`. `indicatorSpecs`, when
 * provided, are pushed into the indicator runner's metadata so user-tuned params take effect
 * (otherwise the runner falls back to registry defaults). Pure — no side effects beyond the
 * runner's metadata cache.
 */
export function evaluateConditionSet(
  conditions: SignalCondition[],
  logic: SignalConditionLogic,
  bars: Candle[],
  refs: IndicatorRef[],
  indicatorSpecs?: IndicatorInstance[],
): boolean {
  if (bars.length < 2) return false;
  if (indicatorSpecs && indicatorSpecs.length > 0) {
    setIndicatorMetadata(indicatorSpecs);
  }
  const ind = computeIndicatorChannel(bars, refs);
  const cur = bars.length - 1;
  const prev = bars.length - 2;
  const checks = conditions.map((c) => evaluateCondition(c, bars, ind, cur, prev));
  return logic === 'all' ? checks.every(Boolean) : checks.some(Boolean);
}

/** Evaluate a single condition against precomputed indicator channels. */
export function evaluateCondition(
  c: SignalCondition,
  bars: Candle[],
  ind: Map<string, number[]>,
  cur: number,
  prev: number,
): boolean {
  switch (c.type) {
    case 'indicator_compare': {
      const left = ind.get(`${c.indicator}.${c.channel}`)?.[cur];
      if (left == null || Number.isNaN(left)) return false;
      const rightVal = (() => {
        if (c.right.kind === 'constant') return c.right.value;
        if (c.right.kind === 'price') return bars[cur]![c.right.field];
        return ind.get(`${c.right.indicator}.${c.right.channel}`)?.[cur];
      })();
      const leftPrev = ind.get(`${c.indicator}.${c.channel}`)?.[prev];
      const rightPrev = (() => {
        if (c.right.kind === 'constant') return c.right.value;
        if (c.right.kind === 'price') return bars[prev]![c.right.field];
        return ind.get(`${c.right.indicator}.${c.right.channel}`)?.[prev];
      })();
      if (rightVal == null || Number.isNaN(rightVal)) return false;
      switch (c.operator) {
        case '>':  return left > rightVal;
        case '<':  return left < rightVal;
        case '>=': return left >= rightVal;
        case '<=': return left <= rightVal;
        case '==': return left === rightVal;
        case 'crosses_above':
          return leftPrev != null && rightPrev != null && leftPrev <= rightPrev && left > rightVal;
        case 'crosses_below':
          return leftPrev != null && rightPrev != null && leftPrev >= rightPrev && left < rightVal;
      }
      return false;
    }
    case 'price_crosses': {
      const left = bars[cur]![c.source];
      const leftPrev = bars[prev]![c.source];
      const right =
        c.target.kind === 'constant'
          ? c.target.value
          : ind.get(`${c.target.indicator}.${c.target.channel}`)?.[cur];
      const rightPrev =
        c.target.kind === 'constant'
          ? c.target.value
          : ind.get(`${c.target.indicator}.${c.target.channel}`)?.[prev];
      if (right == null || rightPrev == null) return false;
      return c.operator === 'crosses_above'
        ? leftPrev <= rightPrev && left > right
        : leftPrev >= rightPrev && left < right;
    }
    case 'session': {
      return inSession(c.name, bars[cur]!.openTime);
    }
    case 'time_window': {
      return inTimeWindow(c.from, c.to, c.days, bars[cur]!.openTime);
    }
    case 'pattern': {
      const win = bars.slice(-5);
      switch (c.kind) {
        case 'bullish_engulfing': return detectBullishEngulfing(win);
        case 'bearish_engulfing': return detectBearishEngulfing(win);
        case 'hammer':            return detectHammer(win);
        case 'shooting_star':     return detectShootingStar(win);
        case 'inside_bar':        return detectInsideBar(win);
        case 'outside_bar':       return detectOutsideBar(win);
        case 'pin_bar_bull':      return detectPinBarBull(win);
        case 'pin_bar_bear':      return detectPinBarBear(win);
      }
      return false;
    }
  }
}

export function inSession(name: string, ts: number): boolean {
  const d = new Date(ts);
  const utcHour = d.getUTCHours() + d.getUTCMinutes() / 60;
  switch (name) {
    case 'sydney':  return utcHour >= 22 || utcHour < 7;
    case 'tokyo':   return utcHour >= 0 && utcHour < 9;
    case 'london':  return utcHour >= 7 && utcHour < 16;
    case 'newyork': return utcHour >= 12 && utcHour < 21;
    case 'overlap_london_newyork': return utcHour >= 12 && utcHour < 16;
    default:        return false;
  }
}

export function inTimeWindow(from: string, to: string, days: number[], ts: number): boolean {
  const d = new Date(ts);
  if (!days.includes(d.getUTCDay())) return false;
  const cur = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
  const parse = (s: string): number => {
    const [h, m, sec] = s.split(':').map(Number);
    return (h ?? 0) * 3600 + (m ?? 0) * 60 + (sec ?? 0);
  };
  const f = parse(from);
  const t = parse(to);
  if (f <= t) return cur >= f && cur <= t;
  return cur >= f || cur <= t;
}
