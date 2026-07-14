import type { Metadata } from 'next';
import Link from 'next/link';
import { PulseCodeBlock } from '@/components/docs/pulse-code-block';
import {
  AUTOMATION_STRATEGY_SCRIPT,
  AUTOMATION_DEFAULTS,
  ARM_STEPS,
  SAFETY_RAILS,
  FLIP_TABLE,
} from '@/features/docs/automation-guide';

export const metadata: Metadata = {
  title: 'Automate a SuperTrend flip on Zerodha',
  description:
    'Arm a SuperTrend position-flip on any Zerodha (Kite) instrument — stock, option, future, or MCX. BUY signals go long, SELL signals flip to short, all through SuperCharts’ audited, IP-whitelisted broker pipeline. Pro feature.',
};

export default function AutomationGuide() {
  return (
    <article className="doc-prose space-y-4 text-sm leading-relaxed text-muted-foreground [&_strong]:text-foreground">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">
        Automate a SuperTrend flip on your Kite instrument
      </h1>
      <p className="max-w-2xl">
        Connect your own Zerodha account and let a SuperTrend strategy trade it for you. Arm it on{' '}
        <strong>any Kite instrument</strong> — a stock, an option, a future, or an MCX contract — and every SuperTrend flip
        routes a <strong>position-flip</strong> market order through the same audited, IP-whitelisted pipeline your manual orders
        use. This is a <strong>Pro</strong> feature; you bring your own broker, so you only ever trade your own account with your
        own data.
      </p>

      <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 text-xs">
        <strong>How the flip works:</strong> a BUY signal makes you net long (closing any short first); a SELL signal makes you
        net short (closing the long first). One net position, flipped each signal — never stacked.
      </div>

      <h2 className="pt-4 text-xl font-semibold text-foreground">The strategy</h2>
      <p className="max-w-2xl">
        A SuperTrend line is an ATR trailing stop that flips with the trend. The armed automation watches the flip of its{' '}
        <code>direction</code> and fires: up → long, down → short. This is the exact script — reusing{' '}
        <code>ta.supertrend</code>, the same indicator engine the order evaluates — so the marks you see are the bars your order
        flips on. Defaults: ATR length <strong>{AUTOMATION_DEFAULTS.atrLength}</strong>, multiplier{' '}
        <strong>{AUTOMATION_DEFAULTS.multiplier}</strong>. Hit <strong>Run in terminal</strong> to try it live before you arm it.
      </p>
      <PulseCodeBlock code={AUTOMATION_STRATEGY_SCRIPT} />

      <h2 className="pt-4 text-xl font-semibold text-foreground">What each signal does</h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-left text-foreground">
              <th className="py-2 pr-3 font-semibold">Signal</th>
              <th className="py-2 pr-3 font-semibold">If flat</th>
              <th className="py-2 pr-3 font-semibold">If opposite</th>
              <th className="py-2 font-semibold">If already there</th>
            </tr>
          </thead>
          <tbody>
            {FLIP_TABLE.map((r) => (
              <tr key={r.signal} className="border-b border-border/50 align-top">
                <td className="py-2 pr-3 font-medium text-foreground">{r.signal}</td>
                <td className="py-2 pr-3">{r.whenFlat}</td>
                <td className="py-2 pr-3">{r.whenOpposite}</td>
                <td className="py-2">{r.whenSame}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="pt-4 text-xl font-semibold text-foreground">Arm it, step by step</h2>
      <ol className="space-y-3">
        {ARM_STEPS.map((s, i) => (
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

      <h2 className="pt-4 text-xl font-semibold text-foreground">Safety rails</h2>
      <p className="max-w-2xl">
        Automated orders are wrapped in guardrails you can’t switch off. The build loop that ships this never places a live order
        — <strong>you</strong> arm it, and only after your IP is whitelisted and your token is fresh.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {SAFETY_RAILS.map((r) => (
          <div key={r.title} className="rounded-lg border border-border bg-surface p-3">
            <div className="text-sm font-semibold text-foreground">{r.title}</div>
            <p className="mt-1 text-xs">{r.body}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-surface-sunken p-3 text-xs">
        <strong>Honest costs.</strong> Zerodha order APIs are free (Kite Connect Personal); live Indian chart data is your own
        Kite Connect data add-on (₹500/mo to Zerodha). SuperCharts buys no market data and redistributes none — you only ever see
        your own broker’s feed.
      </div>

      <p className="pt-4 text-xs">
        New to PulseScript? Start with the{' '}
        <Link href="/docs/getting-started" className="text-accent hover:underline">
          getting-started guide
        </Link>{' '}
        or browse the{' '}
        <Link href="/docs/cookbook" className="text-accent hover:underline">
          cookbook
        </Link>
        . Want to validate the edge first? See{' '}
        <Link href="/docs/backtesting" className="text-accent hover:underline">
          backtesting &amp; optimization
        </Link>
        .
      </p>
    </article>
  );
}
