'use client';

import { useEffect, useState } from 'react';
import { Plug, Link2, CheckCircle2, TriangleAlert, Unplug, ExternalLink } from 'lucide-react';
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
import { api } from '@/lib/api';
import { toast } from '@/components/use-toast';

interface OandaStatus {
  connected: boolean;
  accountId?: string;
  env?: string;
  alias?: string | null;
  currency?: string | null;
  last4?: string;
  verifiedAt?: number;
}

/**
 * OANDA onboarding wizard (Phase 3 #11). Collects an API token + account id, validates them
 * against the real OANDA API server-side (never faked), and stores them in the user's config.
 * The token never returns to the client — only its last 4 chars + verified account meta.
 */
export function OandaConnectDialog() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<OandaStatus | null>(null);
  const [token, setToken] = useState('');
  const [accountId, setAccountId] = useState('');
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    try {
      setStatus(await api<OandaStatus>('/oanda'));
    } catch {
      setStatus({ connected: false });
    }
  };
  useEffect(() => {
    if (open) {
      setError(null);
      void refresh();
    }
  }, [open]);

  const connect = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      // Direct fetch so we can read OANDA's real validation message on a 400.
      const res = await fetch('/api/oanda', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ apiToken: token.trim(), accountId: accountId.trim(), env: live ? 'live' : 'practice' }),
      });
      const body = (await res.json().catch(() => ({}))) as OandaStatus & { message?: string };
      if (!res.ok) {
        setError(body.message ?? `Connection failed (${res.status}).`);
        return;
      }
      setStatus(body);
      setToken('');
      toast({ title: 'OANDA connected', description: body.alias ?? body.accountId, tone: 'success' });
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    setBusy(true);
    try {
      await api('/oanda', { method: 'DELETE' });
      setStatus({ connected: false });
      toast({ title: 'OANDA disconnected', tone: 'success' });
    } finally {
      setBusy(false);
    }
  };

  const connected = status?.connected;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="relative px-2 text-muted-foreground hover:text-foreground" title="Connect OANDA for live forex / metals" aria-label="Connect OANDA">
          <Plug className="h-4 w-4" />
          {connected ? <span className="absolute right-1 top-1 inline-block h-1.5 w-1.5 rounded-full bg-bull" /> : null}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Link2 className="h-4 w-4 text-accent" /> Connect OANDA
          </DialogTitle>
        </DialogHeader>

        {connected ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-start gap-2 rounded-md border border-bull/40 bg-bull/10 p-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-bull" />
              <div className="text-sm">
                <div className="font-semibold text-foreground">
                  {status?.alias ?? 'Account'} {status?.currency ? <span className="text-muted-foreground">· {status.currency}</span> : null}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {status?.accountId} · token ••••{status?.last4}
                  {' · '}
                  <Badge tone={status?.env === 'live' ? 'warn' : 'muted'} className="text-[9px]">{status?.env}</Badge>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">Token verified with OANDA and saved to your config (server-side only). The live feed picks these up on the server's next start.</p>
            <Button variant="outline" size="sm" className="gap-1" loading={busy} onClick={() => void disconnect()}>
              <Unplug className="h-3.5 w-3.5" /> Disconnect
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Add your OANDA REST token to stream live forex, metals & indices. The token is validated with OANDA and stored
              server-side only — never shown again.
            </p>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">API token</span>
              <Input type="password" autoComplete="off" placeholder="OANDA v3 API token" value={token} onChange={(e) => setToken(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">Account ID</span>
              <Input placeholder="001-001-1234567-001" value={accountId} onChange={(e) => setAccountId(e.target.value)} />
            </label>
            <label className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Environment</span>
              <span className="flex items-center gap-2">
                <span className={live ? 'text-muted-foreground' : 'text-foreground'}>Practice</span>
                <Switch checked={live} onCheckedChange={setLive} />
                <span className={live ? 'text-bear' : 'text-muted-foreground'}>Live</span>
              </span>
            </label>
            {error ? (
              <div className="flex items-start gap-1.5 rounded-md border border-bear/40 bg-bear/10 p-2 text-[11px] text-bear">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{error}</span>
              </div>
            ) : null}
            <Button size="sm" loading={busy} disabled={!token.trim() || !accountId.trim()} onClick={() => void connect()}>
              Validate & connect
            </Button>
            <a
              href="https://www.oanda.com/account/tpa/personal_token"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-3 w-3" /> Where do I find my token?
            </a>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
