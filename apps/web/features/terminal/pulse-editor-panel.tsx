'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Code2, Play, RotateCcw, TriangleAlert, CheckCircle2, Save, FolderOpen, Trash2, X, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { toast } from '@/components/use-toast';
import { formatSymbolLabel } from '@/lib/format';
import { useTerminalStore, SAMPLE_PULSE, type PulseResult } from './terminal-store';
import type { InputDef } from '@supercharts/script-lang';

interface SavedScript {
  id: string;
  name: string;
  source: string;
  updatedAt: number;
}

// CodeMirror 6 is heavy + browser-only — lazy-load it so it never enters the SSR/initial bundle.
const CodeMirror = dynamic(() => import('@uiw/react-codemirror').then((m) => m.default), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Loading editor…</div>,
});

const MIN_H = 180;
const DEFAULT_H = 340;
const HEADER_H = 42;

/**
 * PulseScript editor — TradingView's "Pine Editor" analog: a docked, resizable panel at the
 * BOTTOM of the chart column (toggled from the top bar). Edit a script, Run it over the active
 * pane's candles via `@supercharts/script-lang`, toggle its draw/mark output onto the chart, and
 * save/open scripts. Same engine the chart indicators use, so plots align to the live candles.
 */
export function PulseEditorPanel() {
  const open = useTerminalStore((s) => s.showBottomPanel);
  const setOpen = useTerminalStore((s) => s.setShowBottomPanel);
  const pane = useTerminalStore((s) => s.panes.find((p) => p.id === s.activePaneId) ?? s.panes[0]!);
  const result = useTerminalStore((s) => s.pulseResults[pane.id]);
  const setPulseSource = useTerminalStore((s) => s.setPulseSource);
  const setPulseEnabled = useTerminalStore((s) => s.setPulseEnabled);
  const setPulseInput = useTerminalStore((s) => s.setPulseInput);

  const [draft, setDraft] = useState(pane.pulse.source);
  const [height, setHeight] = useState(DEFAULT_H);
  const [saved, setSaved] = useState<SavedScript[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [currentName, setCurrentName] = useState('');
  const [savePop, setSavePop] = useState(false);
  const [listPop, setListPop] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  // Re-seed the editor when the active pane changes (each pane keeps its own script).
  useEffect(() => {
    setDraft(pane.pulse.source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.id]);

  const loadList = useCallback(async (): Promise<void> => {
    try {
      const r = await api<{ items: SavedScript[] }>('/scripts');
      setSaved(r.items);
    } catch {
      /* offline — keep quiet */
    }
  }, []);
  useEffect(() => {
    if (open) void loadList();
  }, [open, loadList]);

  // Drag the top edge to resize (TradingView Pine Editor behaviour).
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const onResizeDown = (e: React.PointerEvent): void => {
    dragRef.current = { startY: e.clientY, startH: height };
    const onMove = (ev: PointerEvent): void => {
      if (!dragRef.current) return;
      const next = dragRef.current.startH + (dragRef.current.startY - ev.clientY);
      setHeight(Math.max(MIN_H, Math.min(window.innerHeight * 0.8, next)));
    };
    const onUp = (): void => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const run = (): void => {
    setPulseSource(pane.id, draft);
    if (!pane.pulse.enabled) setPulseEnabled(pane.id, true);
  };

  const doSave = async (): Promise<void> => {
    const name = nameDraft.trim();
    if (!name) return;
    try {
      if (currentId && name === currentName) {
        await api(`/scripts/${currentId}`, { method: 'PUT', body: JSON.stringify({ name, source: draft }) });
      } else {
        const r = await api<{ id: string }>('/scripts', { method: 'POST', body: JSON.stringify({ name, source: draft }) });
        setCurrentId(r.id);
        setCurrentName(name);
      }
      setSavePop(false);
      toast({ title: 'Script saved', description: name, tone: 'success' });
      void loadList();
    } catch (err) {
      toast({ title: 'Could not save script', description: err instanceof Error ? err.message : String(err), tone: 'error' });
    }
  };

  const doLoad = (s: SavedScript): void => {
    setDraft(s.source);
    setCurrentId(s.id);
    setCurrentName(s.name);
    setListPop(false);
    setPulseSource(pane.id, s.source);
  };

  const doDelete = async (id: string): Promise<void> => {
    try {
      await api(`/scripts/${id}`, { method: 'DELETE' });
      if (id === currentId) {
        setCurrentId(null);
        setCurrentName('');
      }
      void loadList();
    } catch {
      /* ignore */
    }
  };

  if (!open) return null;
  const bodyH = height - HEADER_H;

  return (
    <div
      className="flex shrink-0 flex-col border-t border-border bg-surface"
      style={{ height }}
      data-testid="pulse-editor-panel"
    >
      {/* Resize handle */}
      <div
        onPointerDown={onResizeDown}
        className="group flex h-1.5 items-center justify-center"
        style={{ cursor: 'row-resize' }}
      >
        <div className="h-0.5 w-10 rounded-full bg-border transition-colors group-hover:bg-accent" />
      </div>

      {/* Header / tab bar */}
      <div className="flex items-center justify-between gap-3 border-b border-border px-3" style={{ height: HEADER_H }}>
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md bg-accent/15 px-2 py-1 text-xs font-medium text-accent">
            <Code2 className="h-3.5 w-3.5" /> PulseScript
          </div>
          <Badge tone="muted" className="text-[9px]">{formatSymbolLabel(pane.symbol)} · {pane.interval}</Badge>
          {currentName ? <Badge tone="accent" className="max-w-[160px] truncate text-[9px]">{currentName}</Badge> : null}
        </div>
        <div className="flex items-center gap-1.5">
          <Popover open={listPop} onOpenChange={setListPop}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" title="Open a saved script">
                <FolderOpen className="h-3.5 w-3.5" /> Open
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-1.5">
              <div className="px-1.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Saved scripts</div>
              {saved.length === 0 ? (
                <div className="px-2 py-3 text-center text-xs text-muted-foreground">No saved scripts yet.</div>
              ) : (
                <div className="max-h-72 overflow-auto scroll-thin">
                  {saved.map((s) => (
                    <div key={s.id} className="group flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
                      <button className="flex min-w-0 flex-1 flex-col text-left" onClick={() => doLoad(s)}>
                        <span className="truncate text-foreground">{s.name}</span>
                        <span className="text-[10px] text-muted-foreground">{new Date(s.updatedAt).toLocaleString()}</span>
                      </button>
                      <button
                        className="rounded p-1 text-muted-foreground opacity-0 transition hover:text-bear group-hover:opacity-100"
                        title="Delete"
                        onClick={() => void doDelete(s.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </PopoverContent>
          </Popover>

          <Popover open={savePop} onOpenChange={(o) => { setSavePop(o); if (o) setNameDraft(currentName || ''); }}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" title="Save this script">
                <Save className="h-3.5 w-3.5" /> Save
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-2">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {currentId ? 'Update / save as' : 'Save script'}
              </div>
              <Input
                autoFocus
                value={nameDraft}
                placeholder="Script name"
                className="h-8 text-xs"
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void doSave(); }}
              />
              <Button size="sm" className="mt-2 w-full" onClick={() => void doSave()} disabled={!nameDraft.trim()}>
                {currentId && nameDraft.trim() === currentName ? 'Update' : 'Save'}
              </Button>
            </PopoverContent>
          </Popover>

          <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={() => setDraft(SAMPLE_PULSE)} title="Reset to the sample script">
            <RotateCcw className="h-3.5 w-3.5" /> Sample
          </Button>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Switch checked={pane.pulse.enabled} onCheckedChange={(v) => setPulseEnabled(pane.id, v)} /> On chart
          </label>
          <Button size="sm" className="gap-1" onClick={run}>
            <Play className="h-3.5 w-3.5" /> Run
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => setOpen(false)} title="Close editor">
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Body: editor + console/inputs */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px]" style={{ height: bodyH }}>
        <div className="min-h-0 min-w-0 overflow-hidden border-r border-border">
          <CodeMirror
            value={draft}
            onChange={(v: string) => setDraft(v)}
            theme="dark"
            height={`${bodyH}px`}
            basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true }}
            style={{ fontSize: 13 }}
          />
        </div>
        <div className="flex min-h-0 flex-col gap-3 overflow-auto p-3 text-xs scroll-thin">
          <ConsolePanel result={result} enabled={pane.pulse.enabled} />
          <InputsPanel
            inputs={result?.inputs ?? []}
            values={pane.pulse.inputValues}
            onChange={(id, v) => setPulseInput(pane.id, id, v)}
          />
          <p className="mt-auto leading-relaxed text-[10px] text-muted-foreground/70">
            PulseScript is SuperCharts&apos; own language — <code>let</code>/<code>persist</code>,{' '}
            <code>ema(close, n)</code>, <code>crossOver</code>, <code>draw line</code>, <code>mark buy</code>,{' '}
            <code>input.num</code>. TA/math reuse the same engine as the chart&apos;s indicators.
          </p>
        </div>
      </div>
    </div>
  );
}

function ConsolePanel({ result, enabled }: { result: PulseResult | undefined; enabled: boolean }) {
  if (!result) {
    return (
      <div className="rounded-md border border-border bg-surface-raised/60 p-2.5 text-muted-foreground">
        Press <span className="font-medium text-foreground">Run</span> to compile + execute over the live candles.
      </div>
    );
  }
  if (!result.ok) {
    return (
      <div className="rounded-md border border-bear/40 bg-bear/10 p-2.5">
        <div className="mb-1 flex items-center gap-1.5 font-semibold text-bear">
          <TriangleAlert className="h-3.5 w-3.5" /> Error
        </div>
        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-bear">{result.error}</pre>
      </div>
    );
  }
  const name = typeof result.meta.name === 'string' ? result.meta.name : 'Script';
  return (
    <div className="rounded-md border border-bull/40 bg-bull/10 p-2.5">
      <div className="mb-1 flex items-center gap-1.5 font-semibold text-bull">
        <CheckCircle2 className="h-3.5 w-3.5" /> {name} ran
      </div>
      <div className="text-[11px] text-muted-foreground">
        {result.plotCount} plot{result.plotCount === 1 ? '' : 's'} · {result.markCount} mark
        {result.markCount === 1 ? '' : 's'} · {result.inputs.length} input{result.inputs.length === 1 ? '' : 's'}
        {enabled ? '' : ' · toggle "On chart" to draw'}
      </div>
    </div>
  );
}

function InputsPanel({
  inputs,
  values,
  onChange,
}: {
  inputs: InputDef[];
  values: Record<string, number | boolean | string>;
  onChange: (id: string, v: number | boolean | string) => void;
}) {
  if (inputs.length === 0) return null;
  return (
    <div className="rounded-md border border-border bg-surface-raised/60 p-2.5">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Inputs</div>
      <div className="flex flex-col gap-2">
        {inputs.map((def) => {
          const cur = values[def.id] ?? def.default;
          return (
            <label key={def.id} className="flex items-center justify-between gap-2">
              <span className="truncate text-foreground" title={def.title}>{def.title}</span>
              {def.kind === 'bool' ? (
                <Switch checked={Boolean(cur)} onCheckedChange={(v) => onChange(def.id, v)} />
              ) : def.kind === 'source' ? (
                <Select value={String(cur)} onValueChange={(v) => onChange(def.id, v)}>
                  <SelectTrigger className="h-7 w-32 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(def.options ?? []).map((o) => (
                      <SelectItem key={o} value={o}>{o}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : def.kind === 'num' ? (
                <Input
                  type="number"
                  className="h-7 w-24 text-xs"
                  value={Number(cur)}
                  min={def.min}
                  max={def.max}
                  step={def.step ?? 1}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) onChange(def.id, n);
                  }}
                />
              ) : (
                <Input
                  type="text"
                  className="h-7 w-32 text-xs"
                  value={String(cur)}
                  onChange={(e) => onChange(def.id, e.target.value)}
                />
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}
