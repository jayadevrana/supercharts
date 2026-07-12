# GW-6 (pulled forward): Per-User Broker Charts — Kite Feed → Terminal

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Checkbox steps.
> Reordered ahead of GW-3/4/5 on owner demand (2026-07-13 "i dont find symbols nifty").

**Goal:** After connecting Zerodha, the owner searches "nifty", opens `KITE:NSE:NIFTY_50` (or any NSE/BSE instrument), and gets historical + live-during-market-hours charts — while every user WITHOUT their own Kite connection is refused KITE data (compliance: no redistribution).

**Architecture:** The data plane already exists (bootstrap builds `KiteProvider`; search fans out to it; candles route has a KITE 1-year clamp). Three seams: (1) main.ts injects the newest ACTIVE `broker_connections` kite creds into `ingestionEnv` (the proven oandaRow pattern); (2) `KiteProvider.setCredentials()` + broker reconnect route revives the live feed on daily token refresh without a restart; (3) a `hasActiveConnection` gate on search/symbol/candles/WS for `KITE:` symbols.

## Global Constraints
- Compliance: KITE data ONLY to users with an active kite `broker_connections` row (spec §3.7-2).
- Additive; alert engine and other providers untouched. Honest states: token expired → provider disconnected → clear error, never stale-faked data.

### Task 1: `hasActiveConnection` + boot injection (main.ts, oandaRow pattern)
### Task 2: `KiteProvider.setCredentials()` (packages/market-data) + reconnect route hook (brokerRoutes gains `ingestion`)
### Task 3: KITE gates — /api/symbols/search (filter), /api/symbols/:id + /api/candles (403), WS subscribe_market (reject)
### Task 4: Tests (store gate unit + provider setCredentials unit) + full suite + typechecks
### Task 5: Local browser verify (search "nifty" as connected admin → results; as non-connected user → none) + deploy (build BEFORE restart to avoid the GW-2 502 churn) + prod verify + STATUS
