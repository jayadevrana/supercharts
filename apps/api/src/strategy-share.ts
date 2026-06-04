import type { SignalRecipe, SignalAction } from '@supercharts/types';

/**
 * Public strategy share sanitization (Phase 4 #16).
 *
 * A shared strategy snapshot describes the STRATEGY — its symbol, timeframe, entry rules and
 * actions — and nothing about who owns it. This pure function is the single trust boundary:
 * it allow-lists the safe fields and never copies the owner id, the MT5 account id, enabled
 * state, or internal recipe ids. Unit-tested so a future field can't silently leak.
 */

export interface SharedStrategy {
  name: string;
  symbol: string;
  interval: string;
  logic: SignalRecipe['logic'];
  conditions: SignalRecipe['conditions'];
  actions: SignalRecipe['actions'];
  indicatorSpecs: NonNullable<SignalRecipe['indicatorSpecs']>;
  maxTradesPerDay?: number;
  maxDailyDrawdownPercent?: number;
}

/** A recipe as it can be loaded from the DB row (payload already merged in). */
export type ShareableRecipe = Pick<
  SignalRecipe,
  'name' | 'symbol' | 'interval' | 'logic' | 'conditions' | 'actions'
> &
  Partial<Pick<SignalRecipe, 'indicatorSpecs' | 'maxTradesPerDay' | 'maxDailyDrawdownPercent'>>;

/** Drop owner-scoped references (e.g. a `recipeId` filter) from an action. */
function stripActionRefs(action: SignalAction): SignalAction {
  if ('filter' in action && action.filter && typeof action.filter === 'object') {
    const { recipeId: _drop, ...rest } = action.filter as { recipeId?: string };
    return { ...action, filter: rest };
  }
  return action;
}

export function sanitizeStrategyForShare(recipe: ShareableRecipe): SharedStrategy {
  return {
    name: recipe.name,
    symbol: recipe.symbol,
    interval: recipe.interval,
    logic: recipe.logic,
    conditions: recipe.conditions ?? [],
    actions: (recipe.actions ?? []).map(stripActionRefs),
    indicatorSpecs: recipe.indicatorSpecs ?? [],
    ...(recipe.maxTradesPerDay != null ? { maxTradesPerDay: recipe.maxTradesPerDay } : {}),
    ...(recipe.maxDailyDrawdownPercent != null
      ? { maxDailyDrawdownPercent: recipe.maxDailyDrawdownPercent }
      : {}),
  };
}
