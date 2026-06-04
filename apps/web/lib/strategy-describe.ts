import type { SignalCondition, SignalAction, IndicatorInstance } from '@supercharts/types';

/**
 * Plain-English rendering of a shared strategy's rules (Phase 4 #16).
 * Presentational only — turns the structured SignalCondition / SignalAction shapes into short
 * human strings for the public read-only strategy page.
 */

const OP_WORD: Record<string, string> = {
  '>': 'is above',
  '<': 'is below',
  '>=': 'is at or above',
  '<=': 'is at or below',
  '==': 'equals',
  crosses_above: 'crosses above',
  crosses_below: 'crosses below',
};

const SESSION_LABEL: Record<string, string> = {
  tokyo: 'Tokyo',
  london: 'London',
  newyork: 'New York',
  sydney: 'Sydney',
  overlap_london_newyork: 'London/New York overlap',
};

const PATTERN_LABEL: Record<string, string> = {
  bullish_engulfing: 'Bullish engulfing',
  bearish_engulfing: 'Bearish engulfing',
  hammer: 'Hammer',
  shooting_star: 'Shooting star',
  inside_bar: 'Inside bar',
  outside_bar: 'Outside bar',
  pin_bar_bull: 'Bullish pin bar',
  pin_bar_bear: 'Bearish pin bar',
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function describeIndicator(id: string, specs: IndicatorInstance[] = []): string {
  const spec = specs.find((s) => s.id === id);
  if (!spec) return id;
  const len = spec.inputs?.length ?? spec.inputs?.period;
  const type = (spec.type || '').toUpperCase();
  if (len != null) return `${type}(${len})`;
  return spec.name || type || id;
}

type Operand =
  | { kind: 'constant'; value: number }
  | { kind: 'indicator'; indicator: string; channel: string }
  | { kind: 'price'; field: string };

function describeOperand(operand: Operand | undefined, specs: IndicatorInstance[]): string {
  if (!operand) return '';
  if (operand.kind === 'constant') return String(operand.value);
  if (operand.kind === 'price') return operand.field;
  return describeIndicator(operand.indicator, specs);
}

export function describeCondition(c: SignalCondition, specs: IndicatorInstance[] = []): string {
  switch (c.type) {
    case 'indicator_compare': {
      const left = `${describeIndicator(c.indicator, specs)}${c.channel && c.channel !== 'value' ? ` [${c.channel}]` : ''}`;
      return `${left} ${OP_WORD[c.operator] ?? c.operator} ${describeOperand(c.right as Operand, specs)}`;
    }
    case 'price_crosses':
      return `Price (${c.source}) ${OP_WORD[c.operator] ?? c.operator} ${describeOperand(c.target as Operand, specs)}`;
    case 'session':
      return `During the ${SESSION_LABEL[c.name] ?? c.name} session`;
    case 'time_window':
      return `Between ${c.from} and ${c.to}${c.days?.length ? ` on ${c.days.map((d) => DAY_NAMES[d] ?? d).join(', ')}` : ''}`;
    case 'pattern':
      return `${PATTERN_LABEL[c.kind] ?? c.kind} candle`;
    default:
      return JSON.stringify(c);
  }
}

function describeSizing(sizing: unknown): string {
  const s = sizing as { mode?: string; lots?: number; percent?: number; amount?: number };
  if (!s || !s.mode) return '';
  if (s.mode === 'fixed_lots') return `${s.lots} lots`;
  if (s.mode === 'risk_percent') return `${s.percent}% risk`;
  if (s.mode === 'cash_risk') return `$${s.amount} risk`;
  return '';
}

function sltp(label: string, v: { pips?: number; price?: number } | undefined): string {
  if (!v) return '';
  if (v.pips != null) return `${label} ${v.pips} pips`;
  if (v.price != null) return `${label} @ ${v.price}`;
  return '';
}

export function describeAction(a: SignalAction): string {
  switch (a.type) {
    case 'open_position': {
      const parts = [`Open ${a.side.toUpperCase()} (${a.kind})`, describeSizing(a.sizing), sltp('SL', a.sl), sltp('TP', a.tp)];
      return parts.filter(Boolean).join(' · ');
    }
    case 'close_all':
      return `Close all ${a.filter?.side ? `${a.filter.side} ` : ''}positions`;
    case 'partial_close':
      return 'Partial close';
    case 'move_sl':
      return `Move stop${a.pips != null ? ` to ${a.pips} pips` : a.price != null ? ` to ${a.price}` : ''}`;
    case 'set_trailing':
      return `Trail by ${a.distancePips} pips${a.activationPips != null ? ` (activate at ${a.activationPips})` : ''}`;
    default:
      return (a as { type?: string }).type ?? 'Action';
  }
}
