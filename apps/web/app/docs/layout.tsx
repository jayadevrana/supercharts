import type { Metadata } from 'next';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { DocsSidebar } from '@/components/docs/docs-sidebar';

export const metadata: Metadata = {
  title: { template: '%s · PulseScript Docs — SuperCharts', default: 'PulseScript Docs — SuperCharts' },
  description:
    'PulseScript is SuperCharts’ original chart-scripting language: write a study, backtest it on real candles, and turn it into a live Telegram alert — all in the browser.',
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-8 px-4 py-8">
        <aside className="hidden w-52 shrink-0 md:block">
          <div className="sticky top-20">
            <DocsSidebar />
          </div>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      <SiteFooter />
    </div>
  );
}
