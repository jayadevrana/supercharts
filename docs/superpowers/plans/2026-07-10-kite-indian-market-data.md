# Kite Indian Market Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every active Kite Indian-market instrument searchable in the terminal and load its real historical and live chart data without adding any trading capability.

**Architecture:** A server-only `KiteProvider` owns the read-only Kite REST/WebSocket protocol and an in-memory active-instrument catalog refreshed from Kite's daily CSV. Ingestion registers the provider only when an API key and access token are configured; existing market routes resolve `KITE:` symbols to it. The existing terminal symbol search consumes the API's richer symbol metadata and sends selections to the unchanged chart pipeline.

**Tech Stack:** TypeScript, Fastify, React 19, Vitest, Node `fetch`, `ws`, existing SuperCharts market-data and ingestion interfaces.

## Global Constraints

- Only Kite read-only endpoints and the market-data WebSocket are allowed; no order, GTT, portfolio, holdings, margins, positions, or other mutation API is imported, exposed, or called.
- Credentials/tokens must only be read from gitignored environment variables; no secret is logged or committed.
- Official login remains external/user-controlled. This task accepts a fresh `KITE_ACCESS_TOKEN`; it does not automate username/password/TOTP login.
- Active Kite catalog means NSE, BSE, NFO, MCX, CDS, and index records present in the current Kite instrument CSV. Expired contracts remain unavailable unless their historical token is already known.
- Historical support is one year on demand. Daily data is available for every catalog result; 1-minute data is fetched on demand and higher supported intraday intervals are fetched directly when Kite supports them.
- The provider may subscribe to at most 3,000 tokens per WebSocket connection and must reject excess subscriptions honestly.
- Existing providers, alerts, Telegram, MT5, scanner, and static catalog behavior must not regress.

---

### Task 1: Read-only Kite provider and catalog parser

**Files:**
- Modify: `packages/types/src/provider.ts`
- Modify: `packages/market-data/src/index.ts`
- Create: `packages/market-data/src/providers/kite.ts`
- Test: `tests/kite-provider.test.ts`

**Interfaces:**
- Produces `KiteProvider`, `KiteProviderOptions`, `KiteInstrument`, `parseKiteInstrumentsCsv`, and `KITE_ALLOWED_PATHS`.
- `KiteProvider` implements `MarketDataProvider` with id `kite`, canonical symbols `KITE:<exchange>:<tradingsymbol>`, and only read-only REST/WebSocket requests.

- [ ] **Step 1: Write failing parser and request-boundary tests**

```ts
it('maps every active CSV record to an exchange-qualified KITE symbol', () => {
  const catalog = parseKiteInstrumentsCsv(CSV);
  expect(catalog.map((x) => x.id)).toEqual(['KITE:NSE:INFY', 'KITE:NFO:NIFTY26JULFUT']);
});

it('rejects non-market-data Kite paths before a request is issued', async () => {
  const fetchFn = vi.fn();
  expect(() => assertKiteReadOnlyPath('/orders/regular')).toThrow('not allowed');
  expect(fetchFn).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused test and verify red**

Run: `pnpm vitest run tests/kite-provider.test.ts`

Expected: FAIL because `kite.ts` does not exist.

- [ ] **Step 3: Add provider identity and catalog types**

Add `'kite'` to `ProviderId`, export `KiteProvider` from the market-data barrel, and implement exact CSV headers from Kite's instrument dump. Ignore malformed rows; retain exchange, segment, expiry, strike, tick/lot sizes, and instrument type. Map EQ to `stock`, FUT to `futures`, CE/PE to `options`, MCX to `commodity`, and index records to `index`.

- [ ] **Step 4: Implement GET-only historical data and live packets**

Use `GET /instruments` and `GET /instruments/historical/:token/:interval` only. Parse candle timestamps as UTC milliseconds and preserve actual OHLCV/OI values. For live data, connect to `wss://ws.kite.trade?api_key=...&access_token=...`, subscribe in `quote` mode, parse binary frames using the Kite packet lengths, and ignore every text `order` postback. Enforce `MAX_SUBSCRIPTIONS_PER_CONNECTION = 3000` before sending any subscription.

- [ ] **Step 5: Run focused green verification**

Run: `pnpm vitest run tests/kite-provider.test.ts && pnpm -F @supercharts/market-data typecheck`

Expected: PASS with parser, path allowlist, search, historical request, quote packet, and capacity tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/provider.ts packages/market-data/src/index.ts packages/market-data/src/providers/kite.ts tests/kite-provider.test.ts
git commit -m "feat(data): add read-only Kite provider"
```

### Task 2: Register Kite in ingestion and serve search/chart requests

**Files:**
- Modify: `apps/ingestion/src/main.ts`
- Modify: `apps/ingestion/src/subscription-manager.ts`
- Modify: `apps/api/src/routes/market.ts`
- Modify: `.env.example`
- Test: `tests/kite-market-routes.test.ts`

**Interfaces:**
- Consumes `KiteProvider` and optional `KITE_API_KEY`, `KITE_ACCESS_TOKEN`.
- Produces `ctx.providers.kite` and routes that resolve `KITE:<exchange>:<tradingsymbol>` through the normal `/api/symbols/search`, `/api/symbols/:symbolId`, `/api/candles`, and provider-health paths.

- [ ] **Step 1: Write failing integration tests**

```ts
it('returns Kite catalog hits through the standard symbol search route', async () => {
  const res = await app.inject('/api/symbols/search?q=infy');
  expect(res.json().items[0]).toMatchObject({ id: 'KITE:NSE:INFY', provider: 'kite' });
});

it('loads a KITE chart through the standard candle route without calling trading endpoints', async () => {
  const res = await app.inject('/api/candles?symbol=KITE:NSE:INFY&interval=1d');
  expect(res.statusCode).toBe(200);
  expect(res.json().candles).toHaveLength(2);
});
```

- [ ] **Step 2: Run focused test and verify red**

Run: `pnpm vitest run tests/kite-market-routes.test.ts`

Expected: FAIL because ingestion has no Kite provider.

- [ ] **Step 3: Add optional, safe bootstrap wiring**

Instantiate `KiteProvider` only when both `KITE_API_KEY` and `KITE_ACCESS_TOKEN` are non-empty. Otherwise expose a `not_configured` provider health record without blocking API startup. Call `refreshInstruments()` on configured startup and retain the last successful catalog on refresh failures. Add `kite` to ingestion context and subscription-manager venue resolution.

- [ ] **Step 4: Extend market route resolution**

Resolve only the `KITE` venue prefix to `ctx.providers.kite`; retain the existing providers untouched. Ensure `/api/candles` reports the provider error without leaking an access token. Raise the existing candle limit to allow one year of 1-minute data only when a caller explicitly requests it, otherwise preserve current defaults.

- [ ] **Step 5: Document secret-safe configuration**

Add empty `KITE_API_KEY=` and `KITE_ACCESS_TOKEN=` entries plus comments explaining that the token is produced by official interactive login and expires daily. Do not add user ID, password, TOTP, or API secret variables.

- [ ] **Step 6: Run focused green verification**

Run: `pnpm vitest run tests/kite-market-routes.test.ts && pnpm -F @supercharts/ingestion typecheck && pnpm -F @supercharts/api typecheck`

Expected: PASS; unconfigured startup remains healthy, configured fake provider search/candles work, and endpoint allowlisting is exercised.

- [ ] **Step 7: Commit**

```bash
git add apps/ingestion/src/main.ts apps/ingestion/src/subscription-manager.ts apps/api/src/routes/market.ts .env.example tests/kite-market-routes.test.ts
git commit -m "feat(data): serve Kite instruments and candles"
```

### Task 3: Make active Indian instruments searchable and openable in the terminal

**Files:**
- Modify: `apps/web/features/terminal/terminal-top-bar.tsx`
- Test: `tests/symbol-search.test.ts`

**Interfaces:**
- Consumes standard `/api/symbols/search` items with `id`, `assetClass`, `venue`, `rawSymbol`, and optional expiry metadata.
- Produces terminal search rows that render a provider/exchange-aware label and call the unchanged `setPaneSymbol` path.

- [ ] **Step 1: Write failing UI utility tests**

```ts
it('labels a Kite result with exchange and derivative details', () => {
  expect(symbolResultLabel(kiteFuture)).toBe('NIFTY26JULFUT · NFO · FUT');
});

it('keeps a KITE selection canonical when opening a chart', () => {
  expect(symbolResultId(kiteEquity)).toBe('KITE:NSE:INFY');
});
```

- [ ] **Step 2: Run focused test and verify red**

Run: `pnpm vitest run tests/symbol-search.test.ts`

Expected: FAIL because the presentation helpers do not exist.

- [ ] **Step 3: Implement rich remote results without changing static fallback**

Replace the current remote `{ id, kind }` projection with a typed result carrying the standard API metadata. Add pure label/id helpers near `SymbolSearch`; retain curated static results for empty queries. When a user searches `INFY`, `NIFTY`, or a derivative trading symbol, render `KITE` plus its exchange/segment and send the canonical id to `onPick`.

- [ ] **Step 4: Add honest provider state**

If the API returns no Kite records because Kite is not configured, show the existing no-results surface with `Connect Kite data in the server environment` instead of displaying fake Indian symbols.

- [ ] **Step 5: Run focused green verification**

Run: `pnpm vitest run tests/symbol-search.test.ts && pnpm -F @supercharts/web typecheck`

Expected: PASS; existing crypto/forex labels retain their current output.

- [ ] **Step 6: Commit**

```bash
git add apps/web/features/terminal/terminal-top-bar.tsx tests/symbol-search.test.ts
git commit -m "feat(terminal): search and open Kite instruments"
```

### Task 4: Verify full read-only chart flow and operational handoff

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Test: `tests/kite-provider.test.ts`, `tests/kite-market-routes.test.ts`, `tests/symbol-search.test.ts`

**Interfaces:**
- Documents only the safe operator path: configure registered redirect URL, obtain a fresh access token via official login, place it in ignored local environment, start API, search an Indian symbol, and open a chart.

- [ ] **Step 1: Add failing guard test for prohibited endpoint names**

```ts
it('does not expose Kite order or portfolio operations', () => {
  expect(KITE_ALLOWED_PATHS).not.toContain('/orders');
  expect(KITE_ALLOWED_PATHS).not.toContain('/portfolio');
  expect(KITE_ALLOWED_PATHS).not.toContain('/gtt');
});
```

- [ ] **Step 2: Run the guard test and verify red if required**

Run: `pnpm vitest run tests/kite-provider.test.ts`

Expected: PASS only after the allowlist implementation exists; if it already passes from Task 1, record that the guard is regression coverage and do not alter production code.

- [ ] **Step 3: Document and update project continuation state**

Document the daily token-refresh requirement, active-catalog/expired-derivative limitation, historical rate limit, live subscription limit, and the fact that no trading action exists. Update the Recent log and the launch task tracker with evidence from this session.

- [ ] **Step 4: Run complete verification**

Run: `pnpm vitest run tests/kite-provider.test.ts tests/kite-market-routes.test.ts tests/symbol-search.test.ts && pnpm -F @supercharts/market-data typecheck && pnpm -F @supercharts/ingestion typecheck && pnpm -F @supercharts/api typecheck && pnpm -F @supercharts/web typecheck && pnpm lint`

Expected: all commands exit 0.

- [ ] **Step 5: Browser verify with a real configured Kite session**

Start API and web locally, search a known active Indian instrument, select it, and verify that `/terminal` displays provider-sourced candles and the chart reports either live data or its explicit provider state. Capture a screenshot with no confidential data visible.

- [ ] **Step 6: Commit**

```bash
git add README.md AGENTS.md tests/kite-provider.test.ts tests/kite-market-routes.test.ts tests/symbol-search.test.ts
git commit -m "docs: document Kite read-only market data setup"
```
