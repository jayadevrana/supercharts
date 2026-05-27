import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="container max-w-3xl py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Privacy policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: 2026-05-26</p>
        <div className="mt-8 space-y-4 text-sm text-muted-foreground">
          <p>
            SuperCharts collects the minimum data required to operate the service: email and display name for accounts, encrypted provider credentials when you connect a data provider, and your saved drawings, layouts, watchlists, and alerts.
          </p>
          <h2 className="mt-6 text-base font-semibold text-foreground">What we never sell</h2>
          <p>Trading activity. Drawing content. Browsing history within the terminal. Provider credentials.</p>
          <h2 className="mt-6 text-base font-semibold text-foreground">What we may share</h2>
          <p>
            Service providers strictly required to run the platform: Stripe for billing, our hosting provider, and email delivery (transactional only). Provider API keys are encrypted at rest and never leave the server.
          </p>
          <p className="mt-6 italic">Placeholder copy. Replace with reviewed legal text before commercial launch.</p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
