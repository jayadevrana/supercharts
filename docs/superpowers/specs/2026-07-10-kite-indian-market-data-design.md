# Kite Indian Market Data Design

**Status:** Approved for planning

## Goal

Add a server-only, read-only Zerodha Kite market-data provider that makes every *active* Indian-market instrument from the Kite master catalog searchable in SuperCharts, supplies one year of daily history across that catalog, fetches intraday history on demand, and streams live data only for symbols the product actively needs.

## Non-negotiable constraints

- This integration is market-data only. It must not import, expose, call, proxy, or construct any Kite order, GTT, basket, funds, holdings, positions, or portfolio operation.
- The server provider allowlist is limited to the Kite instrument dump, historical candles, quote/OHLC/LTP snapshots, session-token exchange, and the market-data WebSocket.
- API keys, API secret, user credentials, TOTP seeds, request tokens, and access tokens stay outside version control. No secret is written to source, test fixtures, logs, screenshots, browser state, or documentation.
- Kite login remains an official, user-controlled browser redirect flow. No headless password or TOTP automation is built. The server exchanges the returned request token, then stores the resulting daily access token only in the local secret store/environment.
- Access-token expiry is handled honestly: Kite session expiry pauses fetching/streaming and reports that re-authentication is required. It must never retry login using stored user credentials.
- Historical and live data must be marked unavailable when Kite does not return it. The application must not synthesize candles, volume, open interest, or quotes.
- Existing Binance, OANDA, Yahoo, mock, alerts, Telegram, MT5, and scanner behavior stays unchanged.

## Scope and data universe

### Active catalog

The daily Kite instrument dump is the source of truth for the active universe. Its records are persisted with instrument token, exchange token, exchange, segment, trading symbol, display name, expiry, strike, tick size, lot size, and instrument type.

The catalog includes every active record Kite exposes across NSE, BSE, NFO, MCX, CDS, and indices. A symbol is displayed with an unambiguous provider-qualified identifier such as `KITE:NSE:INFY` or `KITE:NFO:NIFTY26JULFUT`; the storage key must include the exchange and instrument token so same-named records cannot collide.

"All symbols" means all active instruments in the current master dump are discoverable and can be opened. It does not claim complete historical coverage for expired option contracts or expired futures. Kite does not expose expired tokens in the current dump; continuous history is a daily-only capability for NFO/MCX futures.

### History policy

| Data | Coverage | Storage policy |
|---|---|---|
| Daily candles | One year, every active catalog instrument | Resumable global backfill, then daily incremental maintenance |
| One-minute candles | One year, on-demand by chart/watchlist/pin/scan request | Persist once fetched; resume incomplete ranges |
| 3m, 5m, 10m, 15m, 30m, 60m | Same time span as available one-minute source data | Derived locally; never separately downloaded |
| Live data | Active chart panes, watchlists, and explicit live pins | Subscribe/unsubscribe dynamically; aggregate ticks into the open one-minute candle |

This avoids duplicating equivalent intraday data. A one-year one-minute series is about 93,750 regular-session bars per symbol, so a full all-symbol minute backfill would be prohibitively large. Daily history is inexpensive enough to prefill across the active catalog.

## Authentication and secrets

1. An operator starts a local, server-owned authentication flow.
2. The server opens or prints Kite's official login URL using only the API key.
3. After the operator signs in, Kite redirects to the registered local callback with a request token.
4. The server exchanges the request token and API secret for an access token.
5. The access token is kept only in a gitignored local secret location and is supplied only to the Kite adapter.
6. On token expiry or a Kite `TokenException`, all data jobs stop cleanly with a `reauth_required` provider state.

The implementation must document the required redirect URL and environment-variable names in `.env.example` without values. Credentials that were previously pasted into any chat should be rotated before this flow is used.

## System design

```text
Official Kite login redirect
        |
        v
Server-only session manager ----> local ignored token store
        |
        v
Kite read-only adapter
  | instrument CSV  | historical GET | quote GET | market-data WebSocket
  v
Catalog store + candle store + subscription coordinator
  |                     |                    |
  v                     v                    v
Symbol search        chart/scanner       active live panes/watchlists
```

### Catalog synchronization

- Run one full instrument-dump sync per day, scheduled around the provider's recommended pre-market refresh time.
- Upsert current catalog records, mark records absent from the latest dump inactive, and retain historical metadata for existing stored candles.
- Record a catalog version timestamp and source checksum/count for diagnostics.
- Treat catalog sync failure as stale metadata, not a reason to delete prior symbols.

### Historical backfill

- Use an explicit job table/manifest keyed by instrument, interval, range, and provider so work resumes after restart.
- Respect Kite's documented historical endpoint budget of three requests per second with a shared limiter; retries use bounded exponential backoff for transient 429/5xx/network failures.
- Split provider requests into configurable date windows, deduplicate candles by `(provider, instrument_token, interval, open_time)`, and write only fully validated OHLCV/OI rows.
- Backfill daily data globally in bounded batches. The initial job must be cancellable and report completed, unavailable, insufficient, failed, and remaining counts.
- Fetch one-minute data only when an active user action or configured background target requests it. Cache coverage is checked before fetching, so re-opening a symbol never redownloads known ranges.
- Derive all supported higher intraday intervals from canonical one-minute data using the India-market calendar/session boundaries. Derived candles are regenerated or invalidated whenever their source range changes.

### Live data

- The subscription coordinator owns all Kite WebSocket connections and accepts only demand-driven symbol sets from chart panes, watchlists, and explicit pins.
- It enforces Kite's per-connection and per-key subscription limits before subscribing. If capacity is exhausted, new symbols display a clear `live_capacity_reached` state while historical data remains usable.
- Incoming ticks update the current one-minute candle and fan out to derived active intervals. Completed candles are persisted idempotently.
- WebSocket reconnects resubscribe the current desired set and then reconcile the gap from historical data before claiming the stream is current.

## UI and product behavior

- Indian instruments appear in existing symbol search/catalog controls with exchange, segment, expiry/strike (where applicable), and an Indian-market provider badge.
- Opening an instrument loads daily history immediately if present and requests missing history in the background. Intraday resolutions show fetching/progress/unavailable states rather than empty fabricated charts.
- Live status distinguishes `live`, `delayed/reconnecting`, `historical only`, `provider unavailable`, `reauth required`, and `live capacity reached`.
- The market-data settings surface shows catalog sync time, access-token state without revealing its value, storage/backfill progress, and a read-only statement. It must not contain order controls.

## Error handling and observability

- Normalize provider failures into typed states: `reauth_required`, `rate_limited`, `network_error`, `unavailable`, `unsupported_history`, `live_capacity_reached`, and `invalid_instrument`.
- Logs include operation, provider, instrument identifier, interval, time range, HTTP/WebSocket status, and retry count. They never include credentials, tokens, raw authorization headers, or TOTP information.
- Metrics track catalog record count, active/inactive records, candle coverage, backfill throughput, queued/completed/failed jobs, stream subscription count, reconnects, and rate-limit events.

## Verification

- Unit tests cover instrument CSV parsing/normalization, inactive-record handling, symbol-key uniqueness, credentials redaction, request allowlisting, candle validation/deduplication, coverage calculation, interval aggregation, limiter behavior, retry classification, and live subscription capacity decisions.
- Integration tests use a local fake Kite HTTP/WebSocket server. They prove only the allowed GET/session endpoints are callable; any order/GTT/portfolio endpoint must be rejected before a network request is made.
- A local authenticated smoke test imports the instrument catalog, backfills a small approved sample, validates a provider candle against the stored candle, opens a live sample symbol, and verifies tick-to-candle aggregation. It does not place or modify an order.
- Before release, run typechecks for touched packages, relevant Vitest tests, browser verification of Indian-symbol search/chart/live-status states, and a secret scan of the staged diff.

## Explicit non-goals

- Trading, order routing, GTT, portfolio accounting, margin/holdings operations, or broker-account UI.
- Full-history reconstruction for expired options/futures.
- Full-universe live streaming; provider limits make that impossible for the complete active catalog.
- Downloading duplicate historical data independently for every chart interval.

## Delivery order

1. Read-only provider interfaces, secret-safe official session flow, endpoint allowlist, and test harness.
2. Instrument catalog import/sync plus Indian symbol search/catalog integration.
3. Daily one-year resumable backfill and candle-coverage storage.
4. On-demand minute history plus local interval aggregation.
5. Demand-driven live WebSocket coordinator and chart integration.
6. Progress/status UI, end-to-end verification, documentation, and operational runbook.
