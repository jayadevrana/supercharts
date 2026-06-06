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
  Interval,
  OrderIntent,
  SignalAction,
  SignalRecipe,
} from '@supercharts/types';
import type { IngestionContext } from '@supercharts/ingestion';
import type { IntentRouter } from './intents';
import type { MT5Store } from './state';
import { collectIndicatorRefs, evaluateConditionSet } from '../signal-eval';

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
  /** Max-drawdown breaker: when it returns true, recipes evaluate but never dispatch. */
  shouldHalt?: () => boolean;
}): SignalRunner {
  const { ingestion, router, store, shouldHalt } = opts;
  const active = new Map<string, RecipeRuntime>();

  // Condition evaluation lives in the shared `../signal-eval` module so an MT5 recipe and an
  // indicator-driven alert agree bit-for-bit.

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
    const refs = collectIndicatorRefs(recipe.conditions);
    const off = ingestion.bus.onSymbol('candle', recipe.symbol, (e) => {
      if (!recipe.enabled) return;
      if (e.data.interval !== (recipe.interval as Interval)) return;
      if (!e.data.isClosed) return;
      // Max-drawdown breaker — halt new automation when the day's loss limit is breached.
      if (shouldHalt?.()) return;
      const bars = ingestion.candleStore.query(
        recipe.symbol,
        recipe.interval as Interval,
        undefined,
        undefined,
        500,
      );
      if (!evaluateConditionSet(recipe.conditions, recipe.logic, bars, refs, recipe.indicatorSpecs)) return;
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

function startOfUtcDay(ts: number): number {
  const d = new Date(ts);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}
