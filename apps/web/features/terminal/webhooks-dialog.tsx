'use client';

import { useCallback, useEffect, useState } from 'react';
import { Webhook, Copy, Check, RefreshCw, Trash2, Send } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { toast } from '@/components/use-toast';
import { formatRelativeTime } from '@/lib/format';

interface WebhookEvent {
  id: string;
  receivedAt: number;
  symbol: string | null;
  action: string | null;
  price: number | null;
  note: string | null;
}
interface WebhookData {
  token: string;
  path: string;
  forwardTelegram: boolean;
  events: WebhookEvent[];
}

const EXAMPLE = `{
  "symbol": "BINANCE:BTCUSDT",
  "action": "buy",
  "price": 67000,
  "note": "EMA 9/21 cross"
}`;

/**
 * Inbound webhook manager (Phase 3 #15). Shows the user's secret receiver URL, lets them
 * regenerate it, toggle opt-in Telegram forwarding, and watch incoming signals live.
 */
export function WebhooksDialog() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<WebhookData | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const fullUrl = data ? `${typeof window !== 'undefined' ? window.location.origin : ''}${data.path}` : '';

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setData(await api<WebhookData>('/webhooks/inbound'));
    } catch {
      setData(null);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // Poll while open so freshly-received signals appear without reopening.
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [open, refresh]);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  const regenerate = async (): Promise<void> => {
    setBusy(true);
    try {
      await api('/webhooks/inbound/regenerate', { method: 'POST' });
      await refresh();
      toast({ title: 'New webhook URL', description: 'The previous URL will no longer be accepted.', tone: 'success' });
    } finally {
      setBusy(false);
    }
  };

  const toggleForward = async (v: boolean): Promise<void> => {
    setData((d) => (d ? { ...d, forwardTelegram: v } : d));
    try {
      await api('/webhooks/inbound', { method: 'PUT', body: JSON.stringify({ forwardTelegram: v }) });
    } catch {
      void refresh();
    }
  };

  const clearEvents = async (): Promise<void> => {
    try {
      await api('/webhooks/inbound/events', { method: 'DELETE' });
      await refresh();
    } catch {
      /* ignore */
    }
  };

  const actionTone = (a: string | null): 'bull' | 'bear' | 'muted' => {
    if (a === 'buy' || a === 'long') return 'bull';
    if (a === 'sell' || a === 'short') return 'bear';
    return 'muted';
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative px-2 text-muted-foreground hover:text-foreground"
          title="Inbound webhooks — receive alerts via HTTP"
          aria-label="Inbound webhooks"
        >
          <Webhook className="h-4 w-4" />
          {data?.forwardTelegram ? <span className="absolute right-1 top-1 inline-block h-1.5 w-1.5 rounded-full bg-bull" /> : null}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Webhook className="h-4 w-4 text-accent" /> Inbound webhooks
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            POST a signal to your private URL from any system (e.g. a TradingView alert). Send JSON or
            plain text. Keep this URL secret — anyone with it can post signals to your account.
          </p>

          <div className="flex items-center gap-2 rounded-md border border-border bg-surface-raised p-2">
            <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">{fullUrl || '…'}</code>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" onClick={() => void copy()}>
              {copied ? <Check className="h-3.5 w-3.5 text-bull" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" className="h-7 gap-1.5" loading={busy} onClick={() => void regenerate()}>
              <RefreshCw className="h-3.5 w-3.5" /> Regenerate
            </Button>
            <label className="flex items-center gap-2 text-xs">
              <Send className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Forward to Telegram</span>
              <Switch checked={data?.forwardTelegram ?? false} onCheckedChange={(v) => void toggleForward(v)} />
            </label>
          </div>

          <details className="rounded-md border border-border/60 bg-surface-raised/50 p-2">
            <summary className="cursor-pointer text-[11px] text-muted-foreground">Example payload</summary>
            <pre className="mt-1.5 overflow-x-auto font-mono text-[10px] leading-relaxed text-foreground">{EXAMPLE}</pre>
            <p className="mt-1 text-[10px] text-muted-foreground">
              All fields optional; aliases like <span className="text-foreground">ticker</span> /{' '}
              <span className="text-foreground">side</span> / <span className="text-foreground">message</span> are accepted.
            </p>
          </details>

          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Recent signals {data?.events.length ? `(${data.events.length})` : ''}
            </span>
            {data?.events.length ? (
              <button className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-bear" onClick={() => void clearEvents()}>
                <Trash2 className="h-3 w-3" /> Clear
              </button>
            ) : null}
          </div>

          <div className="max-h-56 overflow-y-auto scroll-thin">
            {!data || data.events.length === 0 ? (
              <div className="rounded-md border border-dashed border-border/70 px-3 py-6 text-center text-[11px] text-muted-foreground">
                No signals received yet. POST to the URL above and they'll stream in here.
              </div>
            ) : (
              <div className="divide-y divide-border/60">
                {data.events.map((e) => (
                  <div key={e.id} className="flex items-start gap-2 py-2">
                    <Badge tone={actionTone(e.action)} className="mt-0.5 shrink-0 text-[9px] uppercase">
                      {e.action ?? 'signal'}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs">
                        {e.symbol ? <span className="font-medium text-foreground">{e.symbol}</span> : null}
                        {e.price != null ? <span className="text-muted-foreground">@ {e.price}</span> : null}
                      </div>
                      {e.note ? <div className="truncate text-[11px] text-muted-foreground">{e.note}</div> : null}
                    </div>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{formatRelativeTime(e.receivedAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
