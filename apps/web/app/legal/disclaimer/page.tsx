import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

export default function DisclaimerPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="container max-w-3xl py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Risk disclaimer</h1>
        <div className="prose prose-invert mt-8 space-y-4 text-sm text-muted-foreground">
          <p>
            SuperCharts is a charting and analysis tool. It is not investment advice, not a broker, and not a financial adviser. Nothing displayed on this site or inside the terminal constitutes a recommendation to buy, sell, or hold any financial instrument.
          </p>
          <p>
            Trading and investing in crypto, forex, and other financial instruments carries substantial risk of loss and is not suitable for every investor. Past performance does not guarantee future results.
          </p>
          <p>
            Market data displayed inside SuperCharts is sourced from third-party providers (Binance, OANDA, Polygon, Twelve Data, Finnhub, GDELT, CryptoPanic, CoinGecko, and others as configured). Latency, depth, and accuracy depend on the provider. SuperCharts labels data quality (real / tick / broker / synthetic) inside the terminal but cannot guarantee provider uptime or correctness.
          </p>
          <p>
            Spot forex is a decentralized market. Volume and order-book depth for forex pairs reflect broker-derived liquidity or tick volume, not centralized exchange volume.
          </p>
          <p>
            By using SuperCharts you agree to the terms of service and acknowledge this risk disclaimer.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
