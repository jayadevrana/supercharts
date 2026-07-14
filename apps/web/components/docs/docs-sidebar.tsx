'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Only pages that EXIST are listed — reference/cookbook entries land with their milestones. */
const SECTIONS: Array<{ title: string; items: Array<{ href: string; label: string }> }> = [
  {
    title: 'PulseScript',
    items: [
      { href: '/docs', label: 'Overview' },
      { href: '/docs/getting-started', label: 'Getting started' },
      { href: '/docs/language', label: 'Language tour' },
    ],
  },
  {
    title: 'Guides',
    items: [
      { href: '/docs/cookbook', label: 'Cookbook' },
      { href: '/docs/backtesting', label: 'Backtesting & optimization' },
      { href: '/docs/automation', label: 'Automate on Zerodha' },
      { href: '/docs/from-pine', label: 'Coming from Pine' },
    ],
  },
  {
    title: 'Reference',
    items: [
      { href: '/docs/reference/ta', label: 'ta.* functions' },
      { href: '/docs/reference/math', label: 'math.* functions' },
      { href: '/docs/reference/inputs', label: 'input.*' },
      { href: '/docs/reference/outputs', label: 'Outputs' },
    ],
  },
];

export function DocsSidebar() {
  const pathname = usePathname();
  return (
    <nav aria-label="Documentation" className="space-y-4">
      {SECTIONS.map((s) => (
        <div key={s.title}>
          <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{s.title}</div>
          <ul className="space-y-0.5">
            {s.items.map((i) => (
              <li key={i.href}>
                <Link
                  href={i.href}
                  aria-current={pathname === i.href ? 'page' : undefined}
                  className={`block rounded-md px-2 py-1.5 text-sm transition-colors ${
                    pathname === i.href ? 'bg-accent/10 text-accent' : 'text-muted-foreground hover:bg-surface-raised hover:text-foreground'
                  }`}
                >
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
