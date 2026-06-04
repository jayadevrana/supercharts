'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  Workflow,
  Power,
  Copy,
  Pencil,
  Share2,
  Layers as LayersIcon,
  Loader2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  IndicatorInstance,
  Interval,
  SignalAction,
  SignalCondition,
  SignalRecipe,
} from '@supercharts/types';
import {
  INTERVALS,
  SYMBOL_CATALOG,
  CATEGORY_LABEL,
  CATEGORY_ORDER,
} from '@supercharts/types';
import { api } from '@/lib/api';
import { toast } from '@/components/use-toast';
import { useMT5Store } from './mt5-store';
import { formatSymbolLabel, formatRelativeTime } from '@/lib/format';

/**
 * StrategyBuilderDialog — block-based visual strategy builder.
 *
 * v1 scope (Phase 1 #1):
 *   - **Active** tab — list saved recipes with toggle / duplicate / delete; mirrors the
 *     Alerts dialog so the cognitive load between alerts and strategies is identical.
 *   - **New** tab — block-based form: name, symbol+interval+account picker, AND/ANY logic,
 *     condition rows (indicator_compare / price_crosses / session / time_window / pattern),
 *     a single open-position action with sizing/SL/TP, plus per-recipe risk caps.
 *   - **Templates** tab — one-click presets (MA cross, RSI extremes, engulfing reversal,
 *     session breakout) that pre-fill the New form. Zero-knowledge entry point.
 *
 * Reuses `/api/signals` POST/PUT/DELETE + the in-process SignalRunner (already idempotent
 * via id; runner.upsert handles enabled/disabled transitions).
 */

type ViewMode = 'list' | { mode: 'edit'; recipeId?: string };

interface RecipeDraft {
  name: string;
  accountId: string;
  symbol: string;
  interval: Interval;
  enabled: boolean;
  logic: 'all' | 'any';
  conditions: SignalCondition[];
  actions: SignalAction[];
  indicatorSpecs: IndicatorInstance[];
  maxTradesPerDay: number;
}

const DEFAULT_DRAFT: Omit<RecipeDraft, 'accountId' | 'symbol' | 'interval'> = {
  name: 'New strategy',
  enabled: true,
  logic: 'all',
  conditions: [],
  actions: [
    {
      type: 'open_position',
      side: 'buy',
      kind: 'market',
      sizing: { mode: 'fixed_lots', lots: 0.01 },
      sl: { pips: 30 },
      tp: { pips: 60 },
      maxOpen: 1,
      cooldownSec: 1800,
    },
  ],
  indicatorSpecs: [],
  maxTradesPerDay: 6,
};

export function StrategyBuilderDialog({
  defaultSymbol,
  defaultInterval,
}: {
  defaultSymbol: string;
  defaultInterval: Interval;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'active' | 'new' | 'templates'>('active');
  const [view, setView] = useState<ViewMode>('list');
  /**
   * Template seed for the New tab. Radix Tabs lazily mount each TabsContent, so the
   * BuilderForm doesn't exist when a user clicks a template card. Stashing the picked
   * template here means it's already on screen when the New tab does mount.
   */
  const [templateSeed, setTemplateSeed] = useState<Partial<RecipeDraft> | null>(null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 text-muted-foreground hover:text-foreground"
        >
          <Workflow className="h-3.5 w-3.5" /> Signal
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Workflow className="h-4 w-4 text-accent" /> Strategy builder
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Visual recipes that fire MT5 trades on indicator / pattern / session signals.
            Closes on the candle — never mid-bar.
          </p>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="px-4 pb-2">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="new">
              <span className="inline-flex items-center gap-1.5">
                <Plus className="h-3 w-3" /> New
              </span>
            </TabsTrigger>
            <TabsTrigger value="templates">
              <span className="inline-flex items-center gap-1.5">
                <LayersIcon className="h-3 w-3" /> Templates
              </span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="active" className="max-h-[60vh] overflow-y-auto scroll-thin">
            <ActiveList
              onEdit={(id) => {
                setView({ mode: 'edit', recipeId: id });
                setTab('new');
              }}
            />
          </TabsContent>
          <TabsContent value="new" className="max-h-[60vh] overflow-y-auto scroll-thin">
            <BuilderForm
              defaultSymbol={defaultSymbol}
              defaultInterval={defaultInterval}
              view={view}
              templateSeed={templateSeed}
              onTemplateConsumed={() => setTemplateSeed(null)}
              onSaved={() => {
                setTab('active');
                setView('list');
                setTemplateSeed(null);
              }}
            />
          </TabsContent>
          <TabsContent value="templates" className="max-h-[60vh] overflow-y-auto scroll-thin">
            <TemplatePicker
              onPick={(draft) => {
                setTemplateSeed(draft);
                setTab('new');
              }}
            />
          </TabsContent>
        </Tabs>
        <DialogFooter className="border-t border-border/60 px-5 py-3 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Recipes route orders to MT5 — paper-test on demo first.
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ────────────────────────────────────────────────────────── Active list */

function ActiveList({ onEdit }: { onEdit: (id: string) => void }) {
  const [recipes, setRecipes] = useState<SignalRecipe[] | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await api<{ items: SignalRecipe[] }>('/signals');
      setRecipes(r.items);
    } catch (err) {
      toast({ title: 'Could not load strategies', description: String(err), tone: 'error' });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const toggle = async (r: SignalRecipe) => {
    try {
      await api(`/signals/${r.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...r, enabled: !r.enabled }),
      });
      await reload();
    } catch (err) {
      toast({ title: 'Toggle failed', description: String(err), tone: 'error' });
    }
  };

  const duplicate = async (r: SignalRecipe) => {
    try {
      await api('/signals', {
        method: 'POST',
        body: JSON.stringify({
          ...r,
          name: `${r.name} (copy)`,
          enabled: false,
        }),
      });
      await reload();
      toast({ title: 'Duplicated', description: `${r.name} (copy)`, tone: 'success' });
    } catch (err) {
      toast({ title: 'Duplicate failed', description: String(err), tone: 'error' });
    }
  };

  const share = async (r: SignalRecipe) => {
    try {
      const res = await api<{ path: string }>(`/signals/${r.id}/share`, { method: 'POST' });
      const url = `${window.location.origin}${res.path}`;
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        /* clipboard may be blocked; the URL is still shown in the toast */
      }
      toast({ title: 'Public link copied', description: url, tone: 'success' });
    } catch (err) {
      toast({ title: 'Share failed', description: String(err), tone: 'error' });
    }
  };

  const remove = async (r: SignalRecipe) => {
    if (!window.confirm(`Delete strategy "${r.name}"?`)) return;
    try {
      await api(`/signals/${r.id}`, { method: 'DELETE' });
      await reload();
    } catch (err) {
      toast({ title: 'Delete failed', description: String(err), tone: 'error' });
    }
  };

  if (!recipes) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }
  if (recipes.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center">
        <div className="rounded-full bg-accent/10 p-3">
          <Workflow className="h-5 w-5 text-accent" />
        </div>
        <div className="text-sm font-medium">No strategies yet</div>
        <div className="text-xs text-muted-foreground">
          Start from a <strong>Template</strong> or build from scratch in the <strong>New</strong>{' '}
          tab.
        </div>
      </div>
    );
  }
  return (
    <div className="divide-y divide-border/60">
      {recipes.map((r) => (
        <div key={r.id} className="flex items-center gap-3 px-4 py-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-semibold">{r.name}</span>
              <Badge tone={r.enabled ? 'bull' : 'muted'}>{r.enabled ? 'LIVE' : 'PAUSED'}</Badge>
              <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {formatSymbolLabel(r.symbol)} · {r.interval}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
              <span>{r.conditions.length} cond · {r.logic.toUpperCase()}</span>
              <span>·</span>
              <span>{r.actions.length} action</span>
              {r.maxTradesPerDay ? (
                <>
                  <span>·</span>
                  <span>max {r.maxTradesPerDay}/day</span>
                </>
              ) : null}
              <span>·</span>
              <span>updated {formatRelativeTime(r.updatedAt)}</span>
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void toggle(r)}
            title={r.enabled ? 'Pause' : 'Start'}
            className="px-2"
          >
            <Power className={`h-3.5 w-3.5 ${r.enabled ? 'text-bull' : 'text-muted-foreground'}`} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onEdit(r.id)}
            title="Edit"
            className="px-2"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void duplicate(r)}
            title="Duplicate"
            className="px-2"
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void share(r)}
            title="Copy public share link"
            className="px-2"
          >
            <Share2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void remove(r)}
            title="Delete"
            className="px-2"
          >
            <Trash2 className="h-3.5 w-3.5 text-bear" />
          </Button>
        </div>
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────── Builder form */

function BuilderForm({
  defaultSymbol,
  defaultInterval,
  view,
  templateSeed,
  onTemplateConsumed,
  onSaved,
}: {
  defaultSymbol: string;
  defaultInterval: Interval;
  view: ViewMode;
  templateSeed: Partial<RecipeDraft> | null;
  onTemplateConsumed: () => void;
  onSaved: () => void;
}) {
  const accounts = useMT5Store((s) => s.accounts);
  const [draft, setDraft] = useState<RecipeDraft>(() => ({
    ...DEFAULT_DRAFT,
    accountId: accounts[0]?.accountId ?? '',
    symbol: defaultSymbol,
    interval: defaultInterval,
  }));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Pull recipe into the form when caller picked one to edit.
  useEffect(() => {
    if (typeof view === 'object' && view.recipeId) {
      void api<SignalRecipe>(`/signals`).then((res) => {
        const items = (res as unknown as { items: SignalRecipe[] }).items;
        const r = items.find((x) => x.id === view.recipeId);
        if (!r) return;
        setEditingId(r.id);
        setDraft({
          name: r.name,
          accountId: r.accountId,
          symbol: r.symbol,
          interval: r.interval as Interval,
          enabled: r.enabled,
          logic: r.logic,
          conditions: r.conditions,
          actions: r.actions,
          indicatorSpecs: r.indicatorSpecs ?? [],
          maxTradesPerDay: r.maxTradesPerDay ?? 6,
        });
      });
    }
  }, [view]);

  // When the parent stashes a template, merge it into the draft once and clear it.
  useEffect(() => {
    if (!templateSeed) return;
    setEditingId(null);
    setDraft((cur) => ({
      ...cur,
      ...templateSeed,
      // Always preserve the user's currently-selected symbol/interval/account so a
      // template doesn't silently arm on the wrong pair.
      symbol: cur.symbol,
      interval: cur.interval,
      accountId: cur.accountId || accounts[0]?.accountId || '',
    }));
    onTemplateConsumed();
  }, [templateSeed, accounts, onTemplateConsumed]);

  // Pick first account once accounts arrive.
  useEffect(() => {
    if (!draft.accountId && accounts.length > 0) {
      setDraft((d) => ({ ...d, accountId: accounts[0]!.accountId }));
    }
  }, [accounts, draft.accountId]);

  const updateDraft = (patch: Partial<RecipeDraft>) =>
    setDraft((d) => ({ ...d, ...patch }));

  const handleSave = async () => {
    if (!draft.accountId) {
      toast({ title: 'Connect an MT5 account first', tone: 'error' });
      return;
    }
    if (draft.conditions.length === 0) {
      toast({ title: 'Add at least one condition', tone: 'warn' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: draft.name,
        accountId: draft.accountId,
        symbol: draft.symbol,
        interval: draft.interval,
        enabled: draft.enabled,
        logic: draft.logic,
        conditions: draft.conditions,
        actions: draft.actions,
        indicatorSpecs: draft.indicatorSpecs,
        maxTradesPerDay: draft.maxTradesPerDay,
      };
      if (editingId) {
        await api(`/signals/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast({ title: 'Strategy updated', description: draft.name, tone: 'success' });
      } else {
        await api('/signals', { method: 'POST', body: JSON.stringify(payload) });
        toast({ title: 'Strategy created', description: draft.name, tone: 'success' });
      }
      onSaved();
    } catch (err) {
      toast({ title: 'Save failed', description: String(err), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const addCondition = (type: SignalCondition['type']) => {
    let c: SignalCondition;
    switch (type) {
      case 'price_crosses':
        c = {
          type: 'price_crosses',
          source: 'close',
          operator: 'crosses_above',
          target: { kind: 'indicator', indicator: 'ema_20', channel: 'value' },
        };
        // Ensure an EMA(20) spec is in indicatorSpecs so the runner computes it.
        setDraft((d) => ({
          ...d,
          indicatorSpecs: ensureSpec(d.indicatorSpecs, {
            id: 'ema_20',
            type: 'ema',
            name: 'EMA(20)',
            paneId: 'price',
            inputs: { length: 20, source: 'close' },
            style: { color: '#f5d524' },
            visible: true,
            locked: false,
          }),
        }));
        break;
      case 'indicator_compare':
        c = {
          type: 'indicator_compare',
          indicator: 'rsi_14',
          channel: 'value',
          operator: '<',
          right: { kind: 'constant', value: 30 },
        };
        setDraft((d) => ({
          ...d,
          indicatorSpecs: ensureSpec(d.indicatorSpecs, {
            id: 'rsi_14',
            type: 'rsi',
            name: 'RSI(14)',
            paneId: 'rsi',
            inputs: { length: 14 },
            style: { color: '#7c9cff' },
            visible: true,
            locked: false,
          }),
        }));
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
    setDraft((d) => ({ ...d, conditions: [...d.conditions, c] }));
  };

  const removeCondition = (idx: number) => {
    setDraft((d) => ({ ...d, conditions: d.conditions.filter((_, i) => i !== idx) }));
  };

  const updateCondition = (idx: number, next: SignalCondition) => {
    setDraft((d) => ({ ...d, conditions: d.conditions.map((c, i) => (i === idx ? next : c)) }));
  };

  const action = draft.actions[0]!;
  const updateAction = (patch: Partial<SignalAction>) => {
    setDraft((d) => ({ ...d, actions: [{ ...d.actions[0]!, ...(patch as object) } as SignalAction] }));
  };

  return (
    <div className="space-y-3 px-4 py-3 text-xs">
      {editingId ? (
        <div className="rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-[11px]">
          Editing existing strategy. Save to update; click "Active" tab to abandon changes.
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <Input
            value={draft.name}
            onChange={(e) => updateDraft({ name: e.target.value })}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field label="MT5 account">
          {accounts.length === 0 ? (
            <div className="rounded-md border border-warn/50 bg-warn/10 px-2 py-1.5 text-warn">
              No MT5 accounts paired.
            </div>
          ) : (
            <Select
              value={draft.accountId}
              onValueChange={(v) => updateDraft({ accountId: v })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.accountId} value={a.accountId}>
                    {a.snapshot?.account.broker ?? '?'} · {a.snapshot?.account.login ?? a.accountId.split('@')[0]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Symbol">
          <SymbolPicker
            value={draft.symbol}
            onChange={(v) => updateDraft({ symbol: v })}
          />
        </Field>
        <Field label="Timeframe">
          <Select value={draft.interval} onValueChange={(v) => updateDraft({ interval: v as Interval })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INTERVALS.map((i) => (
                <SelectItem key={i} value={i}>
                  {i}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="flex items-center justify-between rounded-md border border-border/70 bg-surface-raised px-3 py-2">
        <label className="flex items-center gap-2">
          <Switch checked={draft.enabled} onCheckedChange={(v) => updateDraft({ enabled: v })} />
          <span className="font-medium">Enabled</span>
          <span className="text-[10px] text-muted-foreground">
            Starts firing on the next candle close after save.
          </span>
        </label>
        <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
          {(['all', 'any'] as const).map((opt) => (
            <button
              key={opt}
              onClick={() => updateDraft({ logic: opt })}
              className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] ${
                draft.logic === opt ? 'bg-accent/15 text-accent' : 'text-muted-foreground'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>

      {/* ── Conditions ── */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Conditions ({draft.conditions.length})
          </span>
          <div className="flex flex-wrap gap-1">
            {(['price_crosses', 'indicator_compare', 'pattern', 'session', 'time_window'] as const).map(
              (t) => (
                <Button
                  key={t}
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => addCondition(t)}
                >
                  <Plus className="mr-1 h-3 w-3" /> {t.replace('_', ' ')}
                </Button>
              ),
            )}
          </div>
        </div>
        <div className="space-y-1.5">
          {draft.conditions.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-2 py-3 text-center text-[11px] text-muted-foreground">
              Add at least one condition. The strategy fires when {draft.logic === 'all' ? 'all conditions hold' : 'any condition holds'} on a candle close.
            </div>
          ) : null}
          {draft.conditions.map((c, i) => (
            <ConditionRow
              key={i}
              condition={c}
              onChange={(next) => updateCondition(i, next)}
              onRemove={() => removeCondition(i)}
            />
          ))}
        </div>
      </div>

      {/* ── Action ── */}
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Action
        </div>
        {action.type === 'open_position' ? (
          <div className="rounded-md border border-border/70 bg-surface-raised p-2">
            <div className="grid grid-cols-12 gap-2">
              <div className="col-span-2">
                <Select
                  value={action.side}
                  onValueChange={(v) => updateAction({ side: v as 'buy' | 'sell' })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="buy">Buy</SelectItem>
                    <SelectItem value="sell">Sell</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Select
                  value={action.kind}
                  onValueChange={(v) =>
                    updateAction({ kind: v as 'market' | 'limit' | 'stop' | 'stop_limit' })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="market">Market</SelectItem>
                    <SelectItem value="limit">Limit</SelectItem>
                    <SelectItem value="stop">Stop</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Input
                type="number"
                step={0.01}
                value={action.sizing.mode === 'fixed_lots' ? action.sizing.lots : 0.01}
                onChange={(e) =>
                  updateAction({ sizing: { mode: 'fixed_lots', lots: Number(e.target.value) } })
                }
                placeholder="Lots"
                className="col-span-2"
              />
              <Input
                type="number"
                value={action.sl?.pips ?? ''}
                onChange={(e) => {
                  const v = e.target.value === '' ? undefined : Number(e.target.value);
                  updateAction({ sl: v == null ? undefined : { pips: v } });
                }}
                placeholder="SL pips"
                className="col-span-3"
              />
              <Input
                type="number"
                value={action.tp?.pips ?? ''}
                onChange={(e) => {
                  const v = e.target.value === '' ? undefined : Number(e.target.value);
                  updateAction({ tp: v == null ? undefined : { pips: v } });
                }}
                placeholder="TP pips"
                className="col-span-3"
              />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Input
                type="number"
                value={action.maxOpen ?? ''}
                onChange={(e) => updateAction({ maxOpen: Number(e.target.value) || undefined })}
                placeholder="Max open"
              />
              <Input
                type="number"
                value={action.cooldownSec ?? ''}
                onChange={(e) => updateAction({ cooldownSec: Number(e.target.value) || undefined })}
                placeholder="Cooldown (s)"
              />
              <Input
                type="number"
                value={draft.maxTradesPerDay}
                onChange={(e) => updateDraft({ maxTradesPerDay: Number(e.target.value) || 0 })}
                placeholder="Max trades / day"
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border/60 pt-3">
        <div className="mr-auto text-[10px] text-muted-foreground">
          Recipes evaluate on each {draft.interval} candle close.
        </div>
        <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          {editingId ? 'Update' : 'Save'} strategy
        </Button>
      </div>
    </div>
  );
}

function ensureSpec(specs: IndicatorInstance[], spec: IndicatorInstance): IndicatorInstance[] {
  if (specs.some((s) => s.id === spec.id)) return specs;
  return [...specs, spec];
}

/* ────────────────────────────────────────────────────────── Condition row */

function ConditionRow({
  condition,
  onChange,
  onRemove,
}: {
  condition: SignalCondition;
  onChange: (next: SignalCondition) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-md border border-border/70 bg-surface-raised/60 p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {condition.type.replace('_', ' ')}
        </span>
        <Button size="sm" variant="ghost" className="h-5 px-1" onClick={onRemove}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      {condition.type === 'price_crosses' ? (
        <PriceCrossesRow condition={condition} onChange={onChange} />
      ) : condition.type === 'indicator_compare' ? (
        <IndicatorCompareRow condition={condition} onChange={onChange} />
      ) : condition.type === 'session' ? (
        <SessionRow condition={condition} onChange={onChange} />
      ) : condition.type === 'time_window' ? (
        <TimeWindowRow condition={condition} onChange={onChange} />
      ) : (
        <PatternRow condition={condition} onChange={onChange} />
      )}
    </div>
  );
}

function PriceCrossesRow({
  condition,
  onChange,
}: {
  condition: Extract<SignalCondition, { type: 'price_crosses' }>;
  onChange: (next: SignalCondition) => void;
}) {
  return (
    <div className="grid grid-cols-12 gap-1">
      <Select value={condition.source} onValueChange={(v) => onChange({ ...condition, source: v as typeof condition.source })}>
        <SelectTrigger className="col-span-3 w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="close">close</SelectItem>
          <SelectItem value="open">open</SelectItem>
          <SelectItem value="high">high</SelectItem>
          <SelectItem value="low">low</SelectItem>
        </SelectContent>
      </Select>
      <Select value={condition.operator} onValueChange={(v) => onChange({ ...condition, operator: v as typeof condition.operator })}>
        <SelectTrigger className="col-span-4 w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="crosses_above">crosses above</SelectItem>
          <SelectItem value="crosses_below">crosses below</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={condition.target.kind}
        onValueChange={(v) => {
          if (v === 'constant') onChange({ ...condition, target: { kind: 'constant', value: 0 } });
          else onChange({ ...condition, target: { kind: 'indicator', indicator: 'ema_20', channel: 'value' } });
        }}
      >
        <SelectTrigger className="col-span-2 w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="constant">value</SelectItem>
          <SelectItem value="indicator">indicator</SelectItem>
        </SelectContent>
      </Select>
      {condition.target.kind === 'constant' ? (
        <Input
          type="number"
          step="any"
          value={condition.target.value}
          onChange={(e) =>
            onChange({ ...condition, target: { kind: 'constant', value: Number(e.target.value) } })
          }
          className="col-span-3"
        />
      ) : (
        <Input
          value={condition.target.indicator}
          onChange={(e) =>
            onChange({
              ...condition,
              target: { kind: 'indicator', indicator: e.target.value, channel: condition.target.kind === 'indicator' ? condition.target.channel : 'value' },
            })
          }
          placeholder="ema_20"
          className="col-span-3"
        />
      )}
    </div>
  );
}

function IndicatorCompareRow({
  condition,
  onChange,
}: {
  condition: Extract<SignalCondition, { type: 'indicator_compare' }>;
  onChange: (next: SignalCondition) => void;
}) {
  return (
    <div className="grid grid-cols-12 gap-1">
      <Input
        value={condition.indicator}
        onChange={(e) => onChange({ ...condition, indicator: e.target.value })}
        placeholder="indicator id (e.g. rsi_14)"
        className="col-span-4"
      />
      <Select value={condition.operator} onValueChange={(v) => onChange({ ...condition, operator: v as typeof condition.operator })}>
        <SelectTrigger className="col-span-3 w-full"><SelectValue /></SelectTrigger>
        <SelectContent>
          {(['>', '<', '>=', '<=', '==', 'crosses_above', 'crosses_below'] as const).map((op) => (
            <SelectItem key={op} value={op}>
              {op}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {condition.right.kind === 'constant' ? (
        <Input
          type="number"
          step="any"
          value={condition.right.value}
          onChange={(e) =>
            onChange({ ...condition, right: { kind: 'constant', value: Number(e.target.value) } })
          }
          className="col-span-5"
          placeholder="value"
        />
      ) : (
        <div className="col-span-5 text-[10px] text-muted-foreground">
          (right side is indicator — edit via JSON for now)
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
    <Select value={condition.name} onValueChange={(v) => onChange({ ...condition, name: v as typeof condition.name })}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="sydney">Sydney</SelectItem>
        <SelectItem value="tokyo">Tokyo</SelectItem>
        <SelectItem value="london">London</SelectItem>
        <SelectItem value="newyork">New York</SelectItem>
        <SelectItem value="overlap_london_newyork">London / NY overlap</SelectItem>
      </SelectContent>
    </Select>
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
      <Input value={condition.from} onChange={(e) => onChange({ ...condition, from: e.target.value })} placeholder="08:00:00" />
      <Input value={condition.to} onChange={(e) => onChange({ ...condition, to: e.target.value })} placeholder="17:00:00" />
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
    <Select value={condition.kind} onValueChange={(v) => onChange({ ...condition, kind: v as typeof condition.kind })}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="bullish_engulfing">Bullish engulfing</SelectItem>
        <SelectItem value="bearish_engulfing">Bearish engulfing</SelectItem>
        <SelectItem value="hammer">Hammer</SelectItem>
        <SelectItem value="shooting_star">Shooting star</SelectItem>
        <SelectItem value="inside_bar">Inside bar</SelectItem>
        <SelectItem value="outside_bar">Outside bar</SelectItem>
        <SelectItem value="pin_bar_bull">Pin bar bull</SelectItem>
        <SelectItem value="pin_bar_bear">Pin bar bear</SelectItem>
      </SelectContent>
    </Select>
  );
}

/* ────────────────────────────────────────────────────────── Symbol picker */

function SymbolPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const grouped = useMemo(() => {
    const map = new Map<string, typeof SYMBOL_CATALOG>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const s of SYMBOL_CATALOG) map.get(s.category)!.push(s);
    return map;
  }, []);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-[420px]">
        {CATEGORY_ORDER.map((cat) => {
          const items = grouped.get(cat) ?? [];
          if (items.length === 0) return null;
          return (
            <div key={cat}>
              <div className="px-2 pb-1 pt-2 text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                {CATEGORY_LABEL[cat]}
              </div>
              {items.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                </SelectItem>
              ))}
            </div>
          );
        })}
      </SelectContent>
    </Select>
  );
}

/* ────────────────────────────────────────────────────────── Field helper */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/* ────────────────────────────────────────────────────────── Templates */

interface TemplateDef {
  id: string;
  name: string;
  description: string;
  draft: Partial<RecipeDraft>;
}

const TEMPLATES: TemplateDef[] = [
  {
    id: 'ma_cross_buy',
    name: 'MA cross · golden cross (buy)',
    description:
      'Close crosses above EMA(20) on the bar — fires a 0.01-lot market buy with 30/60 pip SL/TP. Adapts to any symbol/timeframe you pick before saving.',
    draft: {
      name: 'EMA(20) golden cross — BUY',
      logic: 'all',
      conditions: [
        {
          type: 'price_crosses',
          source: 'close',
          operator: 'crosses_above',
          target: { kind: 'indicator', indicator: 'ema_20', channel: 'value' },
        },
      ],
      actions: [
        {
          type: 'open_position',
          side: 'buy',
          kind: 'market',
          sizing: { mode: 'fixed_lots', lots: 0.01 },
          sl: { pips: 30 },
          tp: { pips: 60 },
          maxOpen: 1,
          cooldownSec: 1800,
        },
      ],
      indicatorSpecs: [
        {
          id: 'ema_20',
          type: 'ema',
          name: 'EMA(20)',
          paneId: 'price',
          inputs: { length: 20, source: 'close' },
          style: { color: '#f5d524' },
          visible: true,
          locked: false,
        },
      ],
      maxTradesPerDay: 6,
    },
  },
  {
    id: 'rsi_oversold',
    name: 'RSI oversold reversal (buy)',
    description:
      'RSI(14) below 30 on the bar close — mean-reversion buy. SL 30 pips, TP 60. Cooldown 2h.',
    draft: {
      name: 'RSI(14) < 30 — BUY',
      logic: 'all',
      conditions: [
        {
          type: 'indicator_compare',
          indicator: 'rsi_14',
          channel: 'value',
          operator: '<',
          right: { kind: 'constant', value: 30 },
        },
      ],
      actions: [
        {
          type: 'open_position',
          side: 'buy',
          kind: 'market',
          sizing: { mode: 'fixed_lots', lots: 0.01 },
          sl: { pips: 30 },
          tp: { pips: 60 },
          maxOpen: 1,
          cooldownSec: 7200,
        },
      ],
      indicatorSpecs: [
        {
          id: 'rsi_14',
          type: 'rsi',
          name: 'RSI(14)',
          paneId: 'rsi',
          inputs: { length: 14 },
          style: { color: '#7c9cff' },
          visible: true,
          locked: false,
        },
      ],
      maxTradesPerDay: 4,
    },
  },
  {
    id: 'engulfing_buy',
    name: 'Bullish engulfing (buy)',
    description:
      'Two-bar bullish engulfing pattern on close. SL 20, TP 60. Higher TF works best (1h+).',
    draft: {
      name: 'Bullish engulfing — BUY',
      logic: 'all',
      conditions: [{ type: 'pattern', kind: 'bullish_engulfing' }],
      actions: [
        {
          type: 'open_position',
          side: 'buy',
          kind: 'market',
          sizing: { mode: 'fixed_lots', lots: 0.01 },
          sl: { pips: 20 },
          tp: { pips: 60 },
          maxOpen: 1,
          cooldownSec: 3600,
        },
      ],
      maxTradesPerDay: 4,
    },
  },
  {
    id: 'london_breakout',
    name: 'London session breakout (buy)',
    description:
      'Only fires during the London session. Close crosses above EMA(20). Aimed at FX majors on 15m / 1h.',
    draft: {
      name: 'London EMA(20) breakout — BUY',
      logic: 'all',
      conditions: [
        { type: 'session', name: 'london' },
        {
          type: 'price_crosses',
          source: 'close',
          operator: 'crosses_above',
          target: { kind: 'indicator', indicator: 'ema_20', channel: 'value' },
        },
      ],
      actions: [
        {
          type: 'open_position',
          side: 'buy',
          kind: 'market',
          sizing: { mode: 'fixed_lots', lots: 0.01 },
          sl: { pips: 25 },
          tp: { pips: 75 },
          maxOpen: 1,
          cooldownSec: 3600,
        },
      ],
      indicatorSpecs: [
        {
          id: 'ema_20',
          type: 'ema',
          name: 'EMA(20)',
          paneId: 'price',
          inputs: { length: 20, source: 'close' },
          style: { color: '#f5d524' },
          visible: true,
          locked: false,
        },
      ],
      maxTradesPerDay: 3,
    },
  },
];

function TemplatePicker({ onPick }: { onPick: (draft: Partial<RecipeDraft>) => void }) {
  return (
    <div className="grid grid-cols-1 gap-2 px-4 py-3 md:grid-cols-2">
      {TEMPLATES.map((t) => (
        <button
          key={t.id}
          onClick={() => onPick(t.draft)}
          className="group rounded-md border border-border/70 bg-surface-raised/60 p-3 text-left hover:border-accent/60 hover:bg-accent/5"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">{t.name}</span>
            <Badge tone="accent" className="opacity-0 group-hover:opacity-100">
              Use
            </Badge>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">{t.description}</p>
        </button>
      ))}
    </div>
  );
}
