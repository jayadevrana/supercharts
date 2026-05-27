# SuperCharts

Institutional-grade web charting terminal for crypto and forex. Live tick data, multi-window grid (1/4/8/16 panes), volume profile, footprint candles, deep-trade bubbles, liquidity heatmap, drawing tools, news, and replay.

> SuperCharts is an original product. It is inspired by professional charting terminals but does not copy any other vendor's branding, icons, or proprietary UI.

## Workspace

```
supercharts/
├── apps/
│   ├── web/         Next.js App Router frontend
│   ├── api/         Fastify REST + WebSocket gateway
│   └── ingestion/   Provider WebSocket consumers, normalizers, aggregators
├── packages/
│   ├── types/         Shared domain types
│   ├── market-data/   Provider adapter interface + implementations
│   ├── chart-core/    Canvas/WebGL chart engine
│   ├── indicators/    Pure indicator calculation functions
│   ├── ui/            Shared React primitives
│   └── config/        Shared TS/lint/prettier config
├── infra/             Docker Compose, ClickHouse/Postgres/Redis init
└── docs/              Architecture, API, data model, provider notes
```

## Requirements

- Node ≥ 20 (verified on v22+)
- pnpm ≥ 9
- Docker (optional — falls back to SQLite + in-memory if missing)

## Quick start

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Open http://localhost:3000

## Data sources

Live by default (no key required):

- Binance public market data — trades, klines, depth.
- GDELT — global macro news.

Optional, requires keys:

- OANDA — forex bid/ask quotes and candles.
- Twelve Data, Finnhub, Polygon — fallback market data.
- CryptoPanic — crypto news.
- CoinGecko — token metadata.

Missing keys do not crash the app. Adapters report `not_configured` health status and the UI surfaces a setup state for the affected feature.

## Forex data honesty

Spot forex is decentralized. SuperCharts does not invent centralized exchange volume or order-book heatmaps for forex when the provider does not supply them. Volume labels reflect what the provider actually reports (tick volume vs. real volume vs. broker liquidity).

## Pricing

- Pro 6M — $400
- Pro Annual — $600

Subscription gating uses Stripe. Without Stripe keys, the pricing page renders in setup mode and the billing endpoints return `not_configured`.

## License

Proprietary. All rights reserved.
