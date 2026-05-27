import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, X } from 'lucide-react';

export default function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main>
        <section className="border-b border-border">
          <div className="container py-16 text-center">
            <Badge tone="accent" className="mb-4">
              Pricing
            </Badge>
            <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
              The whole terminal. Two terms. One price each.
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
              No feature gates within Pro. No usage caps. Two periods so you can commit to what fits.
            </p>
          </div>
        </section>
        <section className="border-b border-border">
          <div className="container grid gap-5 py-14 lg:grid-cols-2">
            <PlanCard
              eyebrow="Pro 6M"
              price="$400"
              interval="6 months"
              monthly="≈ $66.6 / month"
              perks={[
                ['Live crypto + forex charts', true],
                ['Volume profile (VR / session / fixed / anchored)', true],
                ['Footprint candles + imbalance + absorption', true],
                ['Liquidity heatmap', true],
                ['Deep-trade bubbles + tooltip context', true],
                ['Unlimited drawings & layouts', true],
                ['4 / 8 / 16 multi-window grid', true],
                ['News + chart markers', true],
                ['Alerts + replay mode', true],
                ['Priority data routing', false],
                ['Extended historical depth', false],
                ['Early access to new features', false],
              ]}
              ctaLabel="Start Pro 6M"
            />
            <PlanCard
              eyebrow="Pro Annual"
              price="$600"
              interval="12 months"
              monthly="≈ $50 / month"
              highlighted
              perks={[
                ['Everything in Pro 6M', true],
                ['Best value vs. 6M', true],
                ['Priority data routing', true],
                ['Extended historical depth', true],
                ['Early access to new features', true],
                ['Priority support', true],
                ['Live crypto + forex charts', true],
                ['Volume profile suite', true],
                ['Footprint candles', true],
                ['Liquidity heatmap', true],
                ['Deep-trade bubbles', true],
                ['Multi-window grid', true],
              ]}
              ctaLabel="Start Pro Annual"
            />
          </div>
        </section>
        <FAQ />
      </main>
      <SiteFooter />
    </div>
  );
}

function PlanCard({
  eyebrow,
  price,
  interval,
  monthly,
  perks,
  highlighted = false,
  ctaLabel,
}: {
  eyebrow: string;
  price: string;
  interval: string;
  monthly: string;
  perks: Array<[string, boolean]>;
  highlighted?: boolean;
  ctaLabel: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border p-8 ${
        highlighted ? 'border-accent/50 bg-accent/5 shadow-floating' : 'border-border bg-surface/70'
      }`}
    >
      {highlighted ? (
        <div className="absolute right-6 top-6 rounded-full border border-accent/40 bg-accent/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
          Best value
        </div>
      ) : null}
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</div>
      <div className="mt-4 flex items-baseline gap-3">
        <span className="text-5xl font-semibold tracking-tight">{price}</span>
        <span className="text-sm text-muted-foreground">{interval}</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{monthly}</div>
      <ul className="mt-7 space-y-2.5">
        {perks.map(([label, included]) => (
          <li key={label} className="flex items-start gap-2.5 text-sm">
            {included ? (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-bull" />
            ) : (
              <X className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
            )}
            <span className={included ? 'text-foreground' : 'text-muted-foreground/60'}>{label}</span>
          </li>
        ))}
      </ul>
      <Link href="/signup" className="mt-8 block">
        <Button className="w-full" variant={highlighted ? 'primary' : 'outline'} size="lg">
          {ctaLabel}
        </Button>
      </Link>
      <p className="mt-3 text-center text-[11px] text-muted-foreground">
        Checkout returns a transparent setup state until Stripe keys are configured.
      </p>
    </div>
  );
}

function FAQ() {
  const faqs = [
    {
      q: 'Do I need an API key to use the terminal?',
      a: 'No. Binance public market data is free and requires no key. OANDA, CryptoPanic, Finnhub and others are optional integrations — drop credentials into .env to enable.',
    },
    {
      q: 'Does forex have real exchange volume?',
      a: 'Spot forex is decentralized. SuperCharts honestly labels forex volume as tick volume or broker-derived liquidity. We never fake centralized order books for forex.',
    },
    {
      q: 'Why two plans instead of monthly billing?',
      a: 'Charting terminals reward consistency. Committing for 6 or 12 months means we can invest in your data pipeline, not on churn-fighting tooling.',
    },
    {
      q: 'Is there a free trial?',
      a: 'Yes. The terminal is fully usable in demo mode on this domain with live Binance data. You only pay when you want saved layouts, alerts, and provider integrations.',
    },
    {
      q: 'Can I export my drawings?',
      a: 'Every drawing serializes to JSON. Layouts export with one click. You own your work — we do not lock data in.',
    },
  ];
  return (
    <section className="border-b border-border">
      <div className="container py-16">
        <h2 className="text-3xl font-semibold tracking-tight">Frequently asked.</h2>
        <div className="mt-8 divide-y divide-border rounded-2xl border border-border bg-surface/70">
          {faqs.map((f) => (
            <details key={f.q} className="group">
              <summary className="flex cursor-pointer items-center justify-between gap-3 p-5 text-sm font-medium text-foreground">
                {f.q}
                <span className="text-muted-foreground transition-transform group-open:rotate-180">▾</span>
              </summary>
              <div className="px-5 pb-5 text-sm text-muted-foreground">{f.a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
