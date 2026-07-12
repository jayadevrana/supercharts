'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Mail, Lock } from 'lucide-react';
import { useSession } from '@/lib/auth';

const OAUTH_ERRORS: Record<string, string> = {
  google_unconfigured: 'Google sign-in isn’t configured yet.',
  google_denied: 'Google sign-in was cancelled.',
  google_state: 'Sign-in expired — please try again.',
  google_token: 'Could not verify with Google — please try again.',
  google_userinfo: 'Could not read your Google profile — please try again.',
  google_failed: 'Google sign-in failed — please try again.',
};

export default function LoginPage() {
  const { googleEnabled, loading } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('error');
    if (code) setError(OAUTH_ERRORS[code] ?? 'Sign-in failed — please try again.');
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        window.location.href = '/terminal';
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error === 'invalid_credentials' ? 'Wrong email or password.' : 'Could not sign in.');
    } catch {
      setError('Network error — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="grid w-full max-w-5xl items-stretch gap-10 lg:grid-cols-[1fr_1.1fr]">
          <div className="relative hidden lg:block">
            <div className="glass-panel h-full overflow-hidden p-1">
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between border-b border-border/60 px-4 py-3 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  <span>BTC / USDT · 1m</span>
                  <span className="text-bull">live</span>
                </div>
                <div className="flex-1 bg-gradient-to-b from-surface to-surface-sunken/40 p-5">
                  <h3 className="text-xl font-semibold">Welcome back to the terminal.</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Your layouts, drawings, watchlists, and alerts are saved server-side and load instantly when you sign in.
                  </p>
                  <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
                    <li>• Live tick stream resumes from where you left off.</li>
                    <li>• Heatmap intensity calibrated against your symbol history.</li>
                    <li>• Drawings rendered in chart space — survive any zoom or pan.</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-surface/80 p-8 shadow-glass">
            <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in to load your saved workspace and manage alerts.
            </p>
            {error && (
              <p className="mt-4 rounded-md border border-bear/40 bg-bear/10 px-3 py-2 text-sm text-bear" role="alert">
                {error}
              </p>
            )}
            <form className="mt-7 space-y-4" onSubmit={onSubmit}>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Email</span>
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="trader@example.com"
                  leftAdornment={<Mail className="h-4 w-4" />}
                  className="mt-2"
                />
              </label>
              <label className="block">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Password
                  </span>
                </div>
                <Input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  leftAdornment={<Lock className="h-4 w-4" />}
                  className="mt-2"
                />
              </label>
              <Button type="submit" className="w-full" size="lg" disabled={submitting}>
                {submitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
            {(googleEnabled || loading) && (
              <>
                <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    window.location.href = '/api/auth/google/start';
                  }}
                >
                  Continue with Google
                </Button>
              </>
            )}
            <p className="mt-6 text-center text-xs text-muted-foreground">
              New here?{' '}
              <Link href="/signup" className="text-accent hover:underline">
                Create an account
              </Link>
            </p>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
