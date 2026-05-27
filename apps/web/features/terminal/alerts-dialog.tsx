'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BellRing,
  Plus,
  Power,
  Send,
  Trash2,
  Loader2,
  Check,
  X as XIcon,
  History,
  SatelliteDish,
  Wand2,
  Layers as LayersIcon,
  ListPlus,
  ChevronLeft,
  ChevronRight,
  Star,
  Pencil,
  Zap,
} from 'lucide-react';
import { bulkSubscribeSignals } from '@/lib/signals';
import { useMT5Store } from './mt5-store';
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
import {
  bulkSubscribeAlerts,
  clearAlertEvents,
  createAlert,
  createWatchlist,
  deleteAlert,
  deleteAlertEvent,
  deleteTelegramConfig,
  deleteWatchlist,
  discoverTelegramChats,
  fetchAlertEvents,
  fetchAlerts,
  fetchTelegramConfig,
  fetchWatchlists,
  MA_SOURCE_OPTIONS,
  MA_TYPE_OPTIONS,
  saveTelegramConfig,
  sendTelegramTest,
  TIMEZONE_OPTIONS,
  toggleAlert,
  updateAlert,
  updateWatchlist,
  type DiscoveredChat,
  type Watchlist,
} from '@/lib/alerts';
import { toast } from '@/components/use-toast';
import type {
  AlertDefinition,
  AlertEvent,
  Interval,
  MaCrossAlertConfig,
  TelegramConfig,
} from '@supercharts/types';
import { INTERVALS, SYMBOL_CATALOG, CATEGORY_LABEL, CATEGORY_ORDER, getCatalogSymbol } from '@supercharts/types';
import { formatPrice, formatRelativeTime, formatSymbolLabel } from '@/lib/format';

const DEFAULT_CONFIG: MaCrossAlertConfig = {
  ma: { type: 'ema', length: 20, source: 'close' },
  labels: { buy: 'BUY', sell: 'SELL' },
  delivery: { web: true, telegram: false },
  timezone: 'UTC',
};

type DraftAlert = {
  symbol: string;
  interval: Interval;
  enabled: boolean;
  config: MaCrossAlertConfig;
};

export function AlertsDialog({ activeSymbol }: { activeSymbol?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground hover:text-foreground">
          <BellRing className="h-3.5 w-3.5" /> Alerts
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-accent" /> Alerts &amp; Telegram
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            MA crossover alerts on any FX / crypto / commodity / index pair. Fires on closed bars only.
          </p>
        </DialogHeader>
        <Tabs defaultValue="active" className="px-4 pb-2">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="create">New</TabsTrigger>
            <TabsTrigger value="lists">
              <span className="inline-flex items-center gap-1.5">
                <Star className="h-3 w-3" /> Lists
              </span>
            </TabsTrigger>
            <TabsTrigger value="history">
              <span className="inline-flex items-center gap-1.5">
                <History className="h-3 w-3" /> Logs
              </span>
            </TabsTrigger>
            <TabsTrigger value="telegram">
              <span className="inline-flex items-center gap-1.5">
                <SatelliteDish className="h-3 w-3" /> Telegram
              </span>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="active" className="max-h-[60vh] overflow-y-auto scroll-thin">
            <ActiveAlertsList />
          </TabsContent>
          <TabsContent value="create" className="max-h-[60vh] overflow-y-auto scroll-thin">
            <CreateAlertForm
              initialSymbol={activeSymbol ?? 'BINANCE:BTCUSDT'}
              onCreated={() => setOpen(false)}
            />
          </TabsContent>
          <TabsContent value="lists" className="max-h-[60vh] overflow-y-auto scroll-thin">
            <WatchlistsManager />
          </TabsContent>
          <TabsContent value="history" className="max-h-[60vh] overflow-y-auto scroll-thin">
            <EventHistory />
          </TabsContent>
          <TabsContent value="telegram" className="max-h-[60vh] overflow-y-auto scroll-thin">
            <TelegramSetup />
          </TabsContent>
        </Tabs>
        <DialogFooter className="border-t border-border/60 px-5 py-3 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Closes on the candle — no signal will fire mid-bar.
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ────────────────────────────────────────────────────────── Active list */

function ActiveAlertsList() {
  const [alerts, setAlerts] = useState<AlertDefinition[] | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const reload = useCallback(async () => {
    try {
      setAlerts(await fetchAlerts());
    } catch (err) {
      toast({ title: 'Could not load alerts', description: String(err), tone: 'error' });
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const handleBulkSubscribe = async () => {
    if (
      !window.confirm(
        'Create a 1d EMA(5) × EMA(10) MA-cross alert for ALL catalog symbols (48)?\n\n' +
          'Existing alerts on the same (symbol, 1d) will be skipped. ' +
          'Telegram + web delivery will both be enabled.',
      )
    )
      return;
    setBulkBusy(true);
    try {
      const r = await bulkSubscribeAlerts({
        interval: '1d',
        config: {
          ma: { type: 'ema', length: 5, source: 'close' },
          crossWith: { type: 'ema', length: 10 },
          labels: { buy: 'BUY', sell: 'SELL' },
          delivery: { web: true, telegram: true },
          timezone: 'UTC',
        },
      });
      toast({
        title: `Subscribed ${r.created} symbols`,
        description:
          r.skipped > 0
            ? `${r.skipped} already had a 1d alert (skipped).`
            : 'All catalog symbols armed at 1d EMA(5) × EMA(10) close.',
        tone: 'success',
      });
      await reload();
    } catch (err) {
      toast({ title: 'Bulk subscribe failed', description: String(err), tone: 'error' });
    } finally {
      setBulkBusy(false);
    }
  };

  const BulkBar = (
    <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2 text-xs">
      <div className="text-muted-foreground">
        {alerts ? `${alerts.length} active` : 'Loading…'}
      </div>
      <Button
        size="sm"
        variant="subtle"
        onClick={handleBulkSubscribe}
        disabled={bulkBusy}
        className="gap-1"
      >
        {bulkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LayersIcon className="h-3.5 w-3.5" />}
        Subscribe all · 1d EMA(5) × EMA(10)
      </Button>
    </div>
  );

  if (!alerts) {
    return (
      <>
        {BulkBar}
        <div className="flex h-32 items-center justify-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      </>
    );
  }
  if (alerts.length === 0) {
    return (
      <>
        {BulkBar}
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <div className="rounded-full bg-accent/10 p-3"><BellRing className="h-5 w-5 text-accent" /></div>
          <div className="text-sm font-medium">No alerts yet</div>
          <div className="text-xs text-muted-foreground">
            Create one from the "New" tab, or click "Subscribe all" above.
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      {BulkBar}
      <div className="divide-y divide-border/60">
        {alerts.map((a) => (
          <AlertRow key={a.id} alert={a} onChange={reload} />
        ))}
      </div>
    </>
  );
}

function AlertRow({ alert, onChange }: { alert: AlertDefinition; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const handleToggle = async () => {
    setBusy(true);
    try {
      await toggleAlert(alert.id);
      toast({ title: alert.enabled ? 'Alert paused' : 'Alert started', tone: 'success' });
      onChange();
    } catch (err) {
      toast({ title: 'Failed', description: String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const handleDelete = async () => {
    if (!window.confirm(`Delete alert "${alert.config.labels.buy}/${alert.config.labels.sell}" on ${formatSymbolLabel(alert.symbol)}?`)) return;
    setBusy(true);
    try {
      await deleteAlert(alert.id);
      toast({ title: 'Alert deleted', tone: 'success' });
      onChange();
    } catch (err) {
      toast({ title: 'Failed', description: String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">{formatSymbolLabel(alert.symbol)}</span>
          <Badge tone={alert.enabled ? 'bull' : 'muted'}>{alert.enabled ? 'LIVE' : 'PAUSED'}</Badge>
          <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {alert.interval} ·{' '}
            {alert.config.crossWith
              ? `${alert.config.ma.type.toUpperCase()}(${alert.config.ma.length}) × ${alert.config.crossWith.type.toUpperCase()}(${alert.config.crossWith.length})`
              : `${alert.config.ma.type.toUpperCase()}(${alert.config.ma.length}) ${alert.config.ma.source}`}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
          <span>🟢 {alert.config.labels.buy}</span>
          <span>·</span>
          <span>🔴 {alert.config.labels.sell}</span>
          <span>·</span>
          <span>{alert.config.timezone}</span>
          {alert.config.delivery.telegram ? <Badge tone="accent">telegram</Badge> : null}
          {alert.config.delivery.web ? <Badge tone="muted">web</Badge> : null}
          {alert.lastFiredAt ? (
            <span className="ml-2">last fire {formatRelativeTime(alert.lastFiredAt)}</span>
          ) : (
            <span className="ml-2">no fires yet</span>
          )}
        </div>
      </div>
      <Button size="sm" variant="ghost" disabled={busy} onClick={handleToggle} title={alert.enabled ? 'Pause' : 'Start'}>
        <Power className={`h-3.5 w-3.5 ${alert.enabled ? 'text-bull' : 'text-muted-foreground'}`} />
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={handleDelete} title="Delete">
        <Trash2 className="h-3.5 w-3.5 text-bear" />
      </Button>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── Create form */

function CreateAlertForm({ initialSymbol, onCreated }: { initialSymbol: string; onCreated: () => void }) {
  const [draft, setDraft] = useState<DraftAlert>({
    symbol: initialSymbol,
    interval: '1h',
    enabled: true,
    config: DEFAULT_CONFIG,
  });
  const [submitting, setSubmitting] = useState(false);

  const update = useCallback((patch: Partial<DraftAlert>) => {
    setDraft((d) => ({ ...d, ...patch }));
  }, []);
  const updateConfig = useCallback((patch: Partial<MaCrossAlertConfig>) => {
    setDraft((d) => ({ ...d, config: { ...d.config, ...patch } }));
  }, []);
  const updateMa = (patch: Partial<MaCrossAlertConfig['ma']>) => {
    setDraft((d) => ({ ...d, config: { ...d.config, ma: { ...d.config.ma, ...patch } } }));
  };
  const updateLabels = (patch: Partial<MaCrossAlertConfig['labels']>) => {
    setDraft((d) => ({ ...d, config: { ...d.config, labels: { ...d.config.labels, ...patch } } }));
  };
  const updateDelivery = (patch: Partial<MaCrossAlertConfig['delivery']>) => {
    setDraft((d) => ({ ...d, config: { ...d.config, delivery: { ...d.config.delivery, ...patch } } }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await createAlert({
        symbol: draft.symbol,
        interval: draft.interval,
        type: 'ma_cross',
        enabled: draft.enabled,
        config: draft.config,
      });
      toast({
        title: 'Alert created',
        description: `${formatSymbolLabel(draft.symbol)} · ${draft.config.ma.type.toUpperCase()}(${draft.config.ma.length}) · ${draft.interval}`,
        tone: 'success',
      });
      onCreated();
    } catch (err) {
      toast({ title: 'Could not save alert', description: String(err), tone: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 px-4 py-4 text-xs">
      <Field label="Symbol">
        <SymbolPicker value={draft.symbol} onChange={(v) => update({ symbol: v })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Timeframe">
          <Select value={draft.interval} onValueChange={(v) => update({ interval: v as Interval })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {INTERVALS.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Timezone">
          <Select value={draft.config.timezone} onValueChange={(v) => updateConfig({ timezone: v })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TIMEZONE_OPTIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="MA type">
          <Select value={draft.config.ma.type} onValueChange={(v) => updateMa({ type: v as MaCrossAlertConfig['ma']['type'] })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MA_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Length">
          <Input
            type="number"
            min={2}
            max={500}
            value={draft.config.ma.length}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= 2 && v <= 500) updateMa({ length: v });
            }}
          />
        </Field>
        <Field label="Source">
          <Select value={draft.config.ma.source} onValueChange={(v) => updateMa({ source: v as MaCrossAlertConfig['ma']['source'] })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MA_SOURCE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Buy label">
          <Input value={draft.config.labels.buy} onChange={(e) => updateLabels({ buy: e.target.value })} />
        </Field>
        <Field label="Sell label">
          <Input value={draft.config.labels.sell} onChange={(e) => updateLabels({ sell: e.target.value })} />
        </Field>
      </div>
      <div className="flex items-center justify-between rounded-md border border-border/70 bg-surface-raised px-3 py-2">
        <div className="text-xs">
          <div className="font-semibold">Web alert</div>
          <div className="text-muted-foreground">Toast on screen + label on the chart.</div>
        </div>
        <Switch checked={draft.config.delivery.web} onCheckedChange={(v) => updateDelivery({ web: v })} />
      </div>
      <div className="flex items-center justify-between rounded-md border border-border/70 bg-surface-raised px-3 py-2">
        <div className="text-xs">
          <div className="font-semibold">Telegram</div>
          <div className="text-muted-foreground">Sends a formatted message to your configured chat.</div>
        </div>
        <Switch checked={draft.config.delivery.telegram} onCheckedChange={(v) => updateDelivery({ telegram: v })} />
      </div>
      <div className="flex items-center justify-between border-t border-border/60 pt-3">
        <div className="text-[10px] text-muted-foreground">
          Saving will start the alert immediately. Disable it from the Active tab any time.
        </div>
        <Button size="sm" onClick={handleSubmit} disabled={submitting} className="gap-1">
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Save alert
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function SymbolPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // Group the catalog into the user-facing buckets. Memoize so the dropdown
  // doesn't rebuild this on every keystroke.
  const grouped = useMemo(() => {
    const map = new Map<string, typeof SYMBOL_CATALOG>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const s of SYMBOL_CATALOG) {
      map.get(s.category)!.push(s);
    }
    return map;
  }, []);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full"><SelectValue placeholder="Pick a symbol" /></SelectTrigger>
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
                <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
              ))}
            </div>
          );
        })}
      </SelectContent>
    </Select>
  );
}

/* ────────────────────────────────────────────────────────── History */

function EventHistory() {
  const [events, setEvents] = useState<AlertEvent[] | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const items = await fetchAlertEvents(200);
      setEvents(items);
    } catch {
      setEvents([]);
    }
  }, []);

  useEffect(() => {
    void reload();
    // Auto-refresh every 8s so new fires show up while the dialog is open.
    const id = setInterval(() => void reload(), 8_000);
    return () => clearInterval(id);
  }, [reload]);

  const handleDelete = async (id: string) => {
    setBusy(true);
    try {
      await deleteAlertEvent(id);
      setEvents((prev) => (prev ? prev.filter((e) => e.id !== id) : prev));
    } catch (err) {
      toast({ title: 'Could not delete', description: String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm('Delete ALL alert log entries?\n\nThe alerts themselves stay armed — only the fire history is wiped.')) return;
    setBusy(true);
    try {
      await clearAlertEvents();
      setEvents([]);
      toast({ title: 'Logs cleared', tone: 'success' });
    } catch (err) {
      toast({ title: 'Could not clear', description: String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const Header = (
    <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2 text-xs">
      <div className="text-muted-foreground">
        {events ? `${events.length} log entries` : 'Loading…'}
        <span className="ml-2 text-[10px] uppercase tracking-[0.14em]">auto-refresh 8s</span>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => void reload()} disabled={busy} className="gap-1">
          <Loader2 className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : 'hidden'}`} />
          Refresh
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleClearAll}
          disabled={busy || (events?.length ?? 0) === 0}
          className="gap-1 text-bear"
        >
          <Trash2 className="h-3.5 w-3.5" /> Clear all
        </Button>
      </div>
    </div>
  );

  if (!events) {
    return (
      <>
        {Header}
        <div className="flex h-32 items-center justify-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      </>
    );
  }
  if (events.length === 0) {
    return (
      <>
        {Header}
        <div className="py-10 text-center text-xs text-muted-foreground">No fires yet.</div>
      </>
    );
  }
  return (
    <>
      {Header}
      <div className="divide-y divide-border/60">
        {events.map((e) => {
          const cat = getCatalogSymbol(e.symbol)?.category;
          return (
            <div key={e.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-2 text-xs">
              <div>
                <div className="flex items-center gap-2">
                  <Badge tone={e.side === 'buy' ? 'bull' : 'bear'}>{e.side.toUpperCase()}</Badge>
                  <span className="font-semibold">{formatSymbolLabel(e.symbol)}</span>
                  <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{e.interval}</span>
                  {cat ? <span className="text-[10px] text-muted-foreground">{CATEGORY_LABEL[cat]}</span> : null}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {e.label} · {formatPrice(e.price)} · MA {formatPrice(e.maValue)}
                </div>
              </div>
              <div className="text-right text-[10px] text-muted-foreground">
                <div>{new Date(e.firedAt).toLocaleString()}</div>
                <div>{telegramBadge(e)}</div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void handleDelete(e.id)}
                disabled={busy}
                title="Delete this log entry"
                className="px-2"
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-bear" />
              </Button>
            </div>
          );
        })}
      </div>
    </>
  );
}

function telegramBadge(e: AlertEvent): React.ReactNode {
  if (e.telegram === 'sent') return <span className="text-bull">telegram sent</span>;
  if (e.telegram === 'failed') return <span className="text-bear" title={e.telegramError ?? ''}>telegram failed</span>;
  if (e.telegram === 'disabled') return <span className="text-muted-foreground">telegram off</span>;
  return null;
}

/* ────────────────────────────────────────────────────────── Telegram setup */

function TelegramSetup() {
  const [cfg, setCfg] = useState<TelegramConfig | null>(null);
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredChat[] | null>(null);

  const reload = useCallback(async () => {
    try {
      const c = await fetchTelegramConfig();
      setCfg(c);
      if (c.chatId) setChatId(c.chatId);
      if (c.enabled !== undefined) setEnabled(c.enabled);
    } catch {
      setCfg({ configured: false, enabled: false });
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const handleDiscover = async () => {
    if (!botToken && !cfg?.configured) {
      toast({
        title: 'Paste the bot token first',
        description: 'Then click "Auto-detect chat ID".',
        tone: 'warn',
      });
      return;
    }
    setBusy(true);
    try {
      const chats = await discoverTelegramChats(botToken || undefined);
      if (chats.length === 0) {
        toast({
          title: 'No chats found yet',
          description: 'Open Telegram, send any message (e.g. /start) to your bot, then try again.',
          tone: 'warn',
          durationMs: 6000,
        });
      } else if (chats.length === 1) {
        setChatId(chats[0]!.chatId);
        setDiscovered(chats);
        toast({
          title: 'Chat ID detected',
          description: describeChat(chats[0]!),
          tone: 'success',
        });
      } else {
        setDiscovered(chats);
        toast({
          title: `${chats.length} chats found`,
          description: 'Pick the chat you want alerts sent to.',
          tone: 'success',
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Surface the server-side hint ("Send any message…") if it bubbles up.
      toast({ title: 'Auto-detect failed', description: msg, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (botToken.length < 20 && !cfg?.configured) {
      toast({ title: 'Invalid bot token', description: 'Get one from @BotFather.', tone: 'error' });
      return;
    }
    if (chatId.length < 1) {
      toast({ title: 'Chat ID required', tone: 'error' });
      return;
    }
    setBusy(true);
    try {
      // If the bot token field is empty but credentials already exist, the server
      // route would require a token. Re-saving with the same field would fail —
      // guard the UI from that confusion by only sending botToken when supplied.
      if (!botToken && cfg?.configured) {
        // Use the existing PUT-style flow via POST with token? Backend expects a token,
        // so prompt user to re-enter for now.
        toast({
          title: 'Re-enter the bot token',
          description: 'For security we never echo it back — paste it again to save changes.',
          tone: 'warn',
        });
        setBusy(false);
        return;
      }
      const c = await saveTelegramConfig({ botToken, chatId, enabled });
      setCfg(c);
      setBotToken('');
      toast({ title: 'Telegram configured', description: `Bot ending in ${c.botTokenSuffix}`, tone: 'success' });
    } catch (err) {
      toast({ title: 'Could not save', description: String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    setBusy(true);
    try {
      await sendTelegramTest();
      toast({ title: 'Test sent ✅', description: 'Check your Telegram chat.', tone: 'success' });
    } catch (err) {
      toast({ title: 'Telegram test failed', description: String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Delete the saved Telegram credentials?')) return;
    setBusy(true);
    try {
      await deleteTelegramConfig();
      setCfg({ configured: false, enabled: false });
      setBotToken('');
      setChatId('');
      toast({ title: 'Telegram credentials removed', tone: 'success' });
    } catch (err) {
      toast({ title: 'Failed', description: String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 px-4 py-4 text-xs">
      <div className="rounded-md border border-border/70 bg-surface-raised p-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground">
          How to set up
        </div>
        <ol className="ml-4 list-decimal space-y-1 text-[11px] text-muted-foreground">
          <li>Open Telegram and message <code className="text-foreground">@BotFather</code> → <code className="text-foreground">/newbot</code>.</li>
          <li>Copy the token it gives you (looks like <code>1234567:AAB…</code>).</li>
          <li>Start a chat with your new bot, send any message.</li>
          <li>Open <code className="text-foreground">https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> in your browser — copy the <code>chat.id</code>.</li>
          <li>Paste the token + chat ID below and hit Save.</li>
        </ol>
      </div>
      <div className="space-y-3">
        <Field label="Bot token (@BotFather)">
          <Input
            type="password"
            placeholder={cfg?.configured ? `••••••••${cfg.botTokenSuffix ?? ''}` : '123456:AABBCC…'}
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            autoComplete="off"
          />
        </Field>
        <Field label="Chat ID">
          <div className="flex gap-2">
            <Input
              placeholder="Auto-detect or paste · 123456789 / -1001234567890"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              autoComplete="off"
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleDiscover}
              disabled={busy}
              className="shrink-0 gap-1 whitespace-nowrap"
              title="Poll Telegram getUpdates for the chat that messaged this bot."
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              Auto-detect
            </Button>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Send any message (e.g. <code>/start</code>) to your bot in Telegram, then click Auto-detect.
          </p>
        </Field>
        {discovered && discovered.length > 1 ? (
          <div className="rounded-md border border-border/70 bg-surface-raised p-2">
            <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {discovered.length} chats found · pick one
            </div>
            <div className="space-y-1">
              {discovered.map((c) => (
                <button
                  key={c.chatId}
                  onClick={() => setChatId(c.chatId)}
                  className={`flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-xs hover:border-accent/60 ${
                    chatId === c.chatId ? 'border-accent bg-accent/10' : 'border-border/60'
                  }`}
                >
                  <span>{describeChat(c)}</span>
                  <code className="text-[10px] text-muted-foreground">{c.chatId}</code>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="flex items-center justify-between rounded-md border border-border/70 bg-surface-raised px-3 py-2">
          <div className="text-xs">
            <div className="font-semibold">Telegram alerts enabled</div>
            <div className="text-muted-foreground">Master switch — pauses ALL telegram delivery without deleting credentials.</div>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
          {cfg?.configured ? (
            <>
              <Button size="sm" variant="ghost" onClick={handleTest} disabled={busy} className="gap-1">
                <Send className="h-3.5 w-3.5" /> Send test
              </Button>
              <Button size="sm" variant="ghost" onClick={handleDelete} disabled={busy} className="gap-1 text-bear">
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </Button>
            </>
          ) : null}
          <Button size="sm" onClick={handleSave} disabled={busy} className="gap-1">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Save
          </Button>
        </div>
        {cfg?.configured ? (
          <div className="text-[10px] text-muted-foreground">
            Saved · bot <code>•••{cfg.botTokenSuffix}</code> · chat <code>{cfg.chatId}</code>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── Watchlists */

type WatchlistsView = { mode: 'list' } | { mode: 'edit'; listId: string };

function WatchlistsManager() {
  const [lists, setLists] = useState<Watchlist[] | null>(null);
  const [view, setView] = useState<WatchlistsView>({ mode: 'list' });
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');

  const reload = useCallback(async () => {
    try {
      const items = await fetchWatchlists();
      setLists(items);
    } catch (err) {
      toast({ title: 'Could not load watchlists', description: String(err), tone: 'error' });
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (name.length < 1) {
      toast({ title: 'Name required', tone: 'warn' });
      return;
    }
    setBusy(true);
    try {
      const { id } = await createWatchlist(name);
      setNewName('');
      await reload();
      setView({ mode: 'edit', listId: id });
      toast({ title: 'List created', description: name, tone: 'success' });
    } catch (err) {
      toast({ title: 'Could not create list', description: String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (l: Watchlist) => {
    if (!window.confirm(`Delete watchlist "${l.name}"?\n\nAlerts already created from this list are NOT removed.`)) return;
    setBusy(true);
    try {
      await deleteWatchlist(l.id);
      await reload();
      toast({ title: 'List deleted', tone: 'success' });
    } catch (err) {
      toast({ title: 'Could not delete', description: String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  if (!lists) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (view.mode === 'edit') {
    const list = lists.find((l) => l.id === view.listId);
    if (!list) {
      return (
        <div className="px-4 py-6 text-xs text-muted-foreground">
          List not found.{' '}
          <button className="underline" onClick={() => setView({ mode: 'list' })}>
            Back
          </button>
        </div>
      );
    }
    return (
      <WatchlistEditor
        list={list}
        onSaved={async () => {
          await reload();
        }}
        onBack={() => setView({ mode: 'list' })}
      />
    );
  }

  return (
    <div className="px-4 py-3 text-xs">
      <div className="mb-3 flex items-center gap-2">
        <Input
          // Defeat Chrome's autofill, which loves to slam email addresses into any
          // free-form text input — especially inside a dialog.
          autoComplete="off"
          name={`wl-name-${Math.random().toString(36).slice(2, 7)}`}
          spellCheck={false}
          placeholder="New list name (e.g. Hedge fund FX, Crypto majors, Asia indices)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleCreate();
          }}
        />
        <Button size="sm" onClick={handleCreate} disabled={busy} className="shrink-0 gap-1 whitespace-nowrap">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Create
        </Button>
      </div>
      {lists.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <div className="rounded-full bg-accent/10 p-3">
            <Star className="h-5 w-5 text-accent" />
          </div>
          <div className="text-sm font-medium">No watchlists yet</div>
          <div className="text-muted-foreground">
            Create one above, add symbols, then bulk-subscribe MA cross alerts from inside the list.
          </div>
        </div>
      ) : (
        <div className="divide-y divide-border/60 rounded-md border border-border/70">
          {lists.map((l) => (
            <div key={l.id} className="flex items-center gap-2 px-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{l.name}</div>
                <div className="text-[10px] text-muted-foreground">
                  {l.symbols.length} symbols
                  {l.symbols.length > 0
                    ? ` · ${l.symbols.slice(0, 3).map((s) => formatSymbolLabel(s)).join(', ')}${l.symbols.length > 3 ? '…' : ''}`
                    : ' · empty'}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1"
                onClick={() => setView({ mode: 'edit', listId: l.id })}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleDelete(l)}
                title="Delete list"
              >
                <Trash2 className="h-3.5 w-3.5 text-bear" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WatchlistEditor({
  list,
  onSaved,
  onBack,
}: {
  list: Watchlist;
  onSaved: () => Promise<void>;
  onBack: () => void;
}) {
  const [name, setName] = useState(list.name);
  const [members, setMembers] = useState<Set<string>>(() => new Set(list.symbols));
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');

  const grouped = useMemo(() => {
    const map = new Map<string, typeof SYMBOL_CATALOG>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    const q = filter.trim().toLowerCase();
    for (const s of SYMBOL_CATALOG) {
      if (q && !s.label.toLowerCase().includes(q) && !s.id.toLowerCase().includes(q)) continue;
      map.get(s.category)!.push(s);
    }
    return map;
  }, [filter]);

  const toggle = (id: string) => {
    setMembers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectCategory = (cat: keyof typeof CATEGORY_LABEL) => {
    setMembers((prev) => {
      const next = new Set(prev);
      const items = grouped.get(cat) ?? [];
      const allIn = items.every((s) => next.has(s.id));
      for (const s of items) {
        if (allIn) next.delete(s.id);
        else next.add(s.id);
      }
      return next;
    });
  };

  const save = async (after?: 'close' | 'subscribe'): Promise<void> => {
    setBusy(true);
    try {
      await updateWatchlist(list.id, {
        name: name.trim() || list.name,
        symbols: [...members],
      });
      await onSaved();
      toast({ title: 'List saved', description: `${members.size} symbols`, tone: 'success' });
      if (after === 'close') onBack();
      if (after === 'subscribe') {
        await bulkSubscribeFromList([...members]);
      }
    } catch (err) {
      toast({ title: 'Save failed', description: String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const bulkSubscribeFromList = async (symbols: string[]): Promise<void> => {
    if (symbols.length === 0) {
      toast({ title: 'List is empty', tone: 'warn' });
      return;
    }
    if (
      !window.confirm(
        `Create a 1d EMA(5) × EMA(10) MA-cross alert for ${symbols.length} symbol${symbols.length === 1 ? '' : 's'} from "${name}"?\n\n` +
          'Existing alerts on the same (symbol, 1d) will be skipped.\n' +
          'Telegram + web delivery will both be enabled.',
      )
    )
      return;
    try {
      const r = await bulkSubscribeAlerts({
        interval: '1d',
        symbols,
        config: {
          ma: { type: 'ema', length: 5, source: 'close' },
          crossWith: { type: 'ema', length: 10 },
          labels: { buy: 'BUY', sell: 'SELL' },
          delivery: { web: true, telegram: true },
          timezone: 'UTC',
        },
      });
      toast({
        title: `Subscribed ${r.created} symbols`,
        description: r.skipped > 0 ? `${r.skipped} already had a 1d alert (skipped).` : 'Alerts armed.',
        tone: 'success',
      });
    } catch (err) {
      toast({ title: 'Bulk subscribe failed', description: String(err), tone: 'error' });
    }
  };

  return (
    <div className="px-4 py-3 text-xs">
      <div className="mb-2 flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onBack} className="gap-1 px-2">
          <ChevronLeft className="h-3.5 w-3.5" /> Lists
        </Button>
        <Input
          autoComplete="off"
          name={`wl-rename-${Math.random().toString(36).slice(2, 7)}`}
          spellCheck={false}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="List name"
        />
        <div className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {members.size} selected
        </div>
      </div>
      <div className="mb-2">
        <Input
          autoComplete="off"
          name={`wl-filter-${Math.random().toString(36).slice(2, 7)}`}
          spellCheck={false}
          placeholder="Filter symbols (e.g. EUR, gold, NAS100)"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="rounded-md border border-border/70 bg-surface-raised/40">
        {CATEGORY_ORDER.map((cat) => {
          const items = grouped.get(cat) ?? [];
          if (items.length === 0) return null;
          const allIn = items.every((s) => members.has(s.id));
          const someIn = items.some((s) => members.has(s.id));
          return (
            <div key={cat} className="border-b border-border/40 last:border-b-0">
              <div className="flex items-center justify-between bg-surface/40 px-2 py-1.5">
                <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {CATEGORY_LABEL[cat]}
                </span>
                <button
                  onClick={() => selectCategory(cat)}
                  className="rounded-md border border-border/60 px-2 py-0.5 text-[10px] hover:border-accent/60"
                >
                  {allIn ? 'Clear all' : someIn ? 'Select all' : 'Select all'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1 p-2 md:grid-cols-3">
                {items.map((s) => {
                  const selected = members.has(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => toggle(s.id)}
                      className={`flex items-center justify-between rounded-md border px-2 py-1 text-left text-[11px] transition-colors ${
                        selected
                          ? 'border-accent/70 bg-accent/15 text-foreground'
                          : 'border-border/60 hover:border-accent/40'
                      }`}
                    >
                      <span className="truncate">{s.label}</span>
                      {selected ? <Check className="ml-1 h-3 w-3 shrink-0 text-accent" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-3">
        <Button size="sm" variant="ghost" onClick={() => save('close')} disabled={busy} className="gap-1">
          <Check className="h-3.5 w-3.5" /> Save &amp; close
        </Button>
        <Button size="sm" variant="subtle" onClick={() => save('subscribe')} disabled={busy} className="gap-1">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListPlus className="h-3.5 w-3.5" />}
          Alerts: 1d EMA(5)×(10)
        </Button>
        <MT5BulkAutomateButton
          listName={name}
          symbols={[...members]}
          onSaved={async () => {
            await onSaved();
          }}
        />
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Alerts only notify. MT5 automation actually places trades — review the settings each time.
      </p>
    </div>
  );
}

/* ────────────────────────────────────────────────────────── MT5 bulk automation */

interface AutomatePayload {
  accountId: string;
  interval: Interval;
  ma: { type: 'sma' | 'ema' | 'rma' | 'wma'; length: number; source: 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' };
  sides: Array<'buy' | 'sell'>;
  lots: number;
  slPips?: number;
  tpPips?: number;
  cooldownSec: number;
  maxOpen: number;
  maxTradesPerDay?: number;
}

const DEFAULT_AUTOMATE: AutomatePayload = {
  accountId: '',
  interval: '1h',
  ma: { type: 'ema', length: 20, source: 'close' },
  sides: ['buy', 'sell'],
  lots: 0.01,
  slPips: 30,
  tpPips: 60,
  // 1h bar = 3600s. Default cooldown stays slightly under one bar so the engine
  // won't fire twice on the same swing inside the same bar.
  cooldownSec: 3000,
  maxOpen: 1,
  maxTradesPerDay: 6,
};

function MT5BulkAutomateButton({
  listName,
  symbols,
  onSaved,
}: {
  listName: string;
  symbols: string[];
  onSaved: () => Promise<void>;
}) {
  const accounts = useMT5Store((s) => s.accounts);
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<AutomatePayload>(() => ({
    ...DEFAULT_AUTOMATE,
    accountId: accounts[0]?.accountId ?? '',
  }));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!payload.accountId && accounts.length > 0) {
      setPayload((p) => ({ ...p, accountId: accounts[0]!.accountId }));
    }
  }, [accounts, payload.accountId]);

  const handleSubmit = async () => {
    if (!payload.accountId) {
      toast({
        title: 'Connect an MT5 account first',
        description: 'Use "Connect MT5" in the top bar to pair an account.',
        tone: 'error',
      });
      return;
    }
    if (symbols.length === 0) {
      toast({ title: 'List is empty — add symbols first', tone: 'warn' });
      return;
    }
    if (payload.sides.length === 0) {
      toast({ title: 'Pick at least one side (Buy / Sell)', tone: 'warn' });
      return;
    }
    if (
      !window.confirm(
        `Create LIVE MT5 automation recipes for ${symbols.length} symbol${symbols.length === 1 ? '' : 's'} × ${payload.sides.length} side${
          payload.sides.length === 1 ? '' : 's'
        } = ${symbols.length * payload.sides.length} recipes?\n\n` +
          `Account: ${payload.accountId}\n` +
          `Trigger: ${payload.ma.type.toUpperCase()}(${payload.ma.length}) ${payload.ma.source} cross on ${payload.interval} bar close\n` +
          `Size: ${payload.lots} lots · SL: ${payload.slPips ?? '—'} pips · TP: ${payload.tpPips ?? '—'} pips\n` +
          `Per-recipe cap: ${payload.maxOpen} open · ${payload.cooldownSec}s cooldown · ${payload.maxTradesPerDay ?? '∞'} trades/day\n\n` +
          'These recipes will place real orders via the connected EA. Continue?',
      )
    )
      return;
    setBusy(true);
    try {
      const r = await bulkSubscribeSignals({
        accountId: payload.accountId,
        interval: payload.interval,
        symbols,
        ma: payload.ma,
        sides: payload.sides,
        sizing: { mode: 'fixed_lots', lots: payload.lots },
        sl: payload.slPips ? { pips: payload.slPips } : undefined,
        tp: payload.tpPips ? { pips: payload.tpPips } : undefined,
        maxOpen: payload.maxOpen,
        cooldownSec: payload.cooldownSec,
        maxTradesPerDay: payload.maxTradesPerDay,
      });
      toast({
        title: `Armed ${r.created} MT5 recipes`,
        description: r.skipped > 0 ? `${r.skipped} duplicates skipped.` : 'Trades will fire on the next matching crossover.',
        tone: 'success',
      });
      await onSaved();
      setOpen(false);
    } catch (err) {
      toast({ title: 'MT5 bulk subscribe failed', description: String(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const toggleSide = (side: 'buy' | 'sell') => {
    setPayload((p) => {
      const has = p.sides.includes(side);
      return { ...p, sides: has ? p.sides.filter((s) => s !== side) : [...p.sides, side] };
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1 bg-bear/80 text-white hover:bg-bear">
          <Zap className="h-3.5 w-3.5" /> Automate (MT5)
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-bear" /> MT5 bulk automation · {listName}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Places real trades on every MA crossover. Set hard caps below and review on every save.
          </p>
        </DialogHeader>
        <div className="space-y-3 px-4 pb-4 text-xs">
          <div className="rounded-md border border-bear/40 bg-bear/10 p-2 text-[11px]">
            <strong className="text-bear">Live trading</strong> — these recipes route orders to MT5 via the connected EA.
            Always test on a demo account first. Trade volume = {symbols.length * payload.sides.length} recipes.
          </div>
          <Field label="MT5 account">
            {accounts.length === 0 ? (
              <div className="rounded-md border border-warn/50 bg-warn/10 px-3 py-2 text-warn">
                No MT5 accounts paired. Use "Connect MT5" in the top bar first.
              </div>
            ) : (
              <Select
                value={payload.accountId}
                onValueChange={(v) => setPayload((p) => ({ ...p, accountId: v }))}
              >
                <SelectTrigger className="w-full"><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.accountId} value={a.accountId}>
                      {a.snapshot?.account.broker ?? '?'} · {a.snapshot?.account.login ?? a.accountId.split('@')[0]} ·{' '}
                      {a.snapshot?.account.currency ?? '—'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Timeframe">
              <Select
                value={payload.interval}
                onValueChange={(v) => setPayload((p) => ({ ...p, interval: v as Interval }))}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INTERVALS.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Sides">
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={payload.sides.includes('buy') ? 'subtle' : 'ghost'}
                  onClick={() => toggleSide('buy')}
                  className="flex-1 gap-1"
                >
                  <Check className={`h-3 w-3 ${payload.sides.includes('buy') ? 'opacity-100' : 'opacity-0'}`} /> Buy
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={payload.sides.includes('sell') ? 'subtle' : 'ghost'}
                  onClick={() => toggleSide('sell')}
                  className="flex-1 gap-1"
                >
                  <Check className={`h-3 w-3 ${payload.sides.includes('sell') ? 'opacity-100' : 'opacity-0'}`} /> Sell
                </Button>
              </div>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="MA type">
              <Select
                value={payload.ma.type}
                onValueChange={(v) => setPayload((p) => ({ ...p, ma: { ...p.ma, type: v as AutomatePayload['ma']['type'] } }))}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MA_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Length">
              <Input
                type="number"
                min={2}
                max={500}
                value={payload.ma.length}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= 2 && v <= 500) {
                    setPayload((p) => ({ ...p, ma: { ...p.ma, length: v } }));
                  }
                }}
              />
            </Field>
            <Field label="Source">
              <Select
                value={payload.ma.source}
                onValueChange={(v) => setPayload((p) => ({ ...p, ma: { ...p.ma, source: v as AutomatePayload['ma']['source'] } }))}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MA_SOURCE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Lots">
              <Input
                type="number"
                step={0.01}
                min={0.01}
                value={payload.lots}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v > 0) setPayload((p) => ({ ...p, lots: v }));
                }}
              />
            </Field>
            <Field label="SL pips">
              <Input
                type="number"
                value={payload.slPips ?? ''}
                onChange={(e) => {
                  const v = e.target.value === '' ? undefined : Number(e.target.value);
                  setPayload((p) => ({ ...p, slPips: v }));
                }}
              />
            </Field>
            <Field label="TP pips">
              <Input
                type="number"
                value={payload.tpPips ?? ''}
                onChange={(e) => {
                  const v = e.target.value === '' ? undefined : Number(e.target.value);
                  setPayload((p) => ({ ...p, tpPips: v }));
                }}
              />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Max open / recipe">
              <Input
                type="number"
                min={1}
                value={payload.maxOpen}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= 1) setPayload((p) => ({ ...p, maxOpen: v }));
                }}
              />
            </Field>
            <Field label="Cooldown (s)">
              <Input
                type="number"
                min={0}
                value={payload.cooldownSec}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v >= 0) setPayload((p) => ({ ...p, cooldownSec: v }));
                }}
              />
            </Field>
            <Field label="Max trades / day">
              <Input
                type="number"
                min={1}
                value={payload.maxTradesPerDay ?? ''}
                onChange={(e) => {
                  const v = e.target.value === '' ? undefined : Number(e.target.value);
                  setPayload((p) => ({ ...p, maxTradesPerDay: v }));
                }}
              />
            </Field>
          </div>
        </div>
        <DialogFooter className="flex items-center justify-end gap-2 border-t border-border/60 px-4 py-3">
          <Button variant="ghost" onClick={() => setOpen(false)} size="sm">Cancel</Button>
          <Button
            size="sm"
            className="gap-1 bg-bear/80 text-white hover:bg-bear"
            onClick={handleSubmit}
            disabled={busy || accounts.length === 0}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            Arm {symbols.length * payload.sides.length} recipes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function describeChat(c: DiscoveredChat): string {
  if (c.type === 'private') {
    const name = [c.firstName, c.lastName].filter(Boolean).join(' ');
    if (name && c.username) return `${name} · @${c.username}`;
    if (name) return name;
    if (c.username) return `@${c.username}`;
    return 'Private chat';
  }
  return c.title ? `${c.title} (${c.type})` : c.type;
}

/* eslint-disable @typescript-eslint/no-unused-vars */
const _unusedX: typeof XIcon = XIcon;
const _unused: typeof updateAlert = updateAlert;
/* eslint-enable @typescript-eslint/no-unused-vars */
