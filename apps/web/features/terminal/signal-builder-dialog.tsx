'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, Workflow } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { INDICATOR_LOOKUP } from '@supercharts/indicators';
import type {
  IndicatorInstance,
  SignalAction,
  SignalCondition,
  SignalRecipe,
} from '@supercharts/types';
import { api } from '@/lib/api';
import { useMT5Store } from './mt5-store';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The pane's indicators so condition pickers can reference them by id. */
  availableIndicators: IndicatorInstance[];
  /** Default symbol + interval to seed the recipe with. */
  defaultSymbol: string;
  defaultInterval: string;
}

export function SignalBuilderDialog({
  open,
  onOpenChange,
  availableIndicators,
  defaultSymbol,
  defaultInterval,
}: Props) {
  const accounts = useMT5Store((s) => s.accounts);
  const activeAccountId = useMT5Store((s) => s.activeAccountId);

  const [name, setName] = useState('My signal');
  const [enabled, setEnabled] = useState(true);
  const [logic, setLogic] = useState<'all' | 'any'>('all');
  const [conditions, setConditions] = useState<SignalCondition[]>([]);
  const [actions, setActions] = useState<SignalAction[]>([
    {
      type: 'open_position',
      side: 'buy',
      kind: 'market',
      sizing: { mode: 'fixed_lots', lots: 0.01 },
      sl: { pips: 20 },
      tp: { pips: 40 },
    },
  ]);
  const [maxPerDay, setMaxPerDay] = useState(10);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMessage(null);
    }
  }, [open]);

  const addCondition = (kind: SignalCondition['type']): void => {
    let c: SignalCondition;
    switch (kind) {
      case 'indicator_compare':
        c = {
          type: 'indicator_compare',
          indicator: availableIndicators[0]?.id ?? '',
          channel: 'value',
          operator: '>',
          right: { kind: 'constant', value: 0 },
        };
        break;
      case 'price_crosses':
        c = {
          type: 'price_crosses',
          source: 'close',
          operator: 'crosses_above',
          target: { kind: 'constant', value: 0 },
        };
        break;
      case 'session':
        c = { type: 'session', name: 'london' };
        break;
      case 'time_window':
        c = { type: 'time_window', from: '08:00:00', to: '17:00:00', days: [1, 2, 3, 4, 5] };
        break;
      case 'pattern':
        c = { type: 'pattern', kind: 'bullish_engulfing' };
        break;
    }
    setConditions((arr) => [...arr, c]);
  };

  const updateCondition = (idx: number, patch: SignalCondition): void => {
    setConditions((arr) => arr.map((c, i) => (i === idx ? patch : c)));
  };

  const removeCondition = (idx: number): void => {
    setConditions((arr) => arr.filter((_, i) => i !== idx));
  };

  const save = async (): Promise<void> => {
    if (!activeAccountId) {
      setMessage('Pick an MT5 account first.');
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const body: Omit<SignalRecipe, 'id' | 'userId' | 'createdAt' | 'updatedAt'> = {
        name,
        accountId: activeAccountId,
        symbol: defaultSymbol,
        interval: defaultInterval,
        enabled,
        logic,
        conditions,
        actions,
        maxTradesPerDay: maxPerDay,
      };
      const r = await api<SignalRecipe>('/signals', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setMessage(`Saved · ${r.id}`);
    } catch (err) {
      setMessage(`error · ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  void accounts;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Workflow className="h-4 w-4 text-accent" /> Signal builder
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 p-5 pt-0 text-xs">
          <div className="grid grid-cols-3 gap-2">
            <label className="col-span-2 block">
              <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Name</div>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8" />
            </label>
            <label className="block">
              <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Max / day</div>
              <Input
                type="number"
                value={maxPerDay}
                onChange={(e) => setMaxPerDay(Number(e.target.value))}
                className="h-8"
              />
            </label>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-[11px]">
              <Switch checked={enabled} onCheckedChange={setEnabled} />
              <span>Enabled</span>
            </label>
            <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
              <button
                onClick={() => setLogic('all')}
                className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${logic === 'all' ? 'bg-accent/15 text-accent' : 'text-muted-foreground'}`}
              >
                All
              </button>
              <button
                onClick={() => setLogic('any')}
                className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${logic === 'any' ? 'bg-accent/15 text-accent' : 'text-muted-foreground'}`}
              >
                Any
              </button>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {defaultSymbol} · {defaultInterval}
            </span>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Conditions</span>
              <div className="flex flex-wrap gap-1">
                {(['indicator_compare', 'price_crosses', 'session', 'time_window', 'pattern'] as const).map((t) => (
                  <Button
                    key={t}
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => addCondition(t)}
                  >
                    <Plus className="mr-1 h-3 w-3" /> {t.replace('_', ' ')}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              {conditions.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-2 py-3 text-center text-[11px] text-muted-foreground">
                  Add at least one condition. Combine with <code>all</code> / <code>any</code> above.
                </div>
              ) : null}
              {conditions.map((c, i) => (
                <ConditionEditor
                  key={i}
                  condition={c}
                  indicators={availableIndicators}
                  onChange={(next) => updateCondition(i, next)}
                  onRemove={() => removeCondition(i)}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Actions</div>
            {actions.map((a, i) => (
              <ActionEditor
                key={i}
                action={a}
                onChange={(next) => setActions((arr) => arr.map((x, j) => (j === i ? next : x)))}
              />
            ))}
          </div>

          {message ? (
            <div className="rounded-md border border-border bg-surface-sunken px-2 py-1.5 text-[11px] text-muted-foreground">
              {message}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save signal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConditionEditor({
  condition,
  indicators,
  onChange,
  onRemove,
}: {
  condition: SignalCondition;
  indicators: IndicatorInstance[];
  onChange: (next: SignalCondition) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-md border border-border bg-surface-sunken/60 p-2">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <span>{condition.type.replace('_', ' ')}</span>
        <Button size="sm" variant="ghost" className="h-5 px-1" onClick={onRemove}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      <div className="mt-1">
        {condition.type === 'indicator_compare' ? (
          <IndicatorCompareRow condition={condition} indicators={indicators} onChange={onChange} />
        ) : condition.type === 'price_crosses' ? (
          <PriceCrossesRow condition={condition} indicators={indicators} onChange={onChange} />
        ) : condition.type === 'session' ? (
          <SessionRow condition={condition} onChange={onChange} />
        ) : condition.type === 'time_window' ? (
          <TimeWindowRow condition={condition} onChange={onChange} />
        ) : (
          <PatternRow condition={condition} onChange={onChange} />
        )}
      </div>
    </div>
  );
}

function IndicatorCompareRow({
  condition,
  indicators,
  onChange,
}: {
  condition: Extract<SignalCondition, { type: 'indicator_compare' }>;
  indicators: IndicatorInstance[];
  onChange: (next: SignalCondition) => void;
}) {
  const spec = INDICATOR_LOOKUP[indicators.find((i) => i.id === condition.indicator)?.type ?? ''];
  return (
    <div className="grid grid-cols-12 gap-1">
      <select
        value={condition.indicator}
        onChange={(e) => onChange({ ...condition, indicator: e.target.value, channel: 'value' })}
        className="col-span-3 h-7 rounded-md border border-border bg-surface-sunken px-2 text-[11px]"
      >
        {indicators.map((ind) => (
          <option key={ind.id} value={ind.id}>
            {ind.name} ({ind.id})
          </option>
        ))}
      </select>
      <select
        value={condition.channel}
        onChange={(e) => onChange({ ...condition, channel: e.target.value })}
        className="col-span-2 h-7 rounded-md border border-border bg-surface-sunken px-2 text-[11px]"
      >
        {(spec?.channels ?? ['value']).map((ch) => (
          <option key={ch} value={ch}>
            {ch}
          </option>
        ))}
      </select>
      <select
        value={condition.operator}
        onChange={(e) => onChange({ ...condition, operator: e.target.value as typeof condition.operator })}
        className="col-span-2 h-7 rounded-md border border-border bg-surface-sunken px-2 text-[11px]"
      >
        {(['>', '<', '>=', '<=', '==', 'crosses_above', 'crosses_below'] as const).map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </select>
      <select
        value={condition.right.kind}
        onChange={(e) => {
          const kind = e.target.value as 'constant' | 'indicator' | 'price';
          if (kind === 'constant')
            onChange({ ...condition, right: { kind: 'constant', value: 0 } });
          else if (kind === 'indicator')
            onChange({
              ...condition,
              right: { kind: 'indicator', indicator: indicators[0]?.id ?? '', channel: 'value' },
            });
          else onChange({ ...condition, right: { kind: 'price', field: 'close' } });
        }}
        className="col-span-2 h-7 rounded-md border border-border bg-surface-sunken px-2 text-[11px]"
      >
        <option value="constant">constant</option>
        <option value="indicator">indicator</option>
        <option value="price">price</option>
      </select>
      {condition.right.kind === 'constant' ? (
        <input
          type="number"
          step="any"
          value={condition.right.value}
          onChange={(e) =>
            onChange({ ...condition, right: { kind: 'constant', value: Number(e.target.value) } })
          }
          className="col-span-3 h-7 rounded-md border border-border bg-surface-sunken px-2 text-[11px]"
        />
      ) : condition.right.kind === 'indicator' ? (
        <div className="col-span-3 grid grid-cols-2 gap-1">
          <select
            value={condition.right.indicator}
            onChange={(e) =>
              onChange({
                ...condition,
                right: { kind: 'indicator', indicator: e.target.value, channel: condition.right.kind === 'indicator' ? condition.right.channel : 'value' },
              })
            }
            className="h-7 rounded-md border border-border bg-surface-sunken px-1 text-[11px]"
          >
            {indicators.map((ind) => (
              <option key={ind.id} value={ind.id}>
                {ind.name}
              </option>
            ))}
          </select>
          <select
            value={condition.right.kind === 'indicator' ? condition.right.channel : 'value'}
            onChange={(e) =>
              onChange({
                ...condition,
                right: { kind: 'indicator', indicator: condition.right.kind === 'indicator' ? condition.right.indicator : '', channel: e.target.value },
              })
            }
            className="h-7 rounded-md border border-border bg-surface-sunken px-1 text-[11px]"
          >
            {(INDICATOR_LOOKUP[indicators.find((i) => i.id === (condition.right.kind === 'indicator' ? condition.right.indicator : ''))?.type ?? '']?.channels ?? ['value']).map((ch) => (
              <option key={ch} value={ch}>
                {ch}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <select
          value={condition.right.field}
          onChange={(e) =>
            onChange({ ...condition, right: { kind: 'price', field: e.target.value as 'open' | 'high' | 'low' | 'close' } })
          }
          className="col-span-3 h-7 rounded-md border border-border bg-surface-sunken px-2 text-[11px]"
        >
          <option value="open">open</option>
          <option value="high">high</option>
          <option value="low">low</option>
          <option value="close">close</option>
        </select>
      )}
    </div>
  );
}

function PriceCrossesRow({
  condition,
  indicators,
  onChange,
}: {
  condition: Extract<SignalCondition, { type: 'price_crosses' }>;
  indicators: IndicatorInstance[];
  onChange: (next: SignalCondition) => void;
}) {
  return (
    <div className="grid grid-cols-12 gap-1">
      <select
        value={condition.source}
        onChange={(e) => onChange({ ...condition, source: e.target.value as typeof condition.source })}
        className="col-span-3 h-7 rounded-md border border-border bg-surface-sunken px-2 text-[11px]"
      >
        <option value="close">close</option>
        <option value="open">open</option>
        <option value="high">high</option>
        <option value="low">low</option>
      </select>
      <select
        value={condition.operator}
        onChange={(e) => onChange({ ...condition, operator: e.target.value as typeof condition.operator })}
        className="col-span-3 h-7 rounded-md border border-border bg-surface-sunken px-2 text-[11px]"
      >
        <option value="crosses_above">crosses above</option>
        <option value="crosses_below">crosses below</option>
      </select>
      <select
        value={condition.target.kind}
        onChange={(e) => {
          const kind = e.target.value as 'constant' | 'indicator';
          onChange(
            kind === 'constant'
              ? { ...condition, target: { kind: 'constant', value: 0 } }
              : { ...condition, target: { kind: 'indicator', indicator: indicators[0]?.id ?? '', channel: 'value' } },
          );
        }}
        className="col-span-2 h-7 rounded-md border border-border bg-surface-sunken px-2 text-[11px]"
      >
        <option value="constant">constant</option>
        <option value="indicator">indicator</option>
      </select>
      {condition.target.kind === 'constant' ? (
        <input
          type="number"
          step="any"
          value={condition.target.value}
          onChange={(e) => onChange({ ...condition, target: { kind: 'constant', value: Number(e.target.value) } })}
          className="col-span-4 h-7 rounded-md border border-border bg-surface-sunken px-2 text-[11px]"
        />
      ) : (
        <div className="col-span-4 grid grid-cols-2 gap-1">
          <select
            value={condition.target.indicator}
            onChange={(e) =>
              onChange({
                ...condition,
                target: { kind: 'indicator', indicator: e.target.value, channel: condition.target.kind === 'indicator' ? condition.target.channel : 'value' },
              })
            }
            className="h-7 rounded-md border border-border bg-surface-sunken px-1 text-[11px]"
          >
            {indicators.map((ind) => (
              <option key={ind.id} value={ind.id}>
                {ind.name}
              </option>
            ))}
          </select>
          <select
            value={condition.target.kind === 'indicator' ? condition.target.channel : 'value'}
            onChange={(e) =>
              onChange({
                ...condition,
                target: { kind: 'indicator', indicator: condition.target.kind === 'indicator' ? condition.target.indicator : '', channel: e.target.value },
              })
            }
            className="h-7 rounded-md border border-border bg-surface-sunken px-1 text-[11px]"
          >
            {(INDICATOR_LOOKUP[indicators.find((i) => i.id === (condition.target.kind === 'indicator' ? condition.target.indicator : ''))?.type ?? '']?.channels ?? ['value']).map((ch) => (
              <option key={ch} value={ch}>
                {ch}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

function SessionRow({
  condition,
  onChange,
}: {
  condition: Extract<SignalCondition, { type: 'session' }>;
  onChange: (next: SignalCondition) => void;
}) {
  return (
    <select
      value={condition.name}
      onChange={(e) => onChange({ ...condition, name: e.target.value as typeof condition.name })}
      className="h-7 w-full rounded-md border border-border bg-surface-sunken px-2 text-[11px]"
    >
      <option value="sydney">Sydney</option>
      <option value="tokyo">Tokyo</option>
      <option value="london">London</option>
      <option value="newyork">New York</option>
      <option value="overlap_london_newyork">London/NY overlap</option>
    </select>
  );
}

function TimeWindowRow({
  condition,
  onChange,
}: {
  condition: Extract<SignalCondition, { type: 'time_window' }>;
  onChange: (next: SignalCondition) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Input value={condition.from} onChange={(e) => onChange({ ...condition, from: e.target.value })} className="h-7" />
      <Input value={condition.to} onChange={(e) => onChange({ ...condition, to: e.target.value })} className="h-7" />
    </div>
  );
}

function PatternRow({
  condition,
  onChange,
}: {
  condition: Extract<SignalCondition, { type: 'pattern' }>;
  onChange: (next: SignalCondition) => void;
}) {
  return (
    <select
      value={condition.kind}
      onChange={(e) => onChange({ ...condition, kind: e.target.value as typeof condition.kind })}
      className="h-7 w-full rounded-md border border-border bg-surface-sunken px-2 text-[11px]"
    >
      <option value="bullish_engulfing">Bullish engulfing</option>
      <option value="bearish_engulfing">Bearish engulfing</option>
      <option value="hammer">Hammer</option>
      <option value="shooting_star">Shooting star</option>
      <option value="inside_bar">Inside bar</option>
      <option value="outside_bar">Outside bar</option>
      <option value="pin_bar_bull">Pin bar bull</option>
      <option value="pin_bar_bear">Pin bar bear</option>
    </select>
  );
}

function ActionEditor({
  action,
  onChange,
}: {
  action: SignalAction;
  onChange: (next: SignalAction) => void;
}) {
  if (action.type !== 'open_position') {
    return (
      <div className="rounded-md border border-border bg-surface-sunken/60 p-2 text-[11px] text-muted-foreground">
        Action type <code>{action.type}</code> not editable here yet — use the JSON API.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border bg-surface-sunken/60 p-2 text-[11px]">
      <div className="grid grid-cols-12 gap-1">
        <select
          value={action.side}
          onChange={(e) => onChange({ ...action, side: e.target.value as 'buy' | 'sell' })}
          className="col-span-2 h-7 rounded-md border border-border bg-surface-sunken px-2"
        >
          <option value="buy">buy</option>
          <option value="sell">sell</option>
        </select>
        <select
          value={action.kind}
          onChange={(e) => onChange({ ...action, kind: e.target.value as typeof action.kind })}
          className="col-span-2 h-7 rounded-md border border-border bg-surface-sunken px-2"
        >
          <option value="market">market</option>
          <option value="limit">limit</option>
          <option value="stop">stop</option>
        </select>
        <input
          type="number"
          step="0.01"
          value={action.sizing.mode === 'fixed_lots' ? action.sizing.lots : 0}
          onChange={(e) => onChange({ ...action, sizing: { mode: 'fixed_lots', lots: Number(e.target.value) } })}
          className="col-span-2 h-7 rounded-md border border-border bg-surface-sunken px-2"
          placeholder="lots"
        />
        <input
          type="number"
          value={action.sl?.pips ?? 0}
          onChange={(e) => onChange({ ...action, sl: { pips: Number(e.target.value) } })}
          className="col-span-3 h-7 rounded-md border border-border bg-surface-sunken px-2"
          placeholder="SL pips"
        />
        <input
          type="number"
          value={action.tp?.pips ?? 0}
          onChange={(e) => onChange({ ...action, tp: { pips: Number(e.target.value) } })}
          className="col-span-3 h-7 rounded-md border border-border bg-surface-sunken px-2"
          placeholder="TP pips"
        />
      </div>
    </div>
  );
}
