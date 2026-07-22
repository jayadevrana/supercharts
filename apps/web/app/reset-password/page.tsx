'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Lock } from 'lucide-react';

export default function ResetPasswordPage() {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Read the token from the URL client-side (avoids the useSearchParams Suspense boundary).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token');
    if (t) setToken(t);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords don’t match.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token, newPassword: password }),
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(
        body.error === 'invalid_or_expired'
          ? 'This reset link is invalid or has expired. Request a new one.'
          : 'Could not reset your password — please try again.',
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
          <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
          {done ? (
            <>
              <p className="mt-3 text-sm text-muted-foreground">
                Your password has been reset and every device has been signed out. You can sign in with your new password now.
              </p>
              <Link href="/login">
                <Button className="mt-6 w-full" size="lg">
                  Go to sign in
                </Button>
              </Link>
            </>
          ) : !token ? (
            <>
              <p className="mt-3 text-sm text-muted-foreground">
                This link is missing its reset token. Request a fresh link to continue.
              </p>
              <Link href="/forgot-password">
                <Button variant="outline" className="mt-6 w-full" size="lg">
                  Request a new link
                </Button>
              </Link>
            </>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted-foreground">Enter a new password for your account.</p>
              {error && (
                <p className="mt-4 rounded-md border border-bear/40 bg-bear/10 px-3 py-2 text-sm text-bear" role="alert">
                  {error}
                </p>
              )}
              <form className="mt-7 space-y-4" onSubmit={onSubmit}>
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">New password</span>
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
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Confirm password</span>
                  <Input
                    type="password"
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Re-enter your new password"
                    leftAdornment={<Lock className="h-4 w-4" />}
                    className="mt-2"
                  />
                </label>
                <Button type="submit" className="w-full" size="lg" disabled={submitting}>
                  {submitting ? 'Resetting…' : 'Reset password'}
                </Button>
              </form>
              <p className="mt-6 text-center text-xs text-muted-foreground">
                <Link href="/login" className="text-accent hover:underline">
                  Back to sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
