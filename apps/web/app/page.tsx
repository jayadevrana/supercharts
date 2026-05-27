import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Activity,
  Boxes,
  CandlestickChart,
  Database,
  Flame,
  GanttChartSquare,
  Gauge,
  Layers,
  LineChart,
  Newspaper,
  ShieldCheck,
  Sparkles,
  Waves,
} from 'lucide-react';

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main>
        <Hero />
        <SocialProof />
        <FeatureGrid />
        <OrderFlowSection />
        <MultiWindowSection />
        <NewsSection />
        <DataSourcesSection />
        <PricingTeaser />
        <ClosingCTA />
      </main>
      <SiteFooter />
    </div>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-40 top-0 h-[480px] w-[640px] rounded-full bg-accent/20 blur-[120px]" />
        <div className="absolute -right-40 top-40 h-[420px] w-[520px] rounded-full bg-bull/15 blur-[120px]" />
      </div>
      <div className="container grid items-center gap-12 py-20 lg:grid-cols-[1.05fr_1fr] lg:py-28">
        <div>
          <Badge tone="accent" className="mb-5">
            <Sparkles className="mr-1 h-3 w-3" /> Order-flow terminal · v0.1
          </Badge>
          <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl lg:text-[56px] lg:leading-[1.05]">
            See <span className="gradient-text">price, liquidity, and order flow</span> in one live chart.
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground">
            SuperCharts is a browser-based charting terminal for serious crypto and forex traders. Volume profile, footprint candles, deep-trade bubbles, and liquidity heatmap — rendered on a Canvas/WebGL engine built for tick-level data.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/terminal">
              <Button size="lg" className="px-6">
                Launch terminal
              </Button>
            </Link>
            <Link href="/pricing">
              <Button size="lg" variant="outline">
                See pricing
              </Button>
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <span className="dot-pulse bg-bull" /> Binance live (no key required)
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-warn" /> OANDA forex ready (add token)
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-accent" /> 1s → 1Y intervals
            </span>
          </div>
        </div>
        <HeroChartPreview />
      </div>
    </section>
  );
}

function HeroChartPreview() {
  return (
    <div className="relative">
      <div className="glass-panel relative overflow-hidden p-1.5">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="dot-pulse bg-bull" />
            <span className="font-semibold tracking-[0.2em] text-foreground">BTC / USDT · 5m</span>
          </div>
          <div className="flex items-center gap-3">
            <span>LAST 67,184.21</span>
            <span className="text-bull">+1.24%</span>
          </div>
        </div>
        <div className="grid grid-cols-[1fr_180px]">
          <div className="relative h-[320px] overflow-hidden">
            <FakeCandles />
            <FakeHeatmap />
            <FakeBubbles />
          </div>
          <div className="border-l border-border/60 bg-surface-sunken/40 p-3 text-[11px]">
            <div className="mb-2 uppercase tracking-[0.14em] text-muted-foreground">Vol profile</div>
            <FakeProfile />
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute -bottom-3 left-1/2 hidden h-2 w-3/4 -translate-x-1/2 rounded-full bg-accent/30 blur-md md:block" />
    </div>
  );
}

function FakeCandles() {
  // 60 deterministic candles built from a sine for nice composition.
  const candles = Array.from({ length: 60 }, (_, i) => {
    const t = i / 60;
    const trend = 60 + Math.sin(t * Math.PI * 2) * 30 + Math.sin(t * Math.PI * 7) * 8;
    const open = trend + (i % 2 === 0 ? -2 : 1.5);
    const close = trend + (i % 3 === 0 ? -3 : 2.2);
    const high = Math.max(open, close) + Math.random() * 3;
    const low = Math.min(open, close) - Math.random() * 3;
    return { open, close, high, low };
  });
  const w = 100 / candles.length;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
      {candles.map((k, i) => {
        const x = i * w + w / 2;
        const up = k.close >= k.open;
        const yH = 100 - k.high;
        const yL = 100 - k.low;
        const yO = 100 - k.open;
        const yC = 100 - k.close;
        return (
          <g key={i}>
            <line x1={x} y1={yH} x2={x} y2={yL} stroke="hsl(var(--muted-fg) / 0.5)" strokeWidth={0.3} />
            <rect
              x={i * w + 0.4}
              y={Math.min(yO, yC)}
              width={w - 0.8}
              height={Math.max(Math.abs(yC - yO), 0.6)}
              fill={up ? 'hsl(var(--bull))' : 'hsl(var(--bear))'}
              opacity={0.9}
            />
          </g>
        );
      })}
    </svg>
  );
}

function FakeHeatmap() {
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full opacity-40">
      {Array.from({ length: 80 }).map((_, i) => {
        const x = (i % 40) * 2.5;
        const y = 8 + (i % 18) * 5;
        const intensity = Math.random();
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={2.5}
            height={1.6}
            fill={i % 2 ? `rgba(76, 200, 180, ${intensity * 0.7})` : `rgba(239, 83, 80, ${intensity * 0.55})`}
          />
        );
      })}
    </svg>
  );
}

function FakeBubbles() {
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
      {[15, 30, 38, 55, 70, 84].map((cx, i) => (
        <circle
          key={cx}
          cx={cx}
          cy={30 + ((i * 11) % 50)}
          r={1.4 + (i % 3) * 0.6}
          fill={i % 2 ? 'rgba(38,166,154,0.9)' : 'rgba(239,83,80,0.9)'}
          stroke="rgba(255,255,255,0.25)"
          strokeWidth={0.2}
        />
      ))}
    </svg>
  );
}

function FakeProfile() {
  const rows = Array.from({ length: 18 }, (_, i) => ({
    price: 67_300 - i * 50,
    width: 12 + Math.abs(Math.sin(i * 1.2)) * 70,
    isPOC: i === 9,
  }));
  return (
    <div className="space-y-[3px]">
      {rows.map((r) => (
        <div key={r.price} className="flex items-center gap-2">
          <span className="w-12 text-[10px] tabular-nums text-muted-foreground">{r.price}</span>
          <div className="relative h-2 flex-1 rounded-sm bg-surface-raised">
            <div
              className={`absolute inset-y-0 left-0 rounded-sm ${
                r.isPOC ? 'bg-warn' : 'bg-accent/70'
              }`}
              style={{ width: `${r.width}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function SocialProof() {
  return (
    <section className="border-b border-border bg-surface-sunken/30">
      <div className="container flex flex-wrap items-center justify-center gap-x-10 gap-y-4 py-5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        <span>Built for tick data</span>
        <span className="text-border">·</span>
        <span>Canvas + WebGL rendering</span>
        <span className="text-border">·</span>
        <span>Sub-100ms reactive</span>
        <span className="text-border">·</span>
        <span>Honest data labels</span>
        <span className="text-border">·</span>
        <span>Dark + light terminal modes</span>
      </div>
    </section>
  );
}

function FeatureGrid() {
  const features: Array<{ icon: React.ReactNode; title: string; body: string; tone?: 'accent' | 'bull' | 'bear' | 'warn' }> = [
    {
      icon: <CandlestickChart className="h-5 w-5" />,
      title: 'Every chart type',
      body: 'Candlestick, bar, line, area, baseline, hollow, Heikin Ashi, Renko, range bars, tick bars, volume bars, dollar bars, footprint, delta candles, CVD.',
      tone: 'accent',
    },
    {
      icon: <GanttChartSquare className="h-5 w-5" />,
      title: 'Volume profile suite',
      body: 'Visible range, session, fixed range, anchored, composite. POC, VAH/VAL, HVN/LVN, buy/sell split, delta profile.',
    },
    {
      icon: <Layers className="h-5 w-5" />,
      title: 'Footprint candles',
      body: 'Bid × Ask ladders inside each bar. Imbalance, stacked imbalance, absorption markers. Auto-collapse when zoomed out.',
    },
    {
      icon: <Flame className="h-5 w-5" />,
      title: 'Liquidity heatmap',
      body: 'See resting bids and asks before price reaches them. Added, pulled, and executed liquidity rendered with WebGL-ready intensity scales.',
      tone: 'warn',
    },
    {
      icon: <Activity className="h-5 w-5" />,
      title: 'Deep-trade bubbles',
      body: 'Filter the noise. Show only large prints, sized by notional with percentile / z-score thresholds and absorption context.',
      tone: 'bull',
    },
    {
      icon: <Waves className="h-5 w-5" />,
      title: 'Drawing arsenal',
      body: 'Trendlines, channels, fib, gann, pitchfork, ruler, R/R long-short, tables, emojis, callouts, anchored VWAP. Persisted per layout and symbol.',
    },
    {
      icon: <LineChart className="h-5 w-5" />,
      title: 'Tick to 1-year range',
      body: 'Aggregation pyramid serves whatever depth you need without loading a year of ticks into the browser.',
    },
    {
      icon: <Boxes className="h-5 w-5" />,
      title: '4 / 8 / 16 window grid',
      body: 'Multi-pane layouts with synced crosshair, symbol, and timeframe. Save and restore your terminal configurations.',
    },
    {
      icon: <Newspaper className="h-5 w-5" />,
      title: 'News in context',
      body: 'GDELT macro, CryptoPanic crypto, Finnhub equities. News markers on the chart, filtered by symbol or topic.',
    },
    {
      icon: <Gauge className="h-5 w-5" />,
      title: 'Live scanner',
      body: 'Top movers, volume spikes, large prints. One click to load any scanner result in any pane.',
    },
    {
      icon: <ShieldCheck className="h-5 w-5" />,
      title: 'Honest data labels',
      body: 'Spot forex is decentralized — we never fake centralized exchange volume. Every overlay carries an honest provider tag.',
      tone: 'bear',
    },
    {
      icon: <Database className="h-5 w-5" />,
      title: 'Built to scale',
      body: 'Shared provider sockets, Redis fanout-ready, ClickHouse tick storage, Postgres for app data. Single-process dev → multi-service prod.',
    },
  ];

  return (
    <section id="features" className="border-b border-border">
      <div className="container py-20">
        <SectionHeading
          eyebrow="What's inside"
          title="A terminal you'd actually charge for."
          description="Everything a discretionary order-flow trader expects, rendered fast enough to keep up with live ticks."
        />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="group relative rounded-xl border border-border bg-surface/70 p-5 transition-colors hover:border-accent/40 hover:bg-surface"
            >
              <div className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface-sunken text-accent">
                {f.icon}
              </div>
              <h3 className="text-sm font-semibold text-foreground">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function OrderFlowSection() {
  return (
    <section id="orderflow" className="border-b border-border bg-surface-sunken/30">
      <div className="container grid items-center gap-10 py-20 lg:grid-cols-2">
        <div>
          <SectionHeading
            eyebrow="Order flow, decoded"
            title="Read the auction, not just the chart."
            description="Footprint, profile, and heatmap render onto the same time axis so context is never one screen away."
            align="left"
          />
          <ul className="mt-8 space-y-3 text-sm text-muted-foreground">
            <ListPoint icon={<Flame className="h-4 w-4 text-warn" />} title="Liquidity walls before they break">
              Watch the heatmap thicken at a level. Watch it pull. Watch price react.
            </ListPoint>
            <ListPoint icon={<Activity className="h-4 w-4 text-bull" />} title="Absorption you can actually see">
              Large sells into a low that fails to break → marked automatically with a ring.
            </ListPoint>
            <ListPoint icon={<GanttChartSquare className="h-4 w-4 text-accent" />} title="Profile that updates with your zoom">
              Visible range profile recomputes the moment you pan. POC, VAH/VAL labeled on the price axis.
            </ListPoint>
          </ul>
        </div>
        <HeroChartPreview />
      </div>
    </section>
  );
}

function MultiWindowSection() {
  return (
    <section className="border-b border-border">
      <div className="container py-20">
        <SectionHeading
          eyebrow="Multi-window grid"
          title="Watch the whole book without alt-tab."
          description="Run 1, 4, 8, or 16 panes side by side. Symbol, timeframe, and crosshair stay in sync where you want them."
        />
        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          <GridPreview cells={1} label="Single pane" />
          <GridPreview cells={4} label="4 panes — quad watch" />
          <GridPreview cells={8} label="8 panes — desk view" />
          <GridPreview cells={16} label="16 panes — institutional wall" />
          <GridPreview cells={4} label="Sector grid" variant="sector" />
          <GridPreview cells={2} label="Compare crypto + forex" variant="compare" />
        </div>
      </div>
    </section>
  );
}

function GridPreview({ cells, label, variant }: { cells: number; label: string; variant?: 'sector' | 'compare' }) {
  const cols = cells === 1 ? 1 : cells === 2 ? 2 : cells === 4 ? 2 : 4;
  return (
    <div className="glass-panel overflow-hidden p-3">
      <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
        <span>{label}</span>
        <span>{cells} × pane</span>
      </div>
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: cells }).map((_, i) => (
          <div key={i} className="relative aspect-[16/9] overflow-hidden rounded-md border border-border bg-surface-sunken/70">
            <svg viewBox="0 0 100 60" className="h-full w-full">
              <polyline
                fill="none"
                stroke={i % 2 === 0 ? 'hsl(var(--bull))' : 'hsl(var(--bear))'}
                strokeWidth={1}
                points={Array.from({ length: 20 }, (_, j) => {
                  const x = (j / 19) * 100;
                  const y = 30 + Math.sin((i + 1) * 0.6 + j * 0.8) * 12;
                  return `${x},${y}`;
                }).join(' ')}
              />
            </svg>
            <span className="absolute left-2 top-1.5 text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
              {variant === 'sector'
                ? ['ETH/USDT', 'SOL/USDT', 'EUR/USD', 'XAU/USD'][i] ?? '—'
                : variant === 'compare'
                  ? ['BTC/USDT', 'DXY'][i] ?? '—'
                  : ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'EUR/USD', 'GBP/USD', 'USD/JPY', 'XAU', 'SPX', 'NDX', 'OIL', 'COPPER', 'BTC.D', 'TOTAL2'][i] ?? '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NewsSection() {
  return (
    <section className="border-b border-border bg-surface-sunken/30">
      <div className="container grid items-center gap-10 py-20 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <SectionHeading
            eyebrow="News that moves price"
            title="Macro and crypto headlines pinned to your chart."
            description="GDELT + CryptoPanic + Finnhub feed into a single normalized stream with sentiment, source, and time markers on the chart."
            align="left"
          />
          <div className="mt-8 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge tone="accent">GDELT macro</Badge>
            <Badge tone="bull">CryptoPanic</Badge>
            <Badge tone="warn">Finnhub equities</Badge>
            <Badge tone="muted">Optional: NewsAPI</Badge>
          </div>
        </div>
        <div className="glass-panel divide-y divide-border/60">
          {[
            ['Fed minutes signal sticky inflation', 'GDELT · 3m ago', 'bear'],
            ['Bitcoin breaks $67k as ETF flows accelerate', 'CryptoPanic · 14m ago', 'bull'],
            ['ECB holds rates, hints at June cut', 'GDELT · 32m ago', 'warn'],
            ['Solana DEX volume hits new ATH', 'CryptoPanic · 1h ago', 'bull'],
            ['Oil dips on demand concerns', 'GDELT · 2h ago', 'bear'],
          ].map(([title, meta, tone]) => (
            <div key={title} className="flex items-start gap-3 p-4">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                tone === 'bull' ? 'bg-bull' : tone === 'bear' ? 'bg-bear' : 'bg-warn'
              }`} />
              <div>
                <div className="text-sm font-medium text-foreground">{title}</div>
                <div className="text-xs text-muted-foreground">{meta}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DataSourcesSection() {
  return (
    <section className="border-b border-border">
      <div className="container py-20">
        <SectionHeading
          eyebrow="Data adapters"
          title="Bring your own keys, or start with what's free."
          description="Modular provider system. Binance public data needs no key. Everything else is optional — and labeled honestly when absent."
        />
        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { name: 'Binance', status: 'Live', tone: 'bull', detail: 'Public WS · trades · klines · L20 depth' },
            { name: 'OANDA', status: 'Optional', tone: 'warn', detail: 'Forex bid/ask · token required' },
            { name: 'CryptoPanic', status: 'Optional', tone: 'warn', detail: 'Crypto headlines · API key' },
            { name: 'GDELT', status: 'Live', tone: 'bull', detail: 'Macro news · no key required' },
            { name: 'CoinGecko', status: 'Optional', tone: 'muted', detail: 'Metadata · free tier ok' },
            { name: 'Finnhub', status: 'Optional', tone: 'muted', detail: 'News + equities · API key' },
            { name: 'Twelve Data', status: 'Optional', tone: 'muted', detail: 'Forex / equities fallback' },
            { name: 'Polygon', status: 'Planned', tone: 'muted', detail: 'Production-grade · pro tier' },
          ].map((p) => (
            <div key={p.name} className="rounded-xl border border-border bg-surface/70 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{p.name}</span>
                <Badge tone={p.tone as 'bull' | 'warn' | 'muted'}>{p.status}</Badge>
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{p.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PricingTeaser() {
  return (
    <section className="border-b border-border bg-surface-sunken/40">
      <div className="container py-20">
        <SectionHeading
          eyebrow="Pricing"
          title="Two plans. Every feature. No usage tiers."
          description="No 'starter' lock-outs, no per-symbol fees. Pay for the period you want."
        />
        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          <PricingCard plan="Pro 6M" price="$400" interval="6 months" perks={[
            'Live crypto + forex',
            'Volume profile + footprint',
            'Liquidity heatmap',
            'Deep-trade bubbles',
            'Unlimited drawings & layouts',
            '4 / 8 / 16 window grid',
            'News + alerts + replay',
          ]} />
          <PricingCard plan="Pro Annual" price="$600" interval="12 months" highlighted perks={[
            'Everything in Pro 6M',
            'Best value vs. 6M',
            'Priority data routing',
            'Extended historical depth',
            'Early access to new features',
            'Priority support',
          ]} />
        </div>
        <div className="mt-6 text-center text-xs text-muted-foreground">
          Pricing engine is Stripe-ready. Without Stripe keys, checkout returns a transparent setup state.
        </div>
      </div>
    </section>
  );
}

function PricingCard({
  plan,
  price,
  interval,
  perks,
  highlighted = false,
}: {
  plan: string;
  price: string;
  interval: string;
  perks: string[];
  highlighted?: boolean;
}) {
  return (
    <div
      className={`relative rounded-2xl border p-7 ${
        highlighted
          ? 'border-accent/50 bg-accent/5 shadow-floating'
          : 'border-border bg-surface/70'
      }`}
    >
      {highlighted ? (
        <span className="absolute -top-2 left-7 rounded-full border border-accent/40 bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">
          Best value
        </span>
      ) : null}
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{plan}</span>
        <span className="text-sm text-muted-foreground">/ {interval}</span>
      </div>
      <div className="mt-3 text-4xl font-semibold tracking-tight">{price}</div>
      <ul className="mt-5 space-y-2 text-sm text-muted-foreground">
        {perks.map((p) => (
          <li key={p} className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-bull" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
      <Link href="/pricing" className="mt-7 block">
        <Button variant={highlighted ? 'primary' : 'outline'} className="w-full">
          Choose {plan}
        </Button>
      </Link>
    </div>
  );
}

function ClosingCTA() {
  return (
    <section className="border-b border-border">
      <div className="container py-20 text-center">
        <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Open the terminal. Watch order flow happen.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
          No signup required to try the demo. Live Binance BTC/USDT loads in the background as the page mounts.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/terminal">
            <Button size="lg">Launch demo terminal</Button>
          </Link>
          <Link href="/pricing">
            <Button size="lg" variant="outline">
              See pricing
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  align = 'center',
}: {
  eyebrow: string;
  title: string;
  description: string;
  align?: 'center' | 'left';
}) {
  return (
    <div className={align === 'center' ? 'mx-auto max-w-2xl text-center' : 'max-w-xl'}>
      <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-sunken px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {eyebrow}
      </span>
      <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-[40px] sm:leading-[1.1]">
        {title}
      </h2>
      <p className="mt-3 text-base text-muted-foreground">{description}</p>
    </div>
  );
}

function ListPoint({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 rounded-lg border border-border/70 bg-surface/60 p-3">
      <span className="mt-0.5">{icon}</span>
      <div>
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}
