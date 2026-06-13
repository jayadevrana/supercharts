'use client';

import {
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { LineChart, Search, Star } from 'lucide-react';
import { INDICATOR_LOOKUP, type IndicatorSpec } from '@supercharts/indicators';
import type { IndicatorInstance } from '@supercharts/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useTerminalStore, type PaneState } from './terminal-store';
import { nanoid } from './nanoid';
import {
  EMPTY_PREFS,
  readPrefs,
  writePrefs,
  toggleFavorite,
  pushRecent,
  isFavorite,
  type IndicatorPrefs,
} from './indicator-prefs';

const entryId = (e: Entry): string => (e.kind === 'classic' ? e.type : e.key);

/**
 * Unified "Indicators" dialog (TradingView-style). A fresh chart is blank; the trader
 * opens this and toggles indicators on/off. It surfaces all three indicator systems in
 * one categorised, searchable list:
 *   - boolean overlays (pane.overlays.*)
 *   - SMC / order-flow flags (pane.smc.*)
 *   - classic TA from the registry (pane.classicIndicators[])
 *
 * Order-flow indicators need live trade/order-book data, which only the Binance (crypto)
 * feed supplies — on FX/metals/indices (Yahoo) they're flagged "needs order-flow data"
 * and render empty rather than fabricating anything.
 */

export type Entry =
  | { kind: 'overlay'; key: keyof PaneState['overlays']; label: string; desc: string; orderflow?: boolean; aliases?: string[] }
  | { kind: 'smc'; key: keyof PaneState['smc']; label: string; desc: string; orderflow?: boolean; aliases?: string[] }
  | { kind: 'classic'; type: string; label: string; desc: string; aliases?: string[] };

/**
 * Search aliases for an entry. Classic entries inherit the registry's acronyms (so "ema",
 * "bb", "sar" resolve even though the label spells the name out); overlay/SMC entries carry
 * their own inline aliases below.
 */
function aliasesFor(e: Entry): string[] {
  const own = e.aliases ?? [];
  if (e.kind === 'classic') return [...own, ...(INDICATOR_LOOKUP[e.type]?.aliases ?? [])];
  return own;
}

interface Group {
  group: string;
  items: Entry[];
}

const CATALOG: Group[] = [
  {
    group: 'Volume & Profile',
    items: [
      { kind: 'overlay', key: 'volume', label: 'Volume', desc: 'Per-bar volume histogram.' },
      { kind: 'overlay', key: 'profile', label: 'Volume Profile (VPVR)', desc: 'Volume traded at each price · POC / VAH / VAL.', aliases: ['vpvr', 'vp', 'volume profile'] },
      { kind: 'overlay', key: 'marketProfile', label: 'Market Profile (TPO)', desc: 'Per-session time-at-price histogram · POC + value area.', aliases: ['tpo', 'mp', 'market profile'] },
      { kind: 'overlay', key: 'heatmap', label: 'Liquidity Heatmap', desc: 'Resting order-book liquidity over time.', orderflow: true },
      { kind: 'smc', key: 'hvnLvn', label: 'HVN / LVN nodes', desc: 'High / low volume nodes.' },
      { kind: 'classic', type: 'vwap', label: 'VWAP', desc: 'Volume-weighted average price (session).' },
      { kind: 'classic', type: 'obv', label: 'On-Balance Volume', desc: 'Cumulative volume flow.' },
      { kind: 'classic', type: 'cmf', label: 'Chaikin Money Flow', desc: 'Money-flow over a period.' },
      { kind: 'classic', type: 'mfi', label: 'Money Flow Index', desc: 'Volume-weighted RSI.' },
      { kind: 'classic', type: 'rvol', label: 'Relative Volume (RVOL)', desc: 'Bar volume vs the average of prior bars. >1 = above-average.' },
      { kind: 'classic', type: 'initial_balance', label: 'Initial Balance', desc: 'First-hour session high/low range, drawn as reference levels.' },
      { kind: 'classic', type: 'naked_poc', label: 'Naked POC', desc: 'Untouched prior-session volume POCs (virgin points of control).' },
      { kind: 'classic', type: 'adl', label: 'Accumulation / Distribution', desc: 'Cumulative money-flow volume.' },
      { kind: 'classic', type: 'chaikin_osc', label: 'Chaikin Oscillator', desc: 'EMA(3)−EMA(10) of the A/D line.' },
      { kind: 'classic', type: 'eom', label: 'Ease of Movement', desc: 'Price move per unit volume.' },
      { kind: 'classic', type: 'pvt', label: 'Price Volume Trend', desc: 'Cumulative volume × percent change.' },
      { kind: 'classic', type: 'nvi', label: 'Negative Volume Index', desc: 'Price action on low-volume days.' },
      { kind: 'classic', type: 'pvi', label: 'Positive Volume Index', desc: 'Price action on high-volume days.' },
      { kind: 'classic', type: 'klinger', label: 'Klinger Volume Oscillator', desc: 'Volume-force EMAs + signal.' },
      { kind: 'classic', type: 'force_index', label: 'Elder Force Index', desc: 'Price change × volume, smoothed.' },
      { kind: 'classic', type: 'bull_bear_power', label: 'Elder Ray (Bull/Bear Power)', desc: 'High/low distance from an EMA.' },
      { kind: 'classic', type: 'net_volume', label: 'Net Volume', desc: 'Volume signed by price direction.' },
    ],
  },
  {
    group: 'Order Flow & Delta',
    items: [
      { kind: 'overlay', key: 'footprint', label: 'Footprint / Cluster', desc: 'Bid × ask volume per price cell.', orderflow: true, aliases: ['footprint', 'cluster', 'bid ask'] },
      { kind: 'overlay', key: 'deepTrades', label: 'Delta Bubbles', desc: 'Per-trade aggressive-flow bubbles.', orderflow: true, aliases: ['delta bubbles', 'trades'] },
      { kind: 'smc', key: 'cvdDivergence', label: 'CVD + Delta Divergence', desc: 'Cumulative volume delta + price/delta divergence.', orderflow: true, aliases: ['cvd', 'delta', 'divergence'] },
      { kind: 'overlay', key: 'timeAndSales', label: 'Time & Sales', desc: 'Live trade-by-trade tape (price · size · side).', orderflow: true },
      { kind: 'overlay', key: 'domLadder', label: 'DOM Ladder', desc: 'Live depth-of-market — top bid/ask sizes per price.', orderflow: true },
      { kind: 'overlay', key: 'openInterest', label: 'Open Interest', desc: 'Binance USD-M futures open interest + trend.', orderflow: true },
    ],
  },
  {
    group: 'Smart Money (SMC)',
    items: [
      { kind: 'smc', key: 'fvg', label: 'Fair Value Gaps', desc: 'Price imbalances / gaps.', aliases: ['fvg', 'imbalance', 'gap'] },
      { kind: 'smc', key: 'orderBlocks', label: 'Order Blocks', desc: 'Institutional order-block zones.', aliases: ['ob', 'order block'] },
      { kind: 'smc', key: 'liquidity', label: 'Liquidity Pools', desc: 'Equal highs/lows liquidity.', aliases: ['liquidity', 'eqh', 'eql'] },
      { kind: 'smc', key: 'liquiditySweeps', label: 'Liquidity Sweeps', desc: 'Stop-run / sweep markers.', aliases: ['sweep', 'stop run'] },
      { kind: 'smc', key: 'marketStructure', label: 'Market Structure (BOS/CHoCH)', desc: 'Break of structure / change of character.', aliases: ['bos', 'choch', 'market structure', 'mss'] },
      { kind: 'smc', key: 'premiumDiscount', label: 'Premium / Discount', desc: 'Dealing-range premium/discount zones.', aliases: ['premium', 'discount', 'ote'] },
      { kind: 'smc', key: 'anchoredVwap', label: 'Anchored VWAP', desc: 'VWAP anchored to a swing.', aliases: ['avwap', 'anchored vwap'] },
      { kind: 'smc', key: 'sessions', label: 'Sessions', desc: 'Asia / London / NY session boxes.' },
      { kind: 'smc', key: 'regimeBadge', label: 'Regime Badge', desc: 'Trend / range regime classifier.' },
    ],
  },
  {
    group: 'Signals',
    items: [
      { kind: 'overlay', key: 'signalsTrendScore', label: 'Signals & Trend Score', desc: 'MA cloud + ATR trail + buy/sell + MTF dashboards.', aliases: ['sts', 'signals', 'trend score'] },
    ],
  },
  {
    group: 'Moving Averages',
    items: [
      { kind: 'classic', type: 'sma', label: 'Simple MA', desc: 'Simple moving average.' },
      { kind: 'classic', type: 'ema', label: 'Exponential MA', desc: 'Exponential moving average.' },
      { kind: 'classic', type: 'wma', label: 'Weighted MA', desc: 'Weighted moving average.' },
      { kind: 'classic', type: 'hma', label: 'Hull MA', desc: 'Hull moving average.' },
    ],
  },
  {
    group: 'Bands & Channels',
    items: [
      { kind: 'classic', type: 'bollinger', label: 'Bollinger Bands', desc: 'SMA ± n·σ bands.' },
      { kind: 'classic', type: 'vwap_bands', label: 'VWAP Bands (σ)', desc: 'Session VWAP with ±σ standard-deviation bands.' },
      { kind: 'classic', type: 'keltner', label: 'Keltner Channels', desc: 'EMA ± ATR channels.' },
      { kind: 'classic', type: 'donchian', label: 'Donchian Channels', desc: 'N-bar high/low channel.' },
    ],
  },
  {
    group: 'Oscillators',
    items: [
      { kind: 'classic', type: 'rsi', label: 'RSI', desc: 'Relative strength index.' },
      { kind: 'classic', type: 'macd', label: 'MACD', desc: 'Moving-average convergence/divergence.' },
      { kind: 'classic', type: 'stochastic', label: 'Stochastic', desc: '%K / %D oscillator.' },
      { kind: 'classic', type: 'williams_r', label: 'Williams %R', desc: 'Momentum oscillator.' },
      { kind: 'classic', type: 'cci', label: 'CCI', desc: 'Commodity channel index.' },
      { kind: 'classic', type: 'roc', label: 'Rate of Change', desc: 'Momentum / ROC.' },
      { kind: 'classic', type: 'aroon', label: 'Aroon', desc: 'Trend-strength oscillator.' },
      { kind: 'classic', type: 'volume_oscillator', label: 'Volume Oscillator', desc: 'Fast/slow volume-MA spread.' },
      { kind: 'classic', type: 'stoch_rsi', label: 'Stochastic RSI', desc: 'Stochastic of RSI — faster overbought/oversold.' },
      { kind: 'classic', type: 'awesome', label: 'Awesome Oscillator', desc: 'SMA(5)−SMA(34) of median price.' },
      { kind: 'classic', type: 'momentum', label: 'Momentum', desc: 'Price minus price N bars ago.' },
      { kind: 'classic', type: 'trix', label: 'TRIX', desc: 'ROC of a triple-smoothed EMA.' },
      { kind: 'classic', type: 'ultimate', label: 'Ultimate Oscillator', desc: 'Three-timeframe buying pressure.' },
      { kind: 'classic', type: 'cmo', label: 'Chande Momentum', desc: 'Pure momentum, ±100.' },
      { kind: 'classic', type: 'dpo', label: 'Detrended Price Osc', desc: 'Price minus a displaced SMA — cycles.' },
      { kind: 'classic', type: 'fisher', label: 'Fisher Transform', desc: 'Gaussian-normalised turning points.' },
      { kind: 'classic', type: 'coppock', label: 'Coppock Curve', desc: 'Long-cycle momentum (WMA of ROCs).' },
      { kind: 'classic', type: 'kst', label: 'Know Sure Thing', desc: 'Weighted four-ROC momentum + signal.' },
      { kind: 'classic', type: 'tsi', label: 'True Strength Index', desc: 'Double-smoothed momentum + signal.' },
      { kind: 'classic', type: 'rvgi', label: 'Relative Vigor Index', desc: 'Close-open vigor vs range + signal.' },
      { kind: 'classic', type: 'bop', label: 'Balance of Power', desc: 'Buyers vs sellers in the bar range.' },
      { kind: 'classic', type: 'connors_rsi', label: 'Connors RSI', desc: 'RSI + streak-RSI + percent-rank.' },
      { kind: 'classic', type: 'smi', label: 'Stochastic Momentum Index', desc: 'Close vs range midpoint, smoothed.' },
      { kind: 'classic', type: 'wavetrend', label: 'WaveTrend Oscillator', desc: 'EMA-channel oscillator + signal cross.' },
      { kind: 'classic', type: 'squeeze_momentum', label: 'Squeeze Momentum', desc: 'Linreg momentum + BB-in-Keltner squeeze (TTM).' },
      { kind: 'classic', type: 'williams_vix_fix', label: 'Williams Vix Fix', desc: 'Synthetic VIX — spikes mark capitulation.' },
      { kind: 'classic', type: 'choppiness', label: 'Choppiness Index', desc: 'Trend vs chop regime.' },
      { kind: 'classic', type: 'vortex', label: 'Vortex Indicator', desc: 'VI+ / VI− trend-change crosses.' },
      { kind: 'classic', type: 'mass_index', label: 'Mass Index', desc: 'Range-expansion reversal warning.' },
      { kind: 'classic', type: 'stc', label: 'Schaff Trend Cycle', desc: 'Double-stochastic of MACD.' },
    ],
  },
  {
    group: 'Trend & Volatility',
    items: [
      { kind: 'classic', type: 'supertrend', label: 'Supertrend', desc: 'ATR-based trend follower.' },
      { kind: 'classic', type: 'psar', label: 'Parabolic SAR', desc: 'Stop-and-reverse dots.' },
      { kind: 'classic', type: 'ichimoku', label: 'Ichimoku Cloud', desc: 'Full Ichimoku system.' },
      { kind: 'classic', type: 'adx', label: 'ADX / DMI', desc: 'Directional movement / trend strength.' },
      { kind: 'classic', type: 'atr', label: 'Average True Range', desc: 'Volatility (ATR).' },
    ],
  },
];

export function buildInstance(spec: IndicatorSpec): IndicatorInstance {
  return {
    id: `${spec.type}_${nanoid().slice(0, 6)}`,
    type: spec.type,
    name: spec.label,
    paneId: spec.pane === 'overlay' ? 'price' : spec.type,
    inputs: Object.fromEntries(spec.inputs.map((i) => [i.key, i.default])) as IndicatorInstance['inputs'],
    style: { ...spec.style },
    visible: true,
    locked: false,
  };
}

/** MIME set when dragging an indicator row from this dialog onto the chart (drag-to-add, M6). */
export const INDICATOR_DND_MIME = 'application/x-sc-indicator';

/** Stable entry-id → Entry, so a drop target (the chart pane) can resolve a dragged indicator. */
export const ENTRY_INDEX: ReadonlyMap<string, Entry> = (() => {
  const m = new Map<string, Entry>();
  for (const g of CATALOG) for (const e of g.items) m.set(entryId(e), e);
  return m;
})();

export function IndicatorsDialog() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  // Chrome aggressively autofills the search field on open (Radix auto-focuses it),
  // dumping the user's email in and filtering the list to nothing. Hold the input
  // readOnly for a beat after open — Chrome won't autofill a readOnly field, and the
  // auto-focus lands during that window. Becomes editable right after.
  const [searchReady, setSearchReady] = useState(false);
  const [prefs, setPrefs] = useState<IndicatorPrefs>(EMPTY_PREFS);
  const [focusIdx, setFocusIdx] = useState(0);

  const onOpenChange = (v: boolean) => {
    setOpen(v);
    if (!v) setQ('');
  };
  // Open on request from other surfaces (chart context menu "Add indicator…").
  const dialogRequest = useTerminalStore((s) => s.dialogRequest);
  useEffect(() => {
    if (dialogRequest?.kind === 'indicators') setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialogRequest?.token]);
  useEffect(() => {
    if (!open) {
      setSearchReady(false);
      return;
    }
    setPrefs(readPrefs());
    setFocusIdx(0);
    const t = setTimeout(() => setSearchReady(true), 450);
    return () => clearTimeout(t);
  }, [open]);

  // Functional updater so rapid successive toggles (e.g. starring several rows quickly) compose
  // off the latest state instead of a stale render closure. Persist the freshly-derived value.
  const persist = (update: (p: IndicatorPrefs) => IndicatorPrefs): void => {
    setPrefs((prev) => {
      const next = update(prev);
      writePrefs(next);
      return next;
    });
  };

  const activePaneId = useTerminalStore((s) => s.activePaneId);
  const pane = useTerminalStore((s) => s.panes.find((p) => p.id === activePaneId) ?? s.panes[0]!);
  const togglePaneOverlay = useTerminalStore((s) => s.togglePaneOverlay);
  const toggleSmcOverlay = useTerminalStore((s) => s.toggleSmcOverlay);
  const addIndicator = useTerminalStore((s) => s.addIndicator);
  const removeIndicator = useTerminalStore((s) => s.removeIndicator);

  const isCrypto = pane.symbol.startsWith('BINANCE:');

  const isActive = (e: Entry): boolean => {
    if (e.kind === 'overlay') return pane.overlays[e.key];
    if (e.kind === 'smc') return pane.smc[e.key];
    return pane.classicIndicators.some((i) => i.type === e.type);
  };

  const toggle = (e: Entry): void => {
    const willActivate = !isActive(e);
    if (e.kind === 'overlay') {
      togglePaneOverlay(pane.id, e.key);
    } else if (e.kind === 'smc') {
      toggleSmcOverlay(pane.id, e.key);
    } else {
      // classic: one-instance-per-type toggle (advanced multi-instance lives in the Ind rail)
      const existing = pane.classicIndicators.filter((i) => i.type === e.type);
      if (existing.length > 0) existing.forEach((i) => removeIndicator(pane.id, i.id));
      else {
        const spec = INDICATOR_LOOKUP[e.type];
        if (spec) addIndicator(pane.id, buildInstance(spec));
      }
    }
    // Track in "recently used" the moment an indicator is switched on.
    if (willActivate) persist((p) => pushRecent(p, entryId(e)));
  };

  const star = (e: Entry, ev: ReactMouseEvent): void => {
    ev.stopPropagation();
    persist((p) => toggleFavorite(p, entryId(e)));
  };

  const activeCount = useMemo(() => {
    const ov = Object.values(pane.overlays).filter(Boolean).length;
    const smc = Object.values(pane.smc).filter(Boolean).length;
    return ov + smc + pane.classicIndicators.length;
  }, [pane]);

  const lower = q.trim().toLowerCase();
  const byId = ENTRY_INDEX;

  const matches = (e: Entry, group: string): boolean =>
    !lower ||
    e.label.toLowerCase().includes(lower) ||
    e.desc.toLowerCase().includes(lower) ||
    group.toLowerCase().includes(lower) ||
    aliasesFor(e).some((a) => a.includes(lower));

  // Sections in render + keyboard-focus order. Favorites and Recently-used lead, but only when
  // not searching (a search should reveal the full filtered catalog, not a partial pinned view).
  const sections = useMemo(() => {
    const out: { id: string; title: string; rows: { key: string; entry: Entry }[] }[] = [];
    if (!lower) {
      const fav = prefs.favorites
        .map((id) => byId.get(id))
        .filter((e): e is Entry => Boolean(e))
        .map((e) => ({ key: `fav:${entryId(e)}`, entry: e }));
      if (fav.length) out.push({ id: 'fav', title: '★ Favorites', rows: fav });
      const recent = prefs.recent
        .map((id) => byId.get(id))
        .filter((e): e is Entry => Boolean(e))
        .map((e) => ({ key: `recent:${entryId(e)}`, entry: e }));
      if (recent.length) out.push({ id: 'recent', title: 'Recently used', rows: recent });
    }
    for (const g of CATALOG) {
      const rows = g.items
        .filter((e) => matches(e, g.group))
        .map((e) => ({ key: `grp:${g.group}:${entryId(e)}`, entry: e }));
      if (rows.length) out.push({ id: `grp:${g.group}`, title: g.group, rows });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lower, prefs, byId]);

  const flatRows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  useEffect(() => {
    setFocusIdx((i) => Math.min(Math.max(0, i), Math.max(0, flatRows.length - 1)));
  }, [flatRows.length]);
  // Keep the keyboard-focused row scrolled into view.
  useEffect(() => {
    const r = flatRows[focusIdx];
    if (!r || typeof document === 'undefined') return;
    document.querySelector(`[data-rowkey="${CSS.escape(r.key)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focusIdx, flatRows]);

  const onSearchKeyDown = (ev: ReactKeyboardEvent): void => {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      setFocusIdx((i) => Math.min(i + 1, flatRows.length - 1));
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      setFocusIdx((i) => Math.max(i - 1, 0));
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const r = flatRows[focusIdx];
      if (r) toggle(r.entry);
    }
  };

  const focusedKey = flatRows[focusIdx]?.key;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground">
          <LineChart className="h-3.5 w-3.5" /> Indicators
          {activeCount > 0 ? (
            <Badge tone="accent" className="ml-0.5 px-1.5 text-[9px]">
              {activeCount}
            </Badge>
          ) : null}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LineChart className="h-4 w-4 text-accent" /> Indicators
            <span className="text-xs font-normal text-muted-foreground">· {pane.symbol.split(':')[1] ?? pane.symbol} · {pane.interval}</span>
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Toggle any indicator on the active chart. <span className="text-foreground">↑ ↓</span> to navigate ·{' '}
            <span className="text-foreground">Enter</span> to add · <span className="text-foreground">★</span> to favorite.
            Order-flow tools need live trade data — Binance crypto only.
          </p>
        </DialogHeader>

        <div className="px-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              name="sc-indicator-search"
              autoComplete="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              readOnly={!searchReady}
              placeholder="Search indicators…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setFocusIdx(0);
              }}
              onKeyDown={onSearchKeyDown}
              className="h-9 pl-8"
            />
          </div>
        </div>

        <div className="max-h-[56vh] space-y-4 overflow-y-auto scroll-thin px-4 pb-2 pt-3">
          {sections.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No indicators match “{q}”.</div>
          ) : (
            sections.map((s) => (
              <div key={s.id}>
                <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {s.title}
                </div>
                <div className="space-y-1">
                  {s.rows.map(({ key, entry: e }) => {
                    const active = isActive(e);
                    const needsData = 'orderflow' in e && e.orderflow && !isCrypto;
                    const fav = isFavorite(prefs, entryId(e));
                    const focused = key === focusedKey;
                    return (
                      <div
                        key={key}
                        data-rowkey={key}
                        role="button"
                        tabIndex={0}
                        draggable
                        onDragStart={(ev) => {
                          // Drag-to-add (M6): the chart pane resolves this id via ENTRY_INDEX on drop.
                          ev.dataTransfer.setData(INDICATOR_DND_MIME, entryId(e));
                          ev.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => toggle(e)}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter' || ev.key === ' ') {
                            ev.preventDefault();
                            toggle(e);
                          }
                        }}
                        className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border px-3 py-2 text-left transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                          focused ? 'ring-1 ring-accent' : ''
                        } ${active ? 'border-accent/50 bg-accent/10' : 'border-border/60 bg-card/40 hover:border-border'}`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-xs font-medium text-foreground">{e.label}</span>
                            {'orderflow' in e && e.orderflow ? (
                              <Badge tone={needsData ? 'warn' : 'muted'} className="shrink-0 px-1 text-[8px]">
                                {needsData ? 'needs data' : 'order-flow'}
                              </Badge>
                            ) : null}
                          </div>
                          <div className="truncate text-[10px] text-muted-foreground">
                            {needsData ? 'No live order-flow on this feed (Binance crypto only).' : e.desc}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            title={fav ? 'Remove from favorites' : 'Add to favorites'}
                            aria-label={fav ? 'Remove from favorites' : 'Add to favorites'}
                            onClick={(ev) => star(e, ev)}
                            className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <Star className={`h-3.5 w-3.5 ${fav ? 'fill-current text-warn' : ''}`} />
                          </button>
                          {/* Display-only — the row owns the toggle (avoids double-fire + button-in-button). */}
                          <Switch checked={active} className="pointer-events-none" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
