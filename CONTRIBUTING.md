# Contributing

Thanks for taking a look at SuperCharts. This codebase is product-oriented and trading-adjacent, so changes need to be careful, traceable, and honest about data.

## Local Setup

```bash
pnpm install
cp .env.example .env
cp .env.example apps/web/.env.local
pnpm -F @supercharts/api dev
pnpm -F @supercharts/web dev
```

## Expectations

- Keep changes scoped and explain the trading/product impact.
- Do not fabricate market data or mock live provider responses as if they were real.
- Do not commit `.env`, local SQLite databases, screenshots with private account data, or provider credentials.
- Reuse `@supercharts/indicators` for indicator math instead of duplicating formulas in app code.
- Add focused tests for pure math, parsing, strategy, and API utilities.

## Useful Checks

```bash
pnpm typecheck
pnpm test
pnpm --filter @supercharts/web build
```

If a check cannot run locally, document why in the PR.
