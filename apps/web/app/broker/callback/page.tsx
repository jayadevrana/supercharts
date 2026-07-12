'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { Button } from '@/components/ui/button';
import { CheckCircle2, TriangleAlert, Loader2 } from 'lucide-react';

/**
 * Kite login redirect target (GW-2). Set your Kite Connect app's redirect URL to
 * https://supercharting.com/broker/callback and the daily login becomes one click:
 * Zerodha redirects here with ?request_token=…, we exchange it server-side, done.
 * Falls back cleanly when the token is missing/expired (Kite request tokens are
 * single-use and die within minutes).
 */
export default function BrokerCallbackPage() {
  const [state, setState] = useState<'working' | 'ok' | 'error'>('working');
  const [message, setMessage] = useState('Completing your Zerodha login…');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestToken = params.get('request_token');
    window.history.replaceState(null, '', '/broker/callback'); // never keep the token in the URL/history
    if (!requestToken) {
      setState('error');
      setMessage('No request_token in the URL. Start the login again from the terminal’s Broker dialog.');
      return;
    }
    void (async () => {
      try {
        const res = await fetch('/api/broker/reconnect', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ broker: 'kite', requestToken }),
        });
        const body = (await res.json().catch(() => ({}))) as { message?: string; account?: { accountId?: string } };
        if (res.ok) {
          setState('ok');
          setMessage(`Kite connected${body.account?.accountId ? ` — account ${body.account.accountId}` : ''}. You're live for today.`);
        } else {
          setState('error');
          setMessage(body.message ?? 'Kite rejected the login. Start again from the Broker dialog.');
        }
      } catch {
        setState('error');
        setMessage('Could not reach the server — try again from the Broker dialog.');
      }
    })();
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface/80 p-8 text-center shadow-glass">
          {state === 'working' && <Loader2 className="mx-auto h-8 w-8 animate-spin text-accent" />}
          {state === 'ok' && <CheckCircle2 className="mx-auto h-8 w-8 text-bull" />}
          {state === 'error' && <TriangleAlert className="mx-auto h-8 w-8 text-bear" />}
          <h1 className="mt-4 text-xl font-semibold tracking-tight">
            {state === 'ok' ? 'Broker connected' : state === 'error' ? 'Login not completed' : 'Connecting…'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{message}</p>
          <Link href="/terminal">
            <Button className="mt-6" size="sm">Open terminal</Button>
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
