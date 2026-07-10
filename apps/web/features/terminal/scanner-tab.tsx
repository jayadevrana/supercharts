'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronUp, Play, Plus, RefreshCw, Save, Trash2, TriangleAlert, X } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { formatCompact, formatPercent, formatPrice, formatSymbolLabel } from '@/lib/format';
import { sortScanRows, summarizeScan, type ScanSortDir, type ScanSortKey, type UiScanRow } from './scanner-tab-util';
import { buildCustomScreen, describeRow, type ScreenRow } from './scanner-screen-util';

/** 24h Binance movers row (legacy Movers mode — endpoint untouched). */
interface TopMover {
  symbol: string;
  lastPrice: number;
  changePercent: number;
  quoteVolume: number;
}

interface ScanPresetMeta {
  id: string;
  name: string;
  description: string;
}

interface ScanResponse {
  rows: UiScanRow[];
  matchedCount: number;
  total: number;
  interval: string;
  scannedAt: number;
}

interface SavedScreen {
  id: string;
  name: string;
  config: { logic: 'all' | 'any'; rows: ScreenRow[]; interval?: string };
}

const DEFAULT_ROW: ScreenRow = { kind: 'rsi', length: 14, op: '<', value: 30 };

const SCAN_INTERVALS = ['15m', '1h', '4h', '1d'] as const;
const SCAN_REFRESH_MS = 30_000;
const MOVERS_REFRESH_MS = 12_000;

/** Metric columns — key must exist in ScanRow.metrics (see apps/api/src/scanner.ts). */
const COLUMNS: Array<{ key: ScanSortKey; label: string; title: string }> = [
  { key: 'close', label: 'Last', title: 'Last closed-bar price' },
  { key: 'changePct', label: 'Chg%', title: '% change over ~24h of bars' },
  { key: 'rsi', label: 'RSI', title: 'RSI(14) on the scan timeframe' },
  { key: 'emaDistPct', label: 'EMAΔ%', title: 'Distance from EMA(21), %' },
  { key: 'rvol', label: 'RVOL', title: 'Relative volume vs its average' },
];

const fmtMetric = (key: ScanSortKey, v: number | null): string => {
  if (v === null || v === undefined) return '—';
  if (key === 'close') return formatPrice(v);
  if (key === 'volume') return formatCompact(v);
  if (key === 'changePct' || key === 'emaDistPct') return formatPercent(v);
  return v.toFixed(2);
};

/**
 * Scanner tab — a real screener over the symbol catalog (SCAN-2). Modes: 24h Top movers
 * (legacy list) + server-side preset screens on a chosen timeframe. Every number comes from
 * real candles via POST /api/scanner/scan; rows without enough data are reported, never faked.
 */
export function ScannerTab({ onPick }: { onPick: (s: string) => void }) {
  const [presets, setPresets] = useState<ScanPresetMeta[]>([]);
  const [mode, setMode] = useState<string>('movers'); // 'movers' | 'all' | preset id
  const [interval, setIntervalTf] = useState<(typeof SCAN_INTERVALS)[number]>('1h');
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [sortKey, setSortKey] = useState<ScanSortKey>('changePct');
  const [sortDir, setSortDir] = useState<ScanSortDir>('desc');
  const [movers, setMovers] = useState<TopMover[] | null>(null);
  const scanSeq = useRef(0);
  // Custom builder (SCAN-3): rows + logic, and per-user saved screens.
  const [rows, setRows] = useState<ScreenRow[]>([DEFAULT_ROW]);
  const [logic, setLogic] = useState<'all' | 'any'>('all');
  const [saved, setSaved] = useState<SavedScreen[]>([]);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const logicRef = useRef(logic);
  logicRef.current = logic;

  // Script scan (M2/SCAN-4): pick a saved PulseScript and run it across the universe.
  const [scripts, setScripts] = useState<Array<{ id: string; name: string }>>([]);
  const [scriptId, setScriptId] = useState<string>('');
  const scriptIdRef = useRef(scriptId);
  scriptIdRef.current = scriptId;

  const loadSaved = useCallback(() => {
    void api<{ items: SavedScreen[] }>('/scanner/screens')
      .then((r) => setSaved(r.items))
      .catch(() => setSaved([]));
  }, []);

  useEffect(() => {
    void api<{ presets: ScanPresetMeta[] }>('/scanner/presets')
      .then((r) => setPresets(r.presets))
      .catch(() => setPresets([]));
    void api<{ items: Array<{ id: string; name: string }> }>('/scripts')
      .then((r) => setScripts(r.items.map((s) => ({ id: s.id, name: s.name }))))
      .catch(() => setScripts([]));
    loadSaved();
  }, [loadSaved]);

  // Movers mode — the pre-existing 24h list, verbatim behavior.
  useEffect(() => {
    if (mode !== 'movers') return;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await api<{ items: TopMover[] }>('/scanner/top-movers');
        if (!cancelled) setMovers(r.items);
      } catch {
        if (!cancelled) setMovers([]);
      }
    };
    void load();
    const id = setInterval(load, MOVERS_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [mode]);

  const runScanNow = useCallback(async () => {
    const seq = ++scanSeq.current;
    setScanLoading(true);
    try {
      const body: Record<string, unknown> = { interval };
      if (mode === 'custom') body.screen = buildCustomScreen(rowsRef.current, logicRef.current);
      else if (mode === 'script') {
        if (!scriptIdRef.current) {
          setScanError('pick a saved script first');
          setScanLoading(false);
          return;
        }
        body.scriptId = scriptIdRef.current;
      } else if (mode !== 'all') body.preset = mode;
      const r = await api<ScanResponse>('/scanner/scan', { method: 'POST', body: JSON.stringify(body) });
      if (seq === scanSeq.current) {
        setScan(r);
        setScanError(null);
      }
    } catch (err) {
      if (seq === scanSeq.current) setScanError(err instanceof Error ? err.message : 'scan failed');
    } finally {
      if (seq === scanSeq.current) setScanLoading(false);
    }
  }, [mode, interval]);

  // Scan modes — fetch on mode/interval change + slow refresh (server caches 20s anyway).
  // Custom + Script modes run only on the explicit Run button.
  useEffect(() => {
    if (mode === 'movers' || mode === 'custom' || mode === 'script') return;
    setScan(null);
    setScanError(null);
    void runScanNow();
    const id = setInterval(() => void runScanNow(), SCAN_REFRESH_MS);
    return () => clearInterval(id);
  }, [mode, interval, runScanNow]);

  const onSort = (key: ScanSortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const visibleRows = useMemo(() => {
    if (!scan) return [];
    const ok = scan.rows.filter((r) => r.status === 'ok');
    const pool = mode === 'all' ? ok : ok.filter((r) => r.matched);
    return sortScanRows(pool, sortKey, sortDir);
  }, [scan, mode, sortKey, sortDir]);

  const summary = useMemo(() => (scan ? summarizeScan(scan.rows) : null), [scan]);
  const activePreset = presets.find((p) => p.id === mode);

  return (
    <div className="flex h-full flex-col">
      {/* Mode chips */}
      <div className="flex flex-wrap gap-1 border-b border-border/60 px-2 py-2">
        {[
          { id: 'movers', name: 'Movers', description: '24h top movers · Binance USDT pairs' },
          { id: 'all', name: 'All', description: 'Metrics table across the whole catalog' },
          ...presets,
          { id: 'custom', name: 'Custom', description: 'Build your own screen — conditions evaluated on real closed bars' },
          { id: 'script', name: 'Script', description: 'Run a saved PulseScript across every symbol — a match is a signal on the last closed bar' },
        ].map((p) => (
          <button
            key={p.id}
            onClick={() => {
              setMode(p.id);
              if (p.id === 'custom' || p.id === 'script') {
                setScan(null);
                setScanError(null);
              }
            }}
            title={p.description}
            aria-pressed={mode === p.id}
            className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
              mode === p.id ? 'bg-accent/15 text-accent' : 'text-muted-foreground hover:bg-surface-raised hover:text-foreground'
            }`}
          >
            {p.name}
          </button>
        ))}
      </div>

      {mode === 'movers' ? (
        <MoversList items={movers} onPick={onPick} />
      ) : (
        <>
          {mode === 'custom' ? (
            <ScreenBuilder
              rows={rows}
              setRows={setRows}
              logic={logic}
              setLogic={setLogic}
              saved={saved}
              onRun={() => void runScanNow()}
              running={scanLoading}
              onSave={async () => {
                const name = window.prompt('Screen name', 'My screen')?.trim();
                if (!name) return;
                try {
                  await api('/scanner/screens', {
                    method: 'POST',
                    body: JSON.stringify({ name, config: { logic, rows, interval } }),
                  });
                  loadSaved();
                } catch {
                  /* surfaced by list not updating; S2-ASYNC adds shared error toasts */
                }
              }}
              onLoad={(s) => {
                setRows(s.config.rows);
                setLogic(s.config.logic);
                setScan(null);
              }}
              onDelete={async (id) => {
                if (!window.confirm('Delete this saved screen?')) return;
                await api(`/scanner/screens/${id}`, { method: 'DELETE' }).catch(() => {});
                loadSaved();
              }}
            />
          ) : null}
          {mode === 'script' ? (
            <div className="flex items-center gap-1.5 border-b border-border/60 px-2 py-2">
              <select
                aria-label="Saved script"
                value={scriptId}
                onChange={(e) => setScriptId(e.target.value)}
                className="min-w-0 flex-1 rounded border border-border bg-surface-sunken px-1.5 py-1 text-[11px]"
              >
                <option value="">
                  {scripts.length === 0 ? 'No saved scripts yet — save one in the Script dock' : 'Pick a saved script…'}
                </option>
                {scripts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <Button
                size="xs"
                variant="primary"
                className="h-6 gap-1 px-2 text-[10px]"
                onClick={() => void runScanNow()}
                disabled={scanLoading || !scriptId}
                title="Run the script across every symbol — a match is a mark or alert() on the last closed bar"
              >
                <Play className="h-3 w-3" aria-hidden="true" /> {scanLoading ? 'Running…' : 'Run'}
              </Button>
            </div>
          ) : null}
          {/* Timeframe pills + refresh */}
          <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1.5">
            {SCAN_INTERVALS.map((tf) => (
              <button
                key={tf}
                onClick={() => setIntervalTf(tf)}
                aria-pressed={interval === tf}
                title={`Scan on the ${tf} timeframe`}
                className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                  interval === tf ? 'bg-accent/15 text-accent' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tf}
              </button>
            ))}
            <span className="ml-auto text-[10px] text-muted-foreground">
              {activePreset?.description ?? 'All symbols · real computed metrics'}
            </span>
            <button
              onClick={() => void runScanNow()}
              aria-label="Refresh scan"
              title="Refresh scan"
              className="ml-1 rounded p-1 text-muted-foreground hover:bg-surface-raised hover:text-foreground"
            >
              <RefreshCw className={`h-3 w-3 ${scanLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            </button>
          </div>

          {/* Body */}
          {scanError ? (
            <div className="flex flex-col items-center gap-2 p-6 text-center">
              <TriangleAlert className="h-5 w-5 text-warn" aria-hidden="true" />
              <div className="text-xs text-muted-foreground">Scan failed: {scanError}</div>
              <Button size="xs" variant="outline" onClick={() => void runScanNow()}>
                Retry
              </Button>
            </div>
          ) : !scan && (mode === 'custom' || mode === 'script') && !scanLoading ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              {mode === 'custom' ? (
                <>Build conditions above, then press <span className="font-semibold text-foreground">Run</span> — the screen evaluates on real closed bars across the whole catalog.</>
              ) : (
                <>Pick a saved PulseScript and press <span className="font-semibold text-foreground">Run</span> — a symbol matches when the script marks or alerts on its last closed bar.</>
              )}
            </div>
          ) : !scan ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-8" />
              ))}
            </div>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
                <table className="w-full border-collapse text-xs tabular-nums">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-border/60 text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-2 py-1.5 text-left">
                        <SortHeader label="Symbol" active={sortKey === 'symbol'} dir={sortDir} onClick={() => onSort('symbol')} />
                      </th>
                      {COLUMNS.map((c) => (
                        <th key={c.key} className="px-2 py-1.5 text-right" title={c.title}>
                          <SortHeader label={c.label} active={sortKey === c.key} dir={sortDir} onClick={() => onSort(c.key)} right />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.length === 0 ? (
                      <tr>
                        <td colSpan={COLUMNS.length + 1} className="px-3 py-6 text-center text-muted-foreground">
                          No matches right now — the screen ran on real closed bars.
                        </td>
                      </tr>
                    ) : (
                      visibleRows.map((r) => {
                        const chg = r.metrics.changePct;
                        return (
                          <tr
                            key={r.symbol}
                            onClick={() => onPick(r.symbol)}
                            className="cursor-pointer border-b border-border/40 transition-colors hover:bg-surface-raised"
                            title={`Open ${formatSymbolLabel(r.symbol)} on the active pane`}
                          >
                            <td className="px-2 py-1.5 font-medium">{formatSymbolLabel(r.symbol)}</td>
                            {COLUMNS.map((c) => (
                              <td
                                key={c.key}
                                className={`px-2 py-1.5 text-right ${
                                  c.key === 'changePct' && chg !== null ? (chg >= 0 ? 'text-bull' : 'text-bear') : ''
                                }`}
                              >
                                {fmtMetric(c.key, r.metrics[c.key] ?? null)}
                              </td>
                            ))}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {summary ? (
                <div className="border-t border-border/60 px-3 py-1.5 text-[10px] text-muted-foreground">
                  {summary.scanned} scanned · {mode === 'all' ? `${summary.scanned} shown` : `${summary.matched} matched`}
                  {summary.noData > 0 ? ` · ${summary.noData} without enough data` : ''}
                  {summary.scriptErrors > 0 ? ` · ${summary.scriptErrors} script errors` : ''} · {interval}
                </div>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}

function SortHeader({ label, active, dir, onClick, right }: { label: string; active: boolean; dir: ScanSortDir; onClick: () => void; right?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-label={`Sort by ${label}`}
      className={`inline-flex items-center gap-0.5 ${right ? 'justify-end' : ''} hover:text-foreground ${active ? 'text-accent' : ''}`}
    >
      {label}
      {active ? (dir === 'asc' ? <ChevronUp className="h-3 w-3" aria-hidden="true" /> : <ChevronDown className="h-3 w-3" aria-hidden="true" />) : null}
    </button>
  );
}

/** Custom-screen builder rows + saved-screen chips (SCAN-3). */
function ScreenBuilder({
  rows,
  setRows,
  logic,
  setLogic,
  saved,
  onRun,
  running,
  onSave,
  onLoad,
  onDelete,
}: {
  rows: ScreenRow[];
  setRows: (r: ScreenRow[]) => void;
  logic: 'all' | 'any';
  setLogic: (l: 'all' | 'any') => void;
  saved: SavedScreen[];
  onRun: () => void;
  running: boolean;
  onSave: () => void;
  onLoad: (s: SavedScreen) => void;
  onDelete: (id: string) => void;
}) {
  const patch = (i: number, next: ScreenRow) => setRows(rows.map((r, j) => (j === i ? next : r)));
  const numInput = (value: number, onChange: (v: number) => void, width = 'w-14', label = 'value') => (
    <input
      type="number"
      aria-label={label}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={`${width} rounded border border-border bg-surface-sunken px-1 py-0.5 text-right text-[11px] tabular-nums`}
    />
  );
  const sel = (value: string, options: Array<[string, string]>, onChange: (v: string) => void, label: string) => (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded border border-border bg-surface-sunken px-1 py-0.5 text-[11px]"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );

  return (
    <div className="space-y-1.5 border-b border-border/60 px-2 py-2">
      {saved.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Saved</span>
          {saved.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-0.5 rounded bg-surface-raised px-1.5 py-0.5 text-[10px]">
              <button onClick={() => onLoad(s)} title={s.config.rows.map((r) => describeRow(r)).join(' · ')} className="hover:text-accent">
                {s.name}
              </button>
              <button onClick={() => onDelete(s.id)} aria-label={`Delete saved screen ${s.name}`} className="text-muted-foreground hover:text-bear">
                <Trash2 className="h-2.5 w-2.5" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {rows.map((row, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1 text-[11px]">
          {sel(
            row.kind,
            [
              ['rsi', 'RSI'],
              ['price_vs_ema', 'Close vs EMA'],
              ['rvol', 'RVOL'],
            ],
            (v) => {
              if (v === 'rsi') patch(i, { kind: 'rsi', length: 14, op: '<', value: 30 });
              else if (v === 'price_vs_ema') patch(i, { kind: 'price_vs_ema', length: 21, op: 'crosses_above' });
              else patch(i, { kind: 'rvol', op: '>', value: 2 });
            },
            'condition type',
          )}
          {row.kind !== 'rvol' ? numInput(row.length, (v) => patch(i, { ...row, length: Math.max(1, v) }), 'w-12', 'length') : null}
          {row.kind === 'price_vs_ema'
            ? sel(
                row.op,
                [
                  ['crosses_above', 'crosses ↑'],
                  ['crosses_below', 'crosses ↓'],
                  ['>', 'above'],
                  ['<', 'below'],
                ],
                (v) => patch(i, { ...row, op: v as typeof row.op }),
                'operator',
              )
            : sel(
                row.op,
                [
                  ['>', '>'],
                  ['<', '<'],
                ],
                (v) => patch(i, { ...row, op: v as '>' | '<' }),
                'operator',
              )}
          {row.kind !== 'price_vs_ema' ? numInput(row.value, (v) => patch(i, { ...row, value: v }), 'w-14', 'threshold') : null}
          <button
            onClick={() => setRows(rows.filter((_, j) => j !== i))}
            disabled={rows.length === 1}
            aria-label="Remove condition"
            className="rounded p-0.5 text-muted-foreground hover:text-bear disabled:opacity-30"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
      ))}

      <div className="flex items-center gap-1.5 pt-0.5">
        <Button size="xs" variant="outline" className="h-6 gap-1 px-1.5 text-[10px]" onClick={() => setRows([...rows, { ...DEFAULT_ROW }])} disabled={rows.length >= 10}>
          <Plus className="h-3 w-3" aria-hidden="true" /> Condition
        </Button>
        <button
          onClick={() => setLogic(logic === 'all' ? 'any' : 'all')}
          aria-label="Toggle match logic"
          title={logic === 'all' ? 'Every condition must match' : 'Any condition may match'}
          className="rounded bg-surface-raised px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground hover:text-foreground"
        >
          {logic}
        </button>
        <Button size="xs" variant="primary" className="ml-auto h-6 gap-1 px-2 text-[10px]" onClick={onRun} disabled={running}>
          <Play className="h-3 w-3" aria-hidden="true" /> {running ? 'Running…' : 'Run'}
        </Button>
        <Button size="xs" variant="outline" className="h-6 gap-1 px-1.5 text-[10px]" onClick={onSave} title="Save this screen">
          <Save className="h-3 w-3" aria-hidden="true" /> Save
        </Button>
      </div>
    </div>
  );
}

function MoversList({ items, onPick }: { items: TopMover[] | null; onPick: (s: string) => void }) {
  if (!items) {
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
      <div className="border-b border-border/60 px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        Top movers · last 24h · Binance USDT pairs
      </div>
      {items.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-muted-foreground">No movers data right now.</div>
      ) : (
        <div className="divide-y divide-border/60">
          {items.map((m) => {
            const up = m.changePercent >= 0;
            return (
              <button
                key={m.symbol}
                onClick={() => onPick(m.symbol)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-raised"
              >
                <div className="flex items-center gap-2">
                  {up ? <ArrowUpRight className="h-3.5 w-3.5 text-bull" /> : <ArrowDownRight className="h-3.5 w-3.5 text-bear" />}
                  <span className="text-sm font-medium">{formatSymbolLabel(m.symbol)}</span>
                </div>
                <div className="flex items-center gap-3 text-xs tabular-nums">
                  <span className="text-muted-foreground">{formatCompact(m.quoteVolume)}</span>
                  <span className={up ? 'text-bull' : 'text-bear'}>{formatPercent(m.changePercent)}</span>
                  <span className="text-foreground">{formatPrice(m.lastPrice)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
