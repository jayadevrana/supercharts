import Link from 'next/link';
import { BrandMark } from './brand-mark';

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface-sunken/40">
      <div className="container grid gap-8 py-12 md:grid-cols-4">
        <div className="md:col-span-2">
          <BrandMark />
          <p className="mt-3 max-w-sm text-sm text-muted-foreground">
            SuperCharts is an institutional-grade charting terminal for crypto and forex traders. Live order flow, volume profile, footprint candles, and liquidity heatmap — in your browser.
          </p>
          <p className="mt-4 text-xs text-muted-foreground/80">
            Charts shown in screenshots are illustrative. Live data quality depends on the configured provider and is labeled accordingly inside the terminal.
          </p>
        </div>
        <FooterColumn
          title="Product"
          links={[
            ['Terminal', '/terminal'],
            ['Pricing', '/pricing'],
            ['Provider status', '/admin/health'],
          ]}
        />
        <FooterColumn
          title="Legal"
          links={[
            ['Terms', '/legal/terms'],
            ['Privacy', '/legal/privacy'],
            ['Risk disclaimer', '/legal/disclaimer'],
          ]}
        />
      </div>
      <div className="border-t border-border/60">
        <div className="container flex flex-col items-start justify-between gap-2 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <span>© {new Date().getFullYear()} SuperCharts. Not financial advice.</span>
          <span>Live market data is provided by configured third-party APIs. Latency, depth, and volume semantics vary by provider.</span>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: Array<[string, string]> }) {
  return (
    <div>
      <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
        {title}
      </h4>
      <ul className="space-y-2 text-sm text-muted-foreground">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link href={href} className="hover:text-foreground">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
