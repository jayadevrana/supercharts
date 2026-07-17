import type { Metadata, Viewport } from 'next';
import { Barlow_Semi_Condensed, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/toaster';
import { SessionProvider } from '@/lib/auth';

const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://supercharting.com').replace(/\/$/, '');
const TITLE = 'SuperCharts — Institutional charting for crypto & forex';
const DESCRIPTION =
  'Live tick data, volume profile, footprint candles, deep-trade bubbles, and liquidity heatmap in one premium browser-based terminal — plus PulseScript, its own chart-scripting language, backtesting, a market scanner, and Telegram alerts.';

export const metadata: Metadata = {
  title: { default: TITLE, template: '%s · SuperCharts' },
  description: DESCRIPTION,
  applicationName: 'SuperCharts',
  authors: [{ name: 'SuperCharts' }],
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: '/' },
  keywords: [
    'TradingView alternative',
    'crypto charting',
    'forex charting',
    'order flow',
    'footprint charts',
    'volume profile',
    'liquidity heatmap',
    'PulseScript',
    'Pine Script alternative',
    'trading terminal',
    'MT5 automation',
  ],
  openGraph: {
    type: 'website',
    siteName: 'SuperCharts',
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: '#0a0c10',
  width: 'device-width',
  initialScale: 1,
};

// Design-pack fonts (lib/designs.ts). Loaded once; each design picks via --font-sans.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const barlow = Barlow_Semi_Condensed({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-condensed',
  display: 'swap',
});
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono-ui', display: 'swap' });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${barlow.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider>
          <SessionProvider>{children}</SessionProvider>
        </ThemeProvider>
        <Toaster />
      </body>
    </html>
  );
}
