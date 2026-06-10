'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Code2, Play, RotateCcw, TriangleAlert, CheckCircle2, Save, FolderOpen, Trash2, ChevronDown, FlaskConical, Loader2, TrendingUp, TrendingDown, Trophy } from 'lucide-react';
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

/** One pass of POST /api/optimize/script — a swept setting of the script's own inputs. */
interface ScriptOptCombo {
  inputs: Record<string, number>;
  summary: { totalReturnPct: number; winRate: number; trades: number; maxDrawdownPct: number; profitFactor: number };
  metrics?: { profitFactorCapped: number; rank: number; robustness: { flags: string[]; tone: 'green' | 'amber' | 'red' } };
}
interface ScriptOptResponse {
  barsTested: number;
  sweepMs: number;
  planned: number;
  evaluated: number;
  qualifying: number;
  truncated: boolean;
  scriptErrors: number;
  combos: ScriptOptCombo[];
  fallbackCombos?: ScriptOptCombo[];
  note?: string;
}
/** Per-input sweep config in the Optimizer tab. */
interface SweepCfg {
  on: boolean;
  from: string;
  step: string;
  to: string;
}

/** Result of POST /api/backtest/script — the script's marks backtested on real candles. */
interface ScriptBacktest {
  symbol: string;
  interval: string;
  barsTested: number;
  script: { name: string; buySignals: number; sellSignals: number };
  realism?: { commissionPct?: number; slippagePct?: number; stopLossPct?: number; takeProfitPct?: number };
  trades: Array<{
    side: 'buy' | 'sell';
    entryTime: number;
    entryPrice: number;
    exitTime: number;
    exitPrice: number;
    bars: number;
    pnlPercent: number;
    exitReason?: 'cross' | 'stop' | 'target' | 'end';
  }>;
  equity: Array<{ time: number; equity: number; drawdown: number }>;
  summary: {
    trades: number;
    wins: number;
    losses: number;
    winRate: number;
    totalReturnPct: number;
    maxDrawdownPct: number;
    sharpe: number;
    profitFactor: number;
    avgWinPct: number;
    avgLossPct: number;
    avgBars: number;
  };
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
  // Right column: Console (run output + inputs) | Strategy Tester | input Optimizer.
  const [rightTab, setRightTab] = useState<'console' | 'tester' | 'optimizer'>('console');
  const [btRunning, setBtRunning] = useState(false);
  const [btResult, setBtResult] = useState<ScriptBacktest | null>(null);
  const [btError, setBtError] = useState<string | null>(null);
  const [commission, setCommission] = useState('');
  const [slippage, setSlippage] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  // Input optimizer (MetaTrader-style sweep of the script's own input.num parameters).
  const [sweepCfg, setSweepCfg] = useState<Record<string, SweepCfg>>({});
  const [optObjective, setOptObjective] = useState<'profit' | 'accuracy' | 'balanced'>('balanced');
  const [optMinWin, setOptMinWin] = useState(0);
  const [optRunning, setOptRunning] = useState(false);
  const [optResult, setOptResult] = useState<ScriptOptResponse | null>(null);
  const [optError, setOptError] = useState<string | null>(null);
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

  // Seed sweep ranges from the script's discovered numeric inputs (after a Run). The
  // default range brackets each input's declared default (½×..2×, clamped to min/max)
  // so the out-of-the-box grid stays under the server's 1000-combo cap.
  const numInputs = (result?.inputs ?? []).filter((d) => d.kind === 'num');
  useEffect(() => {
    if (numInputs.length === 0) return;
    setSweepCfg((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const d of numInputs) {
        if (next[d.id]) continue;
        const dflt = Number(d.default) || 1;
        const lo = Math.max(d.min ?? 1, Math.ceil(dflt / 2));
        const hi = Math.min(d.max ?? dflt * 2, Math.max(lo + 1, Math.round(dflt * 2)));
        next[d.id] = { on: false, from: String(lo), step: String(d.step ?? 1), to: String(hi) };
        changed = true;
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numInputs.map((d) => d.id).join('|')]);

  const sweptEntries = Object.entries(sweepCfg).filter(
    ([id, c]) => c.on && numInputs.some((d) => d.id === id),
  );
  const optComboCount = sweptEntries.reduce((acc, [, c]) => {
    const from = parseFloat(c.from);
    const to = parseFloat(c.to);
    const step = parseFloat(c.step);
    if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(step) || step <= 0 || to < from) return 0;
    return acc * (Math.floor((to - from) / step) + 1);
  }, sweptEntries.length > 0 ? 1 : 0);

  const runOptimize = async (obj = optObjective, minWin = optMinWin): Promise<void> => {
    setOptRunning(true);
    setOptError(null);
    const pct = (s: string): number | undefined => {
      const v = parseFloat(s);
      return Number.isFinite(v) && v > 0 ? v : undefined;
    };
    try {
      const r = await api<ScriptOptResponse>('/optimize/script', {
        method: 'POST',
        body: JSON.stringify({
          symbol: pane.symbol,
          interval: pane.interval,
          source: draft,
          inputs: pane.pulse.inputValues,
          ranges: Object.fromEntries(
            sweptEntries.map(([id, c]) => [id, { from: parseFloat(c.from), step: parseFloat(c.step), to: parseFloat(c.to) }]),
          ),
          objective: obj,
          minWinRate: minWin > 0 ? minWin / 100 : undefined,
          topN: 20,
          ...(pct(commission) != null ? { commissionPct: pct(commission) } : {}),
          ...(pct(slippage) != null ? { slippagePct: pct(slippage) } : {}),
          ...(pct(stopLoss) != null ? { stopLossPct: pct(stopLoss) } : {}),
          ...(pct(takeProfit) != null ? { takeProfitPct: pct(takeProfit) } : {}),
        }),
      });
      setOptResult(r);
    } catch (err) {
      setOptResult(null);
      setOptError(err instanceof Error ? err.message : String(err));
    } finally {
      setOptRunning(false);
    }
  };

  /** Apply a swept setting: write each value into the script's inputs and re-run on chart. */
  const applyCombo = (c: ScriptOptCombo): void => {
    for (const [id, v] of Object.entries(c.inputs)) setPulseInput(pane.id, id, v);
    run();
    toast({ title: 'Setting applied', description: Object.entries(c.inputs).map(([k, v]) => `${k}=${v}`).join(' · '), tone: 'success' });
  };

  // Strategy Tester: run THIS script server-side over real candles and backtest its
  // mark buy/sell output (same trade model + realism layer as the MA-cross tester).
  const runBacktest = async (): Promise<void> => {
    setRightTab('tester');
    setBtRunning(true);
    setBtError(null);
    // Also push the script to the chart so the user SEES the marks being traded.
    run();
    const pct = (s: string): number | undefined => {
      const v = parseFloat(s);
      return Number.isFinite(v) && v > 0 ? v : undefined;
    };
    try {
      const r = await api<ScriptBacktest>('/backtest/script', {
        method: 'POST',
        body: JSON.stringify({
          symbol: pane.symbol,
          interval: pane.interval,
          source: draft,
          inputs: pane.pulse.inputValues,
          ...(pct(commission) != null ? { commissionPct: pct(commission) } : {}),
          ...(pct(slippage) != null ? { slippagePct: pct(slippage) } : {}),
          ...(pct(stopLoss) != null ? { stopLossPct: pct(stopLoss) } : {}),
          ...(pct(takeProfit) != null ? { takeProfitPct: pct(takeProfit) } : {}),
        }),
      });
      setBtResult(r);
    } catch (err) {
      setBtResult(null);
      // The API returns line-numbered script errors as 400 {error, message} — show them verbatim.
      setBtError(err instanceof Error ? err.message : String(err));
    } finally {
      setBtRunning(false);
    }
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
          <Button size="sm" variant="outline" className="gap-1" onClick={() => void runBacktest()} disabled={btRunning} title="Backtest this script's buy/sell marks on real candles">
            {btRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />} Backtest
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => setOpen(false)} title="Close editor">
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Body: editor + console/inputs */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_340px]" style={{ height: bodyH }}>
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
        <div className="flex min-h-0 flex-col text-xs">
          {/* Right-column tabs — TradingView's Pine Editor / Strategy Tester split. */}
          <div className="flex shrink-0 border-b border-border">
            {(
              [
                ['console', 'Console'],
                ['tester', 'Tester'],
                ['optimizer', 'Optimizer'],
              ] as const
            ).map(([t, label]) => (
              <button
                key={t}
                onClick={() => setRightTab(t)}
                className={`flex-1 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                  rightTab === t ? 'border-b-2 border-accent text-accent' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {rightTab === 'optimizer' ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto p-3 scroll-thin">
              {numInputs.length === 0 ? (
                <div className="rounded-md border border-border bg-surface-raised/60 p-2.5 text-muted-foreground">
                  Press <span className="font-medium text-foreground">Run</span> first — the optimizer sweeps your script&apos;s{' '}
                  <code>input.num</code> parameters, so it needs a run to discover them.
                </div>
              ) : (
                <>
                  <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    Sweep these inputs · from / step / to
                  </div>
                  {numInputs.map((d) => {
                    const c = sweepCfg[d.id];
                    if (!c) return null;
                    return (
                      <div key={d.id} className="flex items-center gap-1.5">
                        <Switch checked={c.on} onCheckedChange={(v) => setSweepCfg((p) => ({ ...p, [d.id]: { ...c, on: v } }))} />
                        <span className="w-20 truncate text-[11px] text-foreground" title={d.title}>{d.title}</span>
                        {(['from', 'step', 'to'] as const).map((k) => (
                          <Input
                            key={k}
                            type="number"
                            value={c[k]}
                            disabled={!c.on}
                            onChange={(e) => setSweepCfg((p) => ({ ...p, [d.id]: { ...c, [k]: e.target.value } }))}
                            className="h-7 w-14 text-xs"
                          />
                        ))}
                      </div>
                    );
                  })}
                  <div className="flex overflow-hidden rounded-md border border-border">
                    {(
                      [
                        ['profit', '💰 Profit'],
                        ['accuracy', '🎯 Accuracy'],
                        ['balanced', '⚖️ Balanced'],
                      ] as const
                    ).map(([o, label]) => (
                      <button
                        key={o}
                        onClick={() => { setOptObjective(o); if (optResult) void runOptimize(o); }}
                        className={`flex-1 px-1 py-1.5 text-[11px] transition-colors ${optObjective === o ? 'bg-accent/20 font-medium text-accent' : 'text-muted-foreground hover:text-foreground'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    Min win ≥ {optMinWin}%
                    <input
                      type="range" min={0} max={90} step={5} value={optMinWin}
                      onChange={(e) => setOptMinWin(+e.target.value)}
                      onPointerUp={() => { if (optResult) void runOptimize(); }}
                      className="flex-1 accent-[hsl(var(--accent))]"
                    />
                  </label>
                  <Button
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => void runOptimize()}
                    disabled={optRunning || optComboCount === 0 || optComboCount > 1000}
                  >
                    {optRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trophy className="h-3.5 w-3.5" />}
                    Find best settings · {optComboCount.toLocaleString()} combos
                  </Button>
                  {optComboCount > 1000 ? <div className="text-[10px] text-bear">Over the 1000-combination cap — raise the steps.</div> : null}
                  {optComboCount === 0 && sweptEntries.length === 0 ? (
                    <div className="text-[10px] text-muted-foreground">Toggle at least one input to sweep.</div>
                  ) : null}

                  {optError ? (
                    <div className="rounded-md border border-bear/40 bg-bear/10 p-2.5">
                      <pre className="whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-bear">{optError}</pre>
                    </div>
                  ) : null}
                  {optResult ? (
                    <>
                      <div className="text-[10px] text-muted-foreground">
                        <span className="font-semibold text-foreground">{optResult.evaluated.toLocaleString()} of {optResult.planned.toLocaleString()} combos</span>
                        {' '}· {optResult.qualifying} qualified · {optResult.barsTested} candles · {(optResult.sweepMs / 1000).toFixed(1)}s
                        {optResult.scriptErrors > 0 ? ` · ${optResult.scriptErrors} run errors` : ''}
                      </div>
                      {optResult.note ? <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[10px] text-amber-200">{optResult.note}</div> : null}
                      {(() => {
                        const isFallback = optResult.combos.length === 0 && (optResult.fallbackCombos?.length ?? 0) > 0;
                        const rows = isFallback ? optResult.fallbackCombos! : optResult.combos;
                        if (rows.length === 0) return null;
                        return (
                          <>
                            {isFallback ? (
                              <div className="rounded-md border border-border bg-surface-raised/60 p-2 text-[10px] text-muted-foreground">
                                Closest candidates — <span className="font-medium text-foreground">none meets the quality bar</span>; not tradeable settings.
                              </div>
                            ) : null}
                            <div className="overflow-hidden rounded-md border border-border">
                              <table className="w-full text-left text-[10px]">
                                <thead className="bg-surface-raised/60 text-[8px] uppercase tracking-[0.1em] text-muted-foreground">
                                  <tr>
                                    <th className="px-1.5 py-1">#</th>
                                    <th className="px-1.5 py-1">Setting</th>
                                    <th className="px-1.5 py-1 text-right">Ret</th>
                                    <th className="px-1.5 py-1 text-right">Win</th>
                                    <th className="px-1.5 py-1 text-right">Tr</th>
                                    <th className="px-1.5 py-1" />
                                  </tr>
                                </thead>
                                <tbody>
                                  {rows.map((c) => {
                                    const tone = c.metrics?.robustness.tone ?? 'amber';
                                    return (
                                      <tr key={Object.values(c.inputs).join('|')} className="border-t border-border/60">
                                        <td className="px-1.5 py-0.5 text-muted-foreground">{c.metrics?.rank}</td>
                                        <td className="px-1.5 py-0.5">
                                          <span
                                            className={`font-medium ${tone === 'green' ? 'text-bull' : tone === 'red' ? 'text-bear' : 'text-amber-300'}`}
                                            title={c.metrics?.robustness.flags.join(' · ')}
                                          >
                                            {Object.entries(c.inputs).map(([k, v]) => `${k}=${v}`).join(' ')}
                                          </span>
                                        </td>
                                        <td className={`px-1.5 py-0.5 text-right tabular-nums ${c.summary.totalReturnPct >= 0 ? 'text-bull' : 'text-bear'}`}>
                                          {c.summary.totalReturnPct >= 0 ? '+' : ''}{c.summary.totalReturnPct.toFixed(1)}%
                                        </td>
                                        <td className="px-1.5 py-0.5 text-right tabular-nums">{(c.summary.winRate * 100).toFixed(0)}%</td>
                                        <td className="px-1.5 py-0.5 text-right tabular-nums text-muted-foreground">{c.summary.trades}</td>
                                        <td className="px-1.5 py-0.5 text-right">
                                          <button
                                            className="rounded border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground transition-colors hover:border-accent hover:text-accent"
                                            onClick={() => applyCombo(c)}
                                          >
                                            Apply
                                          </button>
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                            <p className="leading-relaxed text-[9px] text-muted-foreground/70">
                              Every row re-ran YOUR script on the same {optResult.barsTested} real candles and backtested its marks. Hover a setting
                              for robustness flags. <strong>Apply</strong> writes the values into the script&apos;s inputs and re-runs it on the chart.
                            </p>
                          </>
                        );
                      })()}
                    </>
                  ) : !optError ? (
                    <div className="rounded-md border border-border bg-surface-raised/60 p-2.5 text-muted-foreground">
                      Toggle the inputs to sweep, set from/step/to, and press{' '}
                      <span className="font-medium text-foreground">Find best settings</span> — like MetaTrader&apos;s optimizer, but for your PulseScript.
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : rightTab === 'console' ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 scroll-thin">
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
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-auto p-3 scroll-thin">
              {/* Realism layer — blank = OFF (plain model). */}
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    ['Commission %/side', commission, setCommission],
                    ['Slippage %', slippage, setSlippage],
                    ['Stop loss %', stopLoss, setStopLoss],
                    ['Take profit %', takeProfit, setTakeProfit],
                  ] as const
                ).map(([label, value, set]) => (
                  <label key={label} className="flex flex-col gap-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    {label}
                    <Input type="number" min={0} step="0.01" placeholder="off" value={value} onChange={(e) => set(e.target.value)} className="h-7 text-xs" />
                  </label>
                ))}
              </div>
              <Button size="sm" className="h-8 gap-1.5" onClick={() => void runBacktest()} disabled={btRunning}>
                {btRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
                Backtest on {formatSymbolLabel(pane.symbol)} · {pane.interval}
              </Button>

              {btError ? (
                <div className="rounded-md border border-bear/40 bg-bear/10 p-2.5">
                  <div className="mb-1 flex items-center gap-1.5 font-semibold text-bear">
                    <TriangleAlert className="h-3.5 w-3.5" /> Backtest failed
                  </div>
                  <pre className="whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-bear">{btError}</pre>
                </div>
              ) : null}

              {btResult ? <TesterReport r={btResult} /> : !btError ? (
                <div className="rounded-md border border-border bg-surface-raised/60 p-2.5 text-muted-foreground">
                  Press <span className="font-medium text-foreground">Backtest</span> — your script&apos;s{' '}
                  <code>mark buy</code> / <code>mark sell</code> become the entries: enter at the mark&apos;s
                  bar close, exit + flip on the next opposite mark. The same marks render on the chart, so
                  you can verify every trade against real candles.
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TesterReport({ r }: { r: ScriptBacktest }) {
  const s = r.summary;
  const fmtPct = (n: number, dp = 1): string => `${n >= 0 ? '+' : ''}${n.toFixed(dp)}%`;
  const eq = r.equity.map((p) => p.equity);
  const stats: Array<[string, string, 'pos' | 'neg' | undefined]> = [
    ['Net return', fmtPct(s.totalReturnPct, 2), s.totalReturnPct >= 0 ? 'pos' : 'neg'],
    ['Win rate', `${(s.winRate * 100).toFixed(0)}% (${s.wins}W/${s.losses}L)`, undefined],
    ['Trades', `${s.trades} · avg ${s.avgBars.toFixed(0)} bars`, undefined],
    ['Profit factor', Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞', undefined],
    ['Max drawdown', fmtPct(-s.maxDrawdownPct), 'neg'],
    ['Sharpe', s.sharpe.toFixed(2), undefined],
  ];
  return (
    <>
      <div className="rounded-md border border-bull/40 bg-bull/10 p-2">
        <div className="flex items-center gap-1.5 font-semibold text-bull">
          <CheckCircle2 className="h-3.5 w-3.5" /> {r.script.name}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {r.barsTested} real candles · {r.script.buySignals} buy / {r.script.sellSignals} sell marks
          {r.realism ? ' · realism on' : ''}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {stats.map(([label, value, tone]) => (
          <div key={label} className="rounded-md border border-border bg-surface-raised/40 px-2 py-1.5">
            <div className="text-[8px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</div>
            <div className={`text-[11px] font-semibold tabular-nums ${tone === 'pos' ? 'text-bull' : tone === 'neg' ? 'text-bear' : 'text-foreground'}`}>{value}</div>
          </div>
        ))}
      </div>
      {eq.length >= 2 ? (
        <div className="rounded-md border border-border bg-surface-raised/40 p-2">
          <div className="mb-1 text-[8px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Equity (base 100)</div>
          <svg viewBox="0 0 260 48" preserveAspectRatio="none" className="block h-12 w-full">
            {(() => {
              const min = Math.min(100, ...eq);
              const max = Math.max(100, ...eq);
              const span = max - min || 1;
              const pts = eq.map((v, i) => `${(i / (eq.length - 1)) * 260},${48 - ((v - min) / span) * 48}`).join(' ');
              const baseY = 48 - ((100 - min) / span) * 48;
              const up = eq[eq.length - 1]! >= 100;
              return (
                <>
                  <line x1={0} y1={baseY} x2={260} y2={baseY} stroke="currentColor" className="text-border" strokeWidth={1} strokeDasharray="3 3" />
                  <polyline points={pts} fill="none" stroke="currentColor" className={up ? 'text-bull' : 'text-bear'} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                </>
              );
            })()}
          </svg>
        </div>
      ) : null}
      <div className="overflow-hidden rounded-md border border-border">
        <table className="w-full text-left text-[10px]">
          <thead className="bg-surface-raised/60 text-[8px] uppercase tracking-[0.1em] text-muted-foreground">
            <tr>
              <th className="px-1.5 py-1">Side</th>
              <th className="px-1.5 py-1">Entry → Exit</th>
              <th className="px-1.5 py-1 text-right">P&L</th>
            </tr>
          </thead>
          <tbody>
            {r.trades.slice(-25).reverse().map((t, i) => (
              <tr key={`${t.entryTime}-${i}`} className="border-t border-border/60">
                <td className="px-1.5 py-0.5">
                  <span className={`inline-flex items-center gap-0.5 ${t.side === 'buy' ? 'text-bull' : 'text-bear'}`}>
                    {t.side === 'buy' ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                    {t.side === 'buy' ? 'L' : 'S'}
                  </span>
                  {t.exitReason && t.exitReason !== 'cross' ? (
                    <span className="ml-1 rounded bg-muted px-1 text-[8px] uppercase text-muted-foreground">{t.exitReason}</span>
                  ) : null}
                </td>
                <td className="px-1.5 py-0.5 tabular-nums text-muted-foreground">
                  {new Date(t.entryTime).toLocaleDateString([], { month: 'short', day: 'numeric' })} → {new Date(t.exitTime).toLocaleDateString([], { month: 'short', day: 'numeric' })} · {t.bars}b
                </td>
                <td className={`px-1.5 py-0.5 text-right tabular-nums font-medium ${t.pnlPercent >= 0 ? 'text-bull' : 'text-bear'}`}>{fmtPct(t.pnlPercent, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="leading-relaxed text-[9px] text-muted-foreground/70">
        Real backtest of your script&apos;s marks on the last {r.barsTested} closed candles. Entries fill at
        the mark bar&apos;s close; exit + flip on the next opposite mark{r.realism ? '; SL/TP assume worst-case intrabar ordering' : ''}.
        No fees/slippage unless set above. Compounded from base 100, no position sizing.
      </p>
    </>
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
