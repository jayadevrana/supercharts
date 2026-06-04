'use client';

import { useCallback, useEffect, useState } from 'react';
import { Megaphone, Send, Trash2, Plus, TriangleAlert, Radio, CheckCircle2, XCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { toast } from '@/components/use-toast';
import { formatRelativeTime } from '@/lib/format';

interface Bot {
  id: string;
  label: string;
  enabled: boolean;
}
interface Channel {
  id: string;
  channelId: string;
  title: string;
  botId: string;
  botLabel: string | null;
  verifiedAt: number;
}
interface Broadcast {
  id: string;
  text: string;
  sentAt: number;
  ok: number;
  error: string | null;
}

const MAX_LEN = 4096;

/**
 * Telegram broadcast channels (Phase 4 #17). Link a channel one of your bots admins, then push
 * one-to-many messages to it. Separate from the private alert chat — the alert config is untouched.
 */
export function BroadcastDialog() {
  const [open, setOpen] = useState(false);
  const [bots, setBots] = useState<Bot[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [botId, setBotId] = useState('');
  const [channelInput, setChannelInput] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sendBusy, setSendBusy] = useState(false);
  const [log, setLog] = useState<Broadcast[]>([]);

  const loadCore = useCallback(async (): Promise<void> => {
    try {
      const [b, c] = await Promise.all([
        api<{ items: Bot[] }>('/alerts/telegram/bots'),
        api<{ items: Channel[] }>('/telegram/channels'),
      ]);
      setBots(b.items);
      setChannels(c.items);
      if (!botId && b.items[0]) setBotId(b.items[0].id);
      setActiveId((prev) => prev ?? c.items[0]?.id ?? null);
    } catch {
      setBots([]);
      setChannels([]);
    }
  }, [botId]);

  useEffect(() => {
    if (open) {
      setAddError(null);
      void loadCore();
    }
  }, [open, loadCore]);

  const loadLog = useCallback(async (id: string): Promise<void> => {
    try {
      setLog((await api<{ items: Broadcast[] }>(`/telegram/channels/${id}/broadcasts`)).items);
    } catch {
      setLog([]);
    }
  }, []);

  useEffect(() => {
    if (activeId) void loadLog(activeId);
    else setLog([]);
  }, [activeId, loadLog]);

  const addChannel = async (): Promise<void> => {
    setAddBusy(true);
    setAddError(null);
    try {
      const res = await fetch('/api/telegram/channels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ botId, channel: channelInput.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; title?: string; message?: string };
      if (!res.ok) {
        setAddError(body.message ?? 'Could not add that channel.');
        return;
      }
      setChannelInput('');
      toast({ title: 'Channel linked', description: body.title, tone: 'success' });
      await loadCore();
      if (body.id) setActiveId(body.id);
    } catch {
      setAddError('Could not reach the server.');
    } finally {
      setAddBusy(false);
    }
  };

  const removeChannel = async (id: string): Promise<void> => {
    try {
      await api(`/telegram/channels/${id}`, { method: 'DELETE' });
      if (activeId === id) setActiveId(null);
      await loadCore();
    } catch {
      /* ignore */
    }
  };

  const broadcast = async (): Promise<void> => {
    if (!activeId || !text.trim()) return;
    setSendBusy(true);
    try {
      const res = await fetch(`/api/telegram/channels/${activeId}/broadcast`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text: text.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      if (!res.ok || !body.ok) {
        toast({ title: 'Broadcast failed', description: body.message ?? 'Telegram rejected it.', tone: 'error' });
      } else {
        setText('');
        toast({ title: 'Broadcast sent', tone: 'success' });
      }
      await loadLog(activeId);
    } finally {
      setSendBusy(false);
    }
  };

  const active = channels.find((c) => c.id === activeId) ?? null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground hover:text-foreground" title="Broadcast to a Telegram channel">
          <Megaphone className="h-3.5 w-3.5" /> Broadcast
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Megaphone className="h-4 w-4 text-accent" /> Telegram broadcast
          </DialogTitle>
        </DialogHeader>

        {bots.length === 0 ? (
          <div className="rounded-md border border-warn/40 bg-warn/10 p-3 text-[11px] text-warn">
            Add a Telegram bot first (in the Alerts dialog), then come back to link a channel.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Push one-to-many messages to a Telegram channel one of your bots admins. This is separate from your
              private alert chat — your alerts keep working unchanged.
            </p>

            {/* Channels list */}
            {channels.length > 0 ? (
              <div className="flex flex-col gap-1">
                {channels.map((c) => (
                  <div
                    key={c.id}
                    className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${
                      c.id === activeId ? 'border-accent/60 bg-accent/10' : 'border-border bg-surface-raised'
                    }`}
                  >
                    <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setActiveId(c.id)}>
                      <Radio className={`h-3.5 w-3.5 shrink-0 ${c.id === activeId ? 'text-accent' : 'text-muted-foreground'}`} />
                      <span className="truncate text-xs font-medium text-foreground">{c.title}</span>
                      <span className="truncate text-[10px] text-muted-foreground">{c.channelId}</span>
                      <Badge tone="muted" className="text-[9px]">{c.botLabel ?? 'bot'}</Badge>
                    </button>
                    <button className="shrink-0 text-muted-foreground hover:text-bear" title="Unlink" onClick={() => void removeChannel(c.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            {/* Add channel */}
            <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-surface-raised/40 p-2.5">
              <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Link a channel</span>
              <div className="flex gap-2">
                <select
                  value={botId}
                  onChange={(e) => setBotId(e.target.value)}
                  className="h-8 shrink-0 rounded-md border border-border bg-surface px-2 text-xs text-foreground"
                  aria-label="Bot"
                >
                  {bots.map((b) => (
                    <option key={b.id} value={b.id}>{b.label}</option>
                  ))}
                </select>
                <Input
                  placeholder="@channel or -100…"
                  value={channelInput}
                  onChange={(e) => setChannelInput(e.target.value)}
                  className="h-8 flex-1 text-xs"
                />
                <Button size="sm" className="h-8 gap-1" loading={addBusy} disabled={!channelInput.trim()} onClick={() => void addChannel()}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">The bot must be an admin of the channel.</p>
              {addError ? (
                <div className="flex items-start gap-1.5 rounded-md border border-bear/40 bg-bear/10 p-2 text-[11px] text-bear">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{addError}</span>
                </div>
              ) : null}
            </div>

            {/* Compose + log for the active channel */}
            {active ? (
              <div className="flex flex-col gap-2 border-t border-border/60 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground">Broadcast to {active.title}</span>
                  <span className="text-[10px] tabular-nums text-muted-foreground">{text.length}/{MAX_LEN}</span>
                </div>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
                  rows={3}
                  placeholder="Write a message to broadcast to your channel…"
                  className="w-full resize-y rounded-md border border-border bg-surface px-2.5 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-accent/60 focus:outline-none"
                />
                <div className="flex justify-end">
                  <Button size="sm" className="gap-1.5" loading={sendBusy} disabled={!text.trim()} onClick={() => void broadcast()}>
                    <Send className="h-3.5 w-3.5" /> Broadcast
                  </Button>
                </div>

                {log.length > 0 ? (
                  <div className="mt-1 flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Recent broadcasts</span>
                    <div className="max-h-40 divide-y divide-border/60 overflow-y-auto scroll-thin">
                      {log.map((b) => (
                        <div key={b.id} className="flex items-start gap-2 py-1.5">
                          {b.ok ? (
                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bull" />
                          ) : (
                            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bear" />
                          )}
                          <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">{b.text}</span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">{formatRelativeTime(b.sentAt)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
