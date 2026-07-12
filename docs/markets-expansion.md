# GOAL — Forex pairs + Indian market charts

> Bring first-class **forex** (FX majors/minors/exotics + metals) and **Indian market** (NSE/BSE/MCX
> — indices, stocks, F&O) charts to SuperCharts, reliably and at the lowest defensible cost.
> Set 2026-07-13.

## Decision (owner, 2026-07-13)

- **Forex → OANDA** (free demo token). ✅ chosen.
- **India → single owner Kite key, PERSONAL USE.** ✅ chosen. Wire ONE Zerodha Kite Connect key (the
  owner's) — NOT a public feature. **Compliance gate (mandatory):** the Kite feed must be served ONLY to
  the owner's authenticated account, never fanned out to other users on the public site (that would be
  redistribution → breach). Non-owner users get no live Indian data (a future BYOK wizard, MKT-5, is the
  path to opening it up compliantly).

## TL;DR direction

- **The provider plumbing already exists** — `packages/market-data/src/providers/{oanda,kite,yahoo}.ts`.
  This goal is **credentials + catalog + UX + compliance**, not new data engineering.
- **Forex → OANDA** (already wired, **free** with a demo/practice token; OTC data, redistribution-light).
  Yahoo stays the keyless fallback. Optional managed API: **Twelve Data** (~$29/mo, forex + global stocks).
- **India → owner's own Kite key**, personal use, gated to the owner's session. Cheap (₹500/mo the owner
  already/anyway pays Zerodha) and compliant *because it isn't redistributed*.

## Why BYOK for India — the compliance wall

Live NSE/BSE exchange data has strict **redistribution licensing**. Zerodha's own terms: Kite Connect
data is for *personal/execution* use — "displaying or redistributing Kite Connect API data on external
platforms violates exchange data-vending policies." Authorized vendors (TrueData, Global Datafeeds) CAN
be licensed to redistribute, but the **NSE redistribution approval fee is ~₹20 lakh (~$24k)** — prohibitive
pre-revenue.

**BYOK sidesteps it entirely:** each user accessing *their own* Zerodha account via *their own* key is
personal use, not redistribution. Zero licensing cost to SuperCharts, fully compliant, and it reuses the
exact pattern already shipped for OANDA (`routes/oanda.ts` + `OandaConnectDialog` — validate creds against
the real API, store server-side, never expose the token). Our `kite.ts` is already **read-only-locked**
(only `/instruments` + historical paths — it literally cannot place an order), so a user's key is safe.

## Provider pricing (verified 2026-07-13, sources below)

| Market | Provider | Cost to the PLATFORM | Notes |
|---|---|---|---|
| Forex | **OANDA v20** (wired) | **Free** (demo token; KYC to register) | Broker-grade stream + history. OTC data. |
| Forex | Yahoo (wired) | Free | Keyless fallback, delayed, less reliable. |
| Forex + global stocks | Twelve Data | ~**$29/mo** Grow (free tier: 8 req/min) | Cleaner managed API if we outgrow OANDA. |
| India (personal / BYOK) | **Zerodha Kite Connect** (wired) | **₹0 to us** — user pays ₹500/mo | Historical + live bundled since Feb 2025. **Access token expires daily** → re-auth each trading day. Read-only in our provider. |
| India (public redistribution) | TrueData / Global Datafeeds | Vendor fee **+ ~₹20L NSE approval** | Only if we ever license full public redistribution. Not now. |

## Milestones (per the decision above)

- [ ] **MKT-1 — Forex first-class.** Turn on the OANDA feed (env token, or the existing connect wizard);
  expand the forex catalog (28 majors/minors/exotics + XAU/XAG); pip-precision + FX session shading; verify
  live stream + 1y history on 3 pairs. Yahoo stays the honest keyless fallback. **Public feature.**
- [ ] **MKT-2 — Wire the owner's Kite key (personal).** Configure a single Zerodha Kite Connect key
  (`KITE_API_KEY`/`KITE_ACCESS_TOKEN`, encrypted at rest, never in git); drive the read-only `kite.ts` feed.
  Handle the **daily-token** reality (token expires each trading day → a simple "paste today's token" /
  refresh path; automate via TOTP later). Verify live quote + historical candle on NIFTY + one stock.
- [ ] **MKT-3 — Indian catalog + UX.** Seed NSE/BSE indices (NIFTY 50, BANKNIFTY, SENSEX) + top-N liquid stocks;
  Kite instrument search; INR formatting; `Asia/Kolkata` session hours; an India watchlist for the owner.
- [ ] **MKT-4 — Compliance gate (mandatory).** Serve Kite data ONLY to the owner's authenticated session —
  the WS gateway must NOT fan out Kite candles/quotes to other users. Non-owner users requesting a `KITE:`
  symbol get "connect your own Zerodha" (stub for MKT-5), never the owner's personal feed.
- [ ] **MKT-5 (later, optional) — Bring-Your-Own-Kite wizard.** If we want to open India to all users
  compliantly: clone the OANDA connect wizard so each user brings their own key (each pays Zerodha ₹500/mo).
  Unlocks India publicly with zero redistribution license. Deferred until there's demand.

## Hard rules

1. **Never redistribute live exchange data without a license.** Live NSE/BSE = BYOK or delayed/EOD only.
2. Never fabricate market data — unavailable stays honest (existing rule).
3. Kite provider stays **read-only** (data endpoints only); a user's key can never place an order.
4. Reuse the OANDA connect-wizard pattern; encrypt stored broker tokens; expose only last-4 to the client.

## Sources
- Kite Connect charges: https://support.zerodha.com/category/trading-and-markets/general-kite/kite-api/articles/what-are-the-charges-for-kite-apis
- Historical bundled with Connect: https://www.marketcalls.in/fintech/zerodha-makes-trading-api-free-for-personal-use-bundles-historical-data-with-connect-api.html
- OANDA v20 API access: https://developer.oanda.com/rest-live-v20/introduction/
- TrueData / Global Datafeeds redistribution (₹20L NSE approval noted): https://globaldatafeeds.in/ · https://www.truedata.in/price
- Twelve Data pricing: https://twelvedata.com/pricing
