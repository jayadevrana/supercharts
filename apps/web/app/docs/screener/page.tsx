import type { Metadata } from 'next';
import Link from 'next/link';
import { PulseCodeBlock } from '@/components/docs/pulse-code-block';
import {
  SCREENER_SCRIPTS,
  SCAN_STEPS,
  MATCH_RULES,
  STATUS_ROWS,
  SCREENER_LIMITS,
} from '@/features/docs/screener-guide';

export const metadata: Metadata = {
  title: 'Code a market screener',
  description:
    'Write one PulseScript and run it across the whole symbol catalog — crypto, forex, metals, indices. A symbol matches when your script fires a mark or alert() on the newest closed bar. No repaint, honest failures.',
};

export default function ScreenerGuide() {
  return (
    <article className="doc-prose space-y-4 text-sm leading-relaxed text-muted-foreground [&_strong]:text-foreground">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">Code a market screener</h1>
      <p className="max-w-2xl">
        A screen in SuperCharts is just a PulseScript. Anything you can express in the language — an indicator cross, a
        breakout, a volume condition, a multi-timeframe gate — you can run across <strong>every symbol in the catalog</strong> at
        once from the Scanner tab. Write it once on one chart, then screen the whole market with it.
      </p>

      <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 text-xs">
        <strong>The match rule:</strong> a symbol matches when your script raises a <code>mark</code> or calls{' '}
        <code>alert()</code> on the <strong>newest closed bar</strong>. Historical signals don’t count, and the still-forming bar
        is trimmed first — the same no-repaint semantics the alert engine uses.
      </div>

      <h2 className="pt-4 text-xl font-semibold text-foreground">How matching works</h2>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {MATCH_RULES.map((r) => (
          <div key={r.title} className="rounded-lg border border-border bg-surface p-3">
            <div className="text-sm font-semibold text-foreground">{r.title}</div>
            <p className="mt-1 text-xs">{r.body}</p>
          </div>
        ))}
      </div>

      <h2 className="pt-4 text-xl font-semibold text-foreground">Run one, step by step</h2>
      <ol className="space-y-3">
        {SCAN_STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent"
            >
              {i + 1}
            </span>
            <div>
              <div className="font-semibold text-foreground">{s.title}</div>
              <p className="mt-0.5">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <h2 className="pt-4 text-xl font-semibold text-foreground">Example screens</h2>
      <p className="max-w-2xl">
        Each of these runs as-is: hit <strong>Run in terminal</strong> to load it into the Script dock, check the marks on the
        active chart, then save it and point the scanner at it. Every example is executed through the real scan engine in the
        test suite, so what you copy here is exactly what runs.
      </p>
      {SCREENER_SCRIPTS.map((s) => (
        <section key={s.id}>
          <h3 className="pt-2 text-base font-semibold text-foreground">{s.title}</h3>
          <p className="mt-1 max-w-2xl text-xs">{s.blurb}</p>
          <PulseCodeBlock code={s.code} />
        </section>
      ))}

      <h2 className="pt-4 text-xl font-semibold text-foreground">Honest results, row by row</h2>
      <p className="max-w-2xl">
        Every scanned symbol reports a status — nothing is silently dropped and nothing is faked. Symbols need at least{' '}
        <strong>{SCREENER_LIMITS.minBars} closed bars</strong> on the chosen timeframe, and each symbol gets a{' '}
        <strong>{SCREENER_LIMITS.perSymbolTimeoutMs}ms</strong> execution budget so one heavy script can’t hang the scan.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-left text-foreground">
              <th className="py-2 pr-3 font-semibold">Status</th>
              <th className="py-2 font-semibold">Meaning</th>
            </tr>
          </thead>
          <tbody>
            {STATUS_ROWS.map((r) => (
              <tr key={r.status} className="border-b border-border/50 align-top">
                <td className="py-2 pr-3 font-medium text-foreground">
                  <code>{r.status}</code>
                </td>
                <td className="py-2">{r.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-border bg-surface-sunken p-3 text-xs">
        <strong>Keep screens lean.</strong> The scanner runs your script once per symbol, so prefer <code>ta.*</code> built-ins
        (they’re cached across the run) over hand-rolled loops, and gate expensive work behind <code>when</code> conditions. A
        script that only needs to answer “does this fire now?” doesn’t need to draw anything — a bare <code>alert()</code> is the
        cheapest possible screen.
      </div>

      <p className="pt-4 text-xs">
        New to the language? Start with the{' '}
        <Link href="/docs/getting-started" className="text-accent hover:underline">
          getting-started guide
        </Link>{' '}
        or grab a strategy from the{' '}
        <Link href="/docs/cookbook" className="text-accent hover:underline">
          cookbook
        </Link>
        . Found a setup worth trading?{' '}
        <Link href="/docs/backtesting" className="text-accent hover:underline">
          Backtest it
        </Link>{' '}
        — or{' '}
        <Link href="/docs/automation" className="text-accent hover:underline">
          automate it on Zerodha
        </Link>
        .
      </p>
    </article>
  );
}
