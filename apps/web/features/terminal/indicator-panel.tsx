'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Settings2, Trash2, Eye, EyeOff, LineChart } from 'lucide-react';
import { INDICATOR_REGISTRY, INDICATOR_LOOKUP, type IndicatorSpec } from '@supercharts/indicators';
import type { IndicatorInstance } from '@supercharts/types';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useTerminalStore, type PaneState } from './terminal-store';
import { nanoid } from './nanoid';

interface Props {
  pane: PaneState;
}

export function IndicatorPanel({ pane }: Props) {
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const addIndicator = useTerminalStore((s) => s.addIndicator);
  const removeIndicator = useTerminalStore((s) => s.removeIndicator);
  const updateIndicator = useTerminalStore((s) => s.updateIndicator);
  const settingsTarget = useTerminalStore((s) => s.indicatorSettingsTarget);
  const clearSettingsTarget = useTerminalStore((s) => s.clearIndicatorSettingsTarget);

  const active = pane.classicIndicators;
  const editingInst = active.find((i) => i.id === editing) ?? null;
  const editingSpec = editingInst ? INDICATOR_LOOKUP[editingInst.type] ?? null : null;

  // The on-chart legend gear (or anything else) can request an instance's settings: open its
  // editor here and consume the request so it doesn't re-fire.
  useEffect(() => {
    if (settingsTarget && active.some((i) => i.id === settingsTarget)) {
      setEditing(settingsTarget);
      clearSettingsTarget();
    }
  }, [settingsTarget, active, clearSettingsTarget]);

  return (
    <div className="space-y-3 p-3 text-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <LineChart className="h-3 w-3" /> Indicators
        </div>
        <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setPicker((v) => !v)}>
          <Plus className="mr-1 h-3 w-3" /> Add
        </Button>
      </div>

      {picker ? (
        <IndicatorPickerList
          onPick={(spec) => {
            const inst: IndicatorInstance = {
              id: `${spec.type}_${nanoid().slice(0, 6)}`,
              type: spec.type,
              name: spec.label,
              paneId: spec.pane === 'overlay' ? 'price' : spec.type,
              inputs: Object.fromEntries(spec.inputs.map((i) => [i.key, i.default])) as IndicatorInstance['inputs'],
              style: { ...spec.style },
              visible: true,
              locked: false,
            };
            addIndicator(pane.id, inst);
            setPicker(false);
            setEditing(inst.id);
          }}
        />
      ) : null}

      <div className="space-y-1">
        {active.length === 0 && !picker ? (
          <div className="rounded-md border border-dashed border-border px-2 py-3 text-center text-[11px] text-muted-foreground">
            No classic indicators yet. Click <span className="text-foreground">Add</span> to pick from the registry.
          </div>
        ) : null}
        {active.map((inst) => {
          const spec = INDICATOR_LOOKUP[inst.type];
          if (!spec) return null;
          return (
            <div
              key={inst.id}
              className="rounded-md border border-border bg-surface-sunken/60 px-2 py-1.5"
            >
              <div className="flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    onClick={() => updateIndicator(pane.id, inst.id, { visible: !inst.visible })}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {inst.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                  </button>
                  <span className="truncate font-medium text-foreground">{spec.label}</span>
                  <Badge tone={spec.pane === 'overlay' ? 'muted' : 'accent'} className="text-[8px]">
                    {spec.pane}
                  </Badge>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1"
                    onClick={() => setEditing((cur) => (cur === inst.id ? null : inst.id))}
                  >
                    <Settings2 className="h-3 w-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1 text-bear/80 hover:text-bear"
                    onClick={() => removeIndicator(pane.id, inst.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {editingInst && editingSpec ? (
        <IndicatorEditor
          inst={editingInst}
          spec={editingSpec}
          onChange={(patch) => updateIndicator(pane.id, editingInst.id, patch)}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function IndicatorPickerList({ onPick }: { onPick: (spec: IndicatorSpec) => void }) {
  const [q, setQ] = useState('');
  const items = useMemo(() => {
    const lower = q.toLowerCase();
    return INDICATOR_REGISTRY.filter(
      (s) => !lower || s.label.toLowerCase().includes(lower) || s.type.toLowerCase().includes(lower),
    );
  }, [q]);
  return (
    <div className="rounded-md border border-border bg-surface-sunken/80 p-2">
      <Input
        placeholder="Search indicators…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="h-7"
      />
      <div className="mt-2 max-h-[260px] overflow-y-auto scroll-thin">
        <div className="grid grid-cols-2 gap-1">
          {items.map((spec) => (
            <button
              key={spec.type}
              onClick={() => onPick(spec)}
              className="rounded-md border border-border bg-surface px-2 py-1.5 text-left text-[11px] hover:border-accent/60"
              title={spec.description}
            >
              <div className="font-medium text-foreground">{spec.label}</div>
              <div className="text-[10px] text-muted-foreground">{spec.pane}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function IndicatorEditor({
  inst,
  spec,
  onChange,
  onClose,
}: {
  inst: IndicatorInstance;
  spec: IndicatorSpec;
  onChange: (patch: Partial<IndicatorInstance>) => void;
  onClose: () => void;
}) {
  return (
    <div className="rounded-md border border-accent/40 bg-accent/5 p-2">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.14em] text-accent">
          {spec.label} · settings
        </div>
        <Button size="sm" variant="ghost" className="h-6 px-2" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {spec.inputs.map((input) => {
          const value = inst.inputs[input.key] ?? input.default;
          if (input.type === 'enum') {
            return (
              <label key={input.key} className="block">
                <div className="mb-0.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  {input.label}
                </div>
                <select
                  value={String(value)}
                  onChange={(e) =>
                    onChange({
                      inputs: { ...inst.inputs, [input.key]: e.target.value },
                    })
                  }
                  className="h-7 w-full rounded-md border border-border bg-surface-sunken px-2 text-xs"
                >
                  {input.options?.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            );
          }
          if (input.type === 'bool') {
            return (
              <div key={input.key} className="flex items-center justify-between rounded-md px-1 py-1.5">
                <span className="text-[11px] text-foreground">{input.label}</span>
                <Switch
                  checked={Boolean(value)}
                  onCheckedChange={(v) =>
                    onChange({ inputs: { ...inst.inputs, [input.key]: v } })
                  }
                />
              </div>
            );
          }
          return (
            <label key={input.key} className="block">
              <div className="mb-0.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                {input.label}
              </div>
              <input
                type="number"
                step={input.step ?? (input.type === 'float' ? 0.1 : 1)}
                min={input.min}
                max={input.max}
                value={typeof value === 'number' ? value : Number(value)}
                onChange={(e) =>
                  onChange({
                    inputs: { ...inst.inputs, [input.key]: Number(e.target.value) },
                  })
                }
                className="h-7 w-full rounded-md border border-border bg-surface-sunken px-2 text-xs"
              />
            </label>
          );
        })}
        <label className="block col-span-2">
          <div className="mb-0.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Color</div>
          <input
            type="text"
            value={String(inst.style.color ?? spec.style.color ?? '#42a5f5')}
            onChange={(e) =>
              onChange({ style: { ...inst.style, color: e.target.value } })
            }
            className="h-7 w-full rounded-md border border-border bg-surface-sunken px-2 text-xs font-mono"
          />
        </label>
      </div>
    </div>
  );
}
