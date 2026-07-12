'use client';

import { useEffect, useState } from 'react';
import { Landmark, Link2, CheckCircle2, TriangleAlert, Unplug, ExternalLink, RefreshCcw } from 'lucide-react';
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

interface ConnectionSummary {
  id: string;
  broker: string;
  apiKeyLast4: string;
  status: string;
  accountMeta: { accountId: string; name: string } | null;
  lastLoginAt: number | null;
  loginUrl?: string;
}

/**
 * BYOB broker connect wizard (GW-2) — Zerodha Kite first. Clones the OANDA wizard UX:
 * secrets validated against the real broker and stored server-side (encrypted); the client
 * only ever sees the key's last 4. Kite tokens expire daily, so the connected card carries
 * the one-tap Reconnect flow (open Kite login → paste the request_token → done).
 * ADMIN-ONLY until GW-4 ships the plan gate — the top bar hides the button for non-admins.
 */
export function BrokerConnectDialog() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ConnectionSummary[] | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [requestToken, setRequestToken] = useState('');
  const [pendingLoginUrl, setPendingLoginUrl] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kite = items?.find((c) => c.broker === 'kite') ?? null;

  const refresh = async (): Promise<void> => {
    try {
      const res = await api<{ items: ConnectionSummary[] }>('/broker/connections');
      setItems(res.items);
    } catch {
      setItems([]);
    }
  };
  useEffect(() => {
    if (open) {
      setError(null);
      setReconnecting(false);
      setRequestToken('');
      void refresh();
    }
  }, [open]);

  const postJson = async (path: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> => {
    const res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, data };
  };

  const beginConnect = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const { ok, data } = await postJson('/broker/connect', { broker: 'kite', apiKey: apiKey.trim(), apiSecret: apiSecret.trim() });
      if (!ok) {
        setError(String(data.message ?? 'Could not save the app.'));
        return;
      }
      setPendingLoginUrl(String(data.loginUrl ?? ''));
      await refresh(); // the pending row now exists → the card + token-entry step renders
      toast({ title: 'Kite app saved', description: 'Now complete the Zerodha login.', tone: 'success' });
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const completeWithToken = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const { ok, data } = await postJson('/broker/reconnect', { broker: 'kite', requestToken: requestToken.trim() });
      if (!ok) {
        setError(String(data.message ?? 'Kite rejected the request token.'));
        return;
      }
      setRequestToken('');
      setPendingLoginUrl(null);
      setReconnecting(false);
      await refresh();
      const account = data.account as { accountId?: string } | undefined;
      toast({ title: 'Kite connected', description: account?.accountId, tone: 'success' });
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    setBusy(true);
    try {
      await api('/broker/connections/kite', { method: 'DELETE' });
      setPendingLoginUrl(null);
      await refresh();
      toast({ title: 'Kite disconnected', tone: 'success' });
    } finally {
      setBusy(false);
    }
  };

  const connected = kite?.status === 'active';
  const needsDailyLogin = Boolean(kite) && !connected;
  const showTokenEntry = Boolean(pendingLoginUrl) || reconnecting || needsDailyLogin;
  const loginUrl = pendingLoginUrl ?? kite?.loginUrl ?? '';

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="relative px-2 text-muted-foreground hover:text-foreground" title="Connect your broker (Zerodha Kite)" aria-label="Connect broker">
          <Landmark className="h-4 w-4" />
          {connected ? <span className="absolute right-1 top-1 inline-block h-1.5 w-1.5 rounded-full bg-bull" /> : null}
          {needsDailyLogin ? <span className="absolute right-1 top-1 inline-block h-1.5 w-1.5 rounded-full bg-bear" /> : null}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Link2 className="h-4 w-4 text-accent" /> Connect broker · Zerodha Kite
          </DialogTitle>
        </DialogHeader>

        {kite ? (
          <div className="flex flex-col gap-3">
            <div className={`flex items-start gap-2 rounded-md border p-3 ${connected ? 'border-bull/40 bg-bull/10' : 'border-bear/40 bg-bear/10'}`}>
              {connected ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-bull" /> : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-bear" />}
              <div className="text-sm">
                <div className="font-semibold text-foreground">
                  {kite.accountMeta?.name ?? 'Kite account'}
                  {kite.accountMeta?.accountId ? <span className="text-muted-foreground"> · {kite.accountMeta.accountId}</span> : null}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  key ••••{kite.apiKeyLast4}
                  {' · '}
                  <Badge tone={connected ? 'muted' : 'warn'} className="text-[9px]">{connected ? 'active' : 'login needed'}</Badge>
                  {kite.lastLoginAt ? <> · last login {new Date(kite.lastLoginAt).toLocaleString()}</> : null}
                </div>
              </div>
            </div>
            {!connected ? (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Kite access tokens expire every trading day. Reconnect: open the Zerodha login, sign in, and paste the{' '}
                <code>request_token</code> from the redirected URL.
              </p>
            ) : null}
            {showTokenEntry ? (
              <>
                {loginUrl ? (
                  <a href={loginUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] text-accent hover:underline">
                    <ExternalLink className="h-3 w-3" /> Open Zerodha login
                  </a>
                ) : null}
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-muted-foreground">request_token (from the redirect URL)</span>
                  <Input autoComplete="off" placeholder="paste request_token" value={requestToken} onChange={(e) => setRequestToken(e.target.value)} />
                </label>
                <Button size="sm" loading={busy} disabled={!requestToken.trim()} onClick={() => void completeWithToken()}>
                  Complete login
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" className="gap-1" onClick={() => setReconnecting(true)}>
                <RefreshCcw className="h-3.5 w-3.5" /> Reconnect (new daily token)
              </Button>
            )}
            {error ? (
              <div className="flex items-start gap-1.5 rounded-md border border-bear/40 bg-bear/10 p-2 text-[11px] text-bear">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{error}</span>
              </div>
            ) : null}
            <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" loading={busy} onClick={() => void disconnect()}>
              <Unplug className="h-3.5 w-3.5" /> Disconnect
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Bring your own Zerodha Kite Connect app: your key/secret are stored encrypted server-side and orders always go
              through your own account. Create an app at developers.kite.trade, then paste its credentials here.
            </p>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">API key</span>
              <Input autoComplete="off" placeholder="Kite Connect api_key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">API secret</span>
              <Input type="password" autoComplete="off" placeholder="Kite Connect api_secret" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} />
            </label>
            {pendingLoginUrl ? null : (
              <Button size="sm" loading={busy} disabled={!apiKey.trim() || !apiSecret.trim()} onClick={() => void beginConnect()}>
                Save & open login
              </Button>
            )}
            {error ? (
              <div className="flex items-start gap-1.5 rounded-md border border-bear/40 bg-bear/10 p-2 text-[11px] text-bear">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{error}</span>
              </div>
            ) : null}
            <a
              href="https://developers.kite.trade/apps"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-3 w-3" /> Where do I create a Kite app?
            </a>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
