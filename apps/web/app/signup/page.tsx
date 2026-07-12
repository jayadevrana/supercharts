'use client';

import { useState } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Mail, Lock, User } from 'lucide-react';
import { useSession } from '@/lib/auth';

export default function SignupPage() {
  const { googleEnabled, loading } = useSession();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, displayName: displayName || undefined }),
      });
      if (res.ok) {
        window.location.href = '/terminal';
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(
        body.error === 'email_taken'
          ? 'An account with that email already exists.'
          : body.error === 'invalid_payload'
            ? 'Please enter a valid email and an 8+ character password.'
            : 'Could not create your account.',
      );
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
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface/80 p-8 shadow-glass">
          <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Free to try with live Binance market data. Your layouts, watchlists, and alerts save to your account.
          </p>
          {error && (
            <p className="mt-4 rounded-md border border-bear/40 bg-bear/10 px-3 py-2 text-sm text-bear" role="alert">
              {error}
            </p>
          )}
          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Display name</span>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Alex Trader"
                leftAdornment={<User className="h-4 w-4" />}
                className="mt-2"
              />
            </label>
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
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Password</span>
              <Input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                leftAdornment={<Lock className="h-4 w-4" />}
                className="mt-2"
              />
            </label>
            <Button type="submit" className="w-full" size="lg" disabled={submitting}>
              {submitting ? 'Creating account…' : 'Create account'}
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
          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            By signing up you agree to our{' '}
            <Link href="/legal/terms" className="text-foreground hover:underline">
              Terms
            </Link>{' '}
            and{' '}
            <Link href="/legal/privacy" className="text-foreground hover:underline">
              Privacy
            </Link>
            .
          </p>
          <p className="mt-5 text-center text-xs text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="text-accent hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
