'use client';

import { useState } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Mail } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      // Always resolves to the same "check your inbox" state — the API never reveals whether the
      // address exists, so we mirror that here and don't branch on the response.
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      });
      setSent(true);
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
          <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
          {sent ? (
            <>
              <p className="mt-3 text-sm text-muted-foreground">
                If an account exists for <span className="text-foreground">{email}</span>, we&rsquo;ve sent a reset link.
                Check your inbox (and spam) — the link expires in 30 minutes.
              </p>
              <Button
                variant="outline"
                className="mt-6 w-full"
                size="lg"
                onClick={() => {
                  setSent(false);
                  setEmail('');
                }}
              >
                Send to a different email
              </Button>
              <p className="mt-6 text-center text-xs text-muted-foreground">
                <Link href="/login" className="text-accent hover:underline">
                  Back to sign in
                </Link>
              </p>
            </>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted-foreground">
                Enter your email and we&rsquo;ll send you a link to set a new password.
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
                <Button type="submit" className="w-full" size="lg" disabled={submitting}>
                  {submitting ? 'Sending…' : 'Send reset link'}
                </Button>
              </form>
              <p className="mt-6 text-center text-xs text-muted-foreground">
                Remembered it?{' '}
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
