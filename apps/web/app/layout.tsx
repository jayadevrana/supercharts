import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/toaster';

export const metadata: Metadata = {
  title: 'SuperCharts — Institutional charting for crypto & forex',
  description:
    'Live tick data, volume profile, footprint candles, deep-trade bubbles, and liquidity heatmap in one premium browser-based terminal.',
  applicationName: 'SuperCharts',
  authors: [{ name: 'SuperCharts' }],
  metadataBase: new URL('http://localhost:3000'),
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <ThemeProvider>{children}</ThemeProvider>
        <Toaster />
      </body>
    </html>
  );
}
