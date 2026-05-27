/**
 * Signal recipe runtime. A recipe is a list of conditions plus a list of
 * actions. The runner subscribes to candle updates on the recipe's symbol +
 * interval, evaluates the conditions on each closed bar, and dispatches the
 * actions via the intent router.
 *
 * Indicators referenced in conditions are computed on the fly using the
 * `@supercharts/indicators` package. The runner caches the last value per
 * indicator + bar so cross-condition references hit the same series.
 */

import { nanoid } from 'nanoid';
import type {
  Candle,
  Interval,
  OrderIntent,
  SignalAction,
  SignalCondition,
  SignalRecipe,
} from '@supercharts/types';
import type { IngestionContext } from '@supercharts/ingestion';
import type { IntentRouter } from './intents';
import type { MT5Store } from './state';
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

interface RecipeRuntime {
  recipe: SignalRecipe;
  lastFireAt: number;
  firesToday: number;
  /** Number of currently-open positions tagged with this recipe. */
  openPositions: number;
  off?: () => void;
}

export interface SignalRunner {
  load: (recipes: SignalRecipe[]) => void;
  upsert: (recipe: SignalRecipe) => void;
  remove: (recipeId: string) => void;
  shutdown: () => void;
}

export function createSignalRunner(opts: {
  ingestion: IngestionContext;
  router: IntentRouter;
  store: MT5Store;
}): SignalRunner {
  const { ingestion, router, store } = opts;
  const active = new Map<string, RecipeRuntime>();

  function indicatorRefs(recipe: SignalRecipe): IndicatorRef[] {
    const refs: IndicatorRef[] = [];
    const pushFromCondition = (c: SignalCondition): void => {
      if (c.type === 'indicator_compare') {
        refs.push({ id: c.indicator, channel: c.channel });
        if (c.right.kind === 'indicator') {
          refs.push({ id: c.right.indicator, channel: c.right.channel });
        }
      } else if (c.type === 'price_crosses' && c.target.kind === 'indicator') {
        refs.push({ id: c.target.indicator, channel: c.target.channel });
      }
    };
    for (const c of recipe.conditions) pushFromCondition(c);
    return refs;
  }

  function evaluateConditions(
    recipe: SignalRecipe,
    bars: Candle[],
    refs: IndicatorRef[],
  ): boolean {
    if (bars.length < 2) return false;
    // Recipes built by the bulk-subscribe flow always carry explicit indicator specs
    // (e.g. EMA length=20). Without metadata, the runner falls back to indicator
    // defaults (EMA length=21), which would silently disagree with what the user
    // configured. We push the recipe's specs into the runner's metadata for this pass.
    if (recipe.indicatorSpecs && recipe.indicatorSpecs.length > 0) {
      setIndicatorMetadata(recipe.indicatorSpecs);
    }
    const ind = computeIndicatorChannel(bars, refs);
    const cur = bars.length - 1;
    const prev = bars.length - 2;
    const checks = recipe.conditions.map((c) => evaluateCondition(c, bars, ind, cur, prev));
    return recipe.logic === 'all' ? checks.every(Boolean) : checks.some(Boolean);
  }

  function evaluateCondition(
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
        const ts = bars[cur]!.openTime;
        return inSession(c.name, ts);
      }
      case 'time_window': {
        const ts = bars[cur]!.openTime;
        return inTimeWindow(c.from, c.to, c.days, ts);
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

  function dispatchActions(runtime: RecipeRuntime): void {
    const { recipe } = runtime;
    for (const action of recipe.actions) {
      runAction(recipe, action);
    }
  }

  function runAction(recipe: SignalRecipe, action: SignalAction): void {
    switch (action.type) {
      case 'open_position': {
        const intent: OrderIntent = {
          accountId: recipe.accountId,
          symbol: recipe.symbol,
          side: action.side,
          kind: action.kind,
          sizing: action.sizing,
          sl: action.sl,
          tp: action.tp,
          partials: action.partials,
          trailing: action.trailing,
          breakEven: action.breakEven,
          comment: `recipe:${recipe.id}`,
          recipeId: recipe.id,
        };
        router.submit(recipe.accountId, intent);
        return;
      }
      case 'close_all': {
        const positions = store.positionsForUser(recipe.userId, recipe.accountId);
        for (const p of positions) {
          if (action.filter?.side && p.side !== action.filter.side) continue;
          if (action.filter?.recipeId && p.recipeId !== action.filter.recipeId) continue;
          router.closePosition(recipe.accountId, p.id, 1);
        }
        return;
      }
      case 'partial_close': {
        const positions = store.positionsForUser(recipe.userId, recipe.accountId);
        for (const p of positions) {
          if (action.filter?.side && p.side !== action.filter.side) continue;
          if (action.filter?.recipeId && p.recipeId !== action.filter.recipeId) continue;
          router.closePosition(recipe.accountId, p.id, action.fraction);
        }
        return;
      }
      case 'move_sl': {
        const positions = store.positionsForUser(recipe.userId, recipe.accountId);
        for (const p of positions) {
          if (action.filter?.side && p.side !== action.filter.side) continue;
          if (action.filter?.recipeId && p.recipeId !== action.filter.recipeId) continue;
          const tick = store.account(recipe.accountId)?.ticks.get(p.symbol);
          if (!tick) continue;
          let newSl = p.sl;
          if (action.mode === 'breakeven') newSl = p.openPrice;
          else if (action.mode === 'price' && action.price) newSl = action.price;
          else if (action.mode === 'pips_from_entry' && action.pips != null) {
            newSl = p.side === 'buy'
              ? p.openPrice + action.pips * 0.0001
              : p.openPrice - action.pips * 0.0001;
          } else if (action.mode === 'pips_from_current' && action.pips != null) {
            const ref = p.side === 'buy' ? tick.bid : tick.ask;
            newSl = p.side === 'buy' ? ref - action.pips * 0.0001 : ref + action.pips * 0.0001;
          }
          router.modifyPosition(recipe.accountId, p.id, newSl, p.tp);
        }
        return;
      }
      case 'set_trailing': {
        // Trailing modifications are propagated by ingesting a new plan into the
        // intent router. We piggy-back on `modify` with the new SL when each
        // tick arrives; the router watches subsequent ticks via its trailing map.
        // For brevity here, treat set_trailing as no-op when no fresh open is
        // happening. Users should attach trailing on the original intent.
        return;
      }
    }
  }

  function attach(recipe: SignalRecipe): RecipeRuntime {
    const runtime: RecipeRuntime = {
      recipe,
      lastFireAt: 0,
      firesToday: 0,
      openPositions: 0,
    };
    const refs = indicatorRefs(recipe);
    const off = ingestion.bus.onSymbol('candle', recipe.symbol, (e) => {
      if (!recipe.enabled) return;
      if (e.data.interval !== (recipe.interval as Interval)) return;
      if (!e.data.isClosed) return;
      const bars = ingestion.candleStore.query(
        recipe.symbol,
        recipe.interval as Interval,
        undefined,
        undefined,
        500,
      );
      if (!evaluateConditions(recipe, bars, refs)) return;
      const today = startOfUtcDay(Date.now());
      if (runtime.lastFireAt < today) runtime.firesToday = 0;
      if (recipe.maxTradesPerDay && runtime.firesToday >= recipe.maxTradesPerDay) return;
      runtime.lastFireAt = Date.now();
      runtime.firesToday += 1;
      dispatchActions(runtime);
    });
    runtime.off = off;
    void nanoid; // reserved for future deduplication keys
    return runtime;
  }

  return {
    load(recipes) {
      for (const recipe of recipes) {
        const existing = active.get(recipe.id);
        if (existing) existing.off?.();
        active.set(recipe.id, attach(recipe));
      }
    },
    upsert(recipe) {
      const existing = active.get(recipe.id);
      if (existing) existing.off?.();
      active.set(recipe.id, attach(recipe));
    },
    remove(recipeId) {
      const existing = active.get(recipeId);
      if (existing) existing.off?.();
      active.delete(recipeId);
    },
    shutdown() {
      for (const r of active.values()) r.off?.();
      active.clear();
    },
  };
}

function inSession(name: SignalCondition extends { type: 'session' } ? never : never | string, ts: number): boolean {
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

function inTimeWindow(from: string, to: string, days: number[], ts: number): boolean {
  const d = new Date(ts);
  if (!days.includes(d.getUTCDay())) return false;
  const cur = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
  const parse = (s: string) => {
    const [h, m, sec] = s.split(':').map(Number);
    return (h ?? 0) * 3600 + (m ?? 0) * 60 + (sec ?? 0);
  };
  const f = parse(from);
  const t = parse(to);
  if (f <= t) return cur >= f && cur <= t;
  return cur >= f || cur <= t;
}

function startOfUtcDay(ts: number): number {
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}
