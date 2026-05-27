import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

export default function TermsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="container max-w-3xl py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Terms of service</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: 2026-05-26</p>
        <div className="mt-8 space-y-4 text-sm text-muted-foreground">
          <p>
            These terms govern your use of SuperCharts ("the service"). By accessing or using the service you agree to be bound by these terms.
          </p>
          <h2 className="mt-6 text-base font-semibold text-foreground">1. Service</h2>
          <p>
            SuperCharts provides a browser-based charting platform that aggregates market data and news from configured third-party providers. The service is provided as-is, without warranty of any kind.
          </p>
          <h2 className="mt-6 text-base font-semibold text-foreground">2. Accounts &amp; subscriptions</h2>
          <p>
            Paid plans are billed via Stripe. Subscription periods are 6 months ($400) or 12 months ($600), charged once per period.
          </p>
          <h2 className="mt-6 text-base font-semibold text-foreground">3. Acceptable use</h2>
          <p>
            You agree not to redistribute or resell market data obtained through the service except as permitted by the upstream provider's terms.
          </p>
          <h2 className="mt-6 text-base font-semibold text-foreground">4. Liability</h2>
          <p>
            SuperCharts is not liable for trading losses, missed trades, data outages, or any consequential damages arising from use of the service.
          </p>
          <p className="mt-6 italic">
            This is placeholder copy. Replace with reviewed legal text before commercial launch.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
