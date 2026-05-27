/**
 * High-level trading domain — the bridge between the browser UI and the MT5
 * routing layer. The web client never speaks MT5 wire types directly; it sends
 * these intent shapes which the backend translates into one or more MT5
 * commands while applying validation, risk checks, and partial-close
 * scheduling.
 */

import type {
  MT5OrderKind,
  MT5OrderSide,
  MT5OrderState,
  MT5Position,
  MT5PendingOrder,
  MT5TimeInForce,
} from './mt5';
import type { IndicatorInstance } from './chart';

export interface PartialCloseLeg {
  /** UI label, e.g. `TP1`, `TP2`. */
  label: string;
  /** Take-profit price for this leg. */
  price: number;
  /** Fraction of remaining position to close at this leg (0..1]. */
  fraction: number;
  /** Optional: after this leg fills, move SL to entry + offset (pips). */
  moveSlToBreakEvenAfter?: boolean;
  breakEvenOffsetPips?: number;
}

export interface OrderIntent {
  /** Account id targeted. */
  accountId: string;
  symbol: string;
  side: MT5OrderSide;
  kind: MT5OrderKind;
  /** Sizing mode for the entry. */
  sizing:
    | { mode: 'fixed_lots'; lots: number }
    | { mode: 'risk_percent'; percent: number; slPips: number }
    | { mode: 'cash_risk'; amount: number; slPips: number };
  /** Resting price for limit/stop orders. */
  price?: number;
  stopLimitPrice?: number;
  sl?: {
    /** Absolute price OR distance from entry in pips. */
    price?: number;
    pips?: number;
  };
  tp?: {
    price?: number;
    pips?: number;
  };
  /** Multiple TP legs for partial closes. Fractions must sum to <=1. */
  partials?: PartialCloseLeg[];
  trailing?: {
    distancePips: number;
    activationPips?: number;
    stepPips?: number;
  };
  breakEven?: {
    triggerPips: number;
    offsetPips?: number;
  };
  tif?: MT5TimeInForce;
  expiresAt?: number;
  deviationPoints?: number;
  comment?: string;
  /** When set, ties together orders fired from the same signal recipe. */
  recipeId?: string;
}

export interface OrderIntentResult {
  /** Mirrors back the intent that was placed for the UI to optimistic-render. */
  intentId: string;
  state: 'queued' | 'sent' | 'partial' | 'filled' | 'rejected';
  message?: string;
  /** All MT5 results produced by this intent so far. */
  mt5Results: Array<{
    clientId: string;
    state: MT5OrderState;
    ticket?: string;
    retcodeText: string;
    filledPrice?: number;
    filledVolume?: number;
  }>;
  position?: MT5Position;
  order?: MT5PendingOrder;
}

export type SignalConditionLogic = 'all' | 'any';

/** A single rule referenced inside a signal recipe. */
export type SignalCondition =
  | {
      type: 'indicator_compare';
      /** Indicator instance id (matches an entry in `IndicatorInstance.id`). */
      indicator: string;
      /** Output channel of the indicator, e.g. `value`, `rsi`, `macd`, `signal`. */
      channel: string;
      operator: '>' | '<' | '>=' | '<=' | '==' | 'crosses_above' | 'crosses_below';
      /** Compare to a constant OR another indicator channel. */
      right:
        | { kind: 'constant'; value: number }
        | { kind: 'indicator'; indicator: string; channel: string }
        | { kind: 'price'; field: 'open' | 'high' | 'low' | 'close' };
    }
  | {
      type: 'price_crosses';
      /** Bar-source price field. */
      source: 'open' | 'high' | 'low' | 'close';
      operator: 'crosses_above' | 'crosses_below';
      /** Indicator channel OR constant price level. */
      target:
        | { kind: 'indicator'; indicator: string; channel: string }
        | { kind: 'constant'; value: number };
    }
  | {
      type: 'session';
      /** Only true during the named session. */
      name: 'tokyo' | 'london' | 'newyork' | 'sydney' | 'overlap_london_newyork';
    }
  | {
      type: 'time_window';
      /** Inclusive HH:MM:SS in EA broker server time. */
      from: string;
      to: string;
      /** Days of week 0..6 (Sun=0). */
      days: number[];
    }
  | {
      type: 'pattern';
      kind:
        | 'bullish_engulfing'
        | 'bearish_engulfing'
        | 'hammer'
        | 'shooting_star'
        | 'inside_bar'
        | 'outside_bar'
        | 'pin_bar_bull'
        | 'pin_bar_bear';
    };

export type SignalAction =
  | {
      type: 'open_position';
      side: MT5OrderSide;
      kind: MT5OrderKind;
      sizing: OrderIntent['sizing'];
      sl?: OrderIntent['sl'];
      tp?: OrderIntent['tp'];
      partials?: PartialCloseLeg[];
      trailing?: OrderIntent['trailing'];
      breakEven?: OrderIntent['breakEven'];
      /** Maximum simultaneous open positions for this recipe. */
      maxOpen?: number;
      /** Cooldown in seconds before this action can fire again. */
      cooldownSec?: number;
    }
  | {
      type: 'close_all';
      filter?: { side?: MT5OrderSide; recipeId?: string };
    }
  | {
      type: 'partial_close';
      fraction: number;
      filter?: { side?: MT5OrderSide; recipeId?: string };
    }
  | {
      type: 'move_sl';
      /** Either an absolute price, distance in pips from current, or break-even. */
      mode: 'breakeven' | 'price' | 'pips_from_entry' | 'pips_from_current';
      price?: number;
      pips?: number;
      filter?: { side?: MT5OrderSide; recipeId?: string };
    }
  | {
      type: 'set_trailing';
      distancePips: number;
      activationPips?: number;
      stepPips?: number;
      filter?: { side?: MT5OrderSide; recipeId?: string };
    };

export interface SignalRecipe {
  id: string;
  userId: string;
  accountId: string;
  name: string;
  symbol: string;
  /** Timeframe the rules evaluate on. */
  interval: string;
  enabled: boolean;
  /** Run actions when *all* or *any* conditions hold. */
  logic: SignalConditionLogic;
  conditions: SignalCondition[];
  /** Multiple actions fire in order — usually one open + optional setters. */
  actions: SignalAction[];
  /**
   * Indicator instance specs that the condition evaluator references.
   *
   * Without this, the runner falls back to the indicator type's default inputs (so
   * `ema` defaults to length=21), which is rarely what the user wants. Bulk-subscribe
   * flows always emit explicit specs so user-configured MA params actually take effect.
   */
  indicatorSpecs?: IndicatorInstance[];
  /** Maximum trades per day for this recipe. */
  maxTradesPerDay?: number;
  /** Risk hard cap: skip recipe if daily P&L drawdown breaches percentage. */
  maxDailyDrawdownPercent?: number;
  createdAt: number;
  updatedAt: number;
}

export interface SignalRecipeRun {
  id: string;
  recipeId: string;
  /** UNIX ms UTC the rule fired. */
  firedAt: number;
  /** Snapshot of the bar that triggered the rule. */
  triggerBarTime: number;
  intentId?: string;
  status: 'fired' | 'filtered' | 'failed';
  reason?: string;
}
