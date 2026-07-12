'use client';

import Link from 'next/link';
import { BrandMark } from './brand-mark';
import { ThemeToggle } from './theme-toggle';
import { Button } from './ui/button';
import { useSession } from '@/lib/auth';

export function SiteHeader() {
  const { user, loading, signOut } = useSession();
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/70 backdrop-blur-xl">
      <div className="container flex h-14 items-center justify-between gap-4">
        <Link href="/" className="flex items-center">
          <BrandMark />
        </Link>
        <nav className="hidden items-center gap-1 text-sm text-muted-foreground md:flex">
          <Link href="/#features" className="rounded-md px-3 py-1.5 hover:text-foreground">
            Features
          </Link>
          <Link href="/#orderflow" className="rounded-md px-3 py-1.5 hover:text-foreground">
            Order flow
          </Link>
          <Link href="/docs" className="rounded-md px-3 py-1.5 hover:text-foreground">
            Docs
          </Link>
          <Link href="/pricing" className="rounded-md px-3 py-1.5 hover:text-foreground">
            Pricing
          </Link>
          <Link href="/terminal" className="rounded-md px-3 py-1.5 hover:text-foreground">
            Terminal demo
          </Link>
          <Link href="/legal/disclaimer" className="rounded-md px-3 py-1.5 hover:text-foreground">
            Disclaimer
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {loading ? null : user ? (
            <>
              <span
                className="hidden max-w-[160px] truncate text-sm text-muted-foreground sm:block"
                title={user.email}
              >
                {user.displayName || user.email}
              </span>
              <Button variant="ghost" size="sm" onClick={() => void signOut()}>
                Sign out
              </Button>
              <Link href="/terminal">
                <Button size="sm">Open terminal</Button>
              </Link>
            </>
          ) : (
            <>
              <Link href="/login" className="hidden sm:block">
                <Button variant="ghost" size="sm">
                  Sign in
                </Button>
              </Link>
              <Link href="/login">
                <Button size="sm">Open terminal</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
