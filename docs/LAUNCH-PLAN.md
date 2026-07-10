# SuperCharts — Launch Plan (the master goal)

> Written 2026-07-10 from a 5-workstream analysis (competitive wedge, launch roadmap, scanner
> design, docs design, GTM). This is THE goal every session works toward. One session = one
> verified increment from the backlog below, in order. When this file and CLAUDE.md disagree,
> this file wins on direction; CLAUDE.md wins on working rules.

## North Star

**SuperCharts is the terminal algo crypto/forex traders pay for because it executes what it
charts** — chart → script → backtest → alert → Telegram → live MT5 execution in one owned stack,
replacing the ~$1,000–1,500/yr TradingView + PineConnector + VPS pile at $600/yr.

**One metric that matters (pre-launch):** backlog sessions completed → launch definition clauses
satisfied. **(at beta):** founding-member purchases — if fewer than ~5 of ~25 active beta users
buy at 50% off, fix product/pricing before public launch. Do not launch past that signal.

## Positioning (use this wording everywhere)

For algo-leaning crypto and forex traders who execute through MT5, SuperCharts is the charting
terminal that actually trades: unlike TradingView — which stops at a webhook and makes you rent a
$39/mo bridge plus your own VPS — SuperCharts ships native MT5 automation with a built-in risk
stack (position sizing, portfolio heat, max-drawdown breaker), Telegram-first alerts with chart
snapshots, ungated order-flow/SMC tooling, and a scriptable full-history screener, at one flat
price with no per-feature tier ladder.

**Wedge advantages (lean on):** MT5 execution + risk stack · Telegram-native alerts (48 live in
production) · no indicator-count caps · order-flow included · PulseScript screener without Pine
Screener's 500-bar/one-indicator caps · one flat price.
**Honest weaknesses (never hide):** no stocks/options breadth · no mobile apps (Telegram IS the
mobile surface) · no community/marketplace (the YouTube channel is the community) · order flow
Binance-only.

## Pricing decision (recommendation — owner can override before STRIPE-2)

- **Flagship: $600/12mo ($50/mo)** — sold ONLY against the full stack replacement story. Never
  present a monthly-equivalent next to TV Premium's $59.95 sticker.
- **Cut the 6-mo tier to ~$349** (or kill it) — $400/6mo = $66.67/mo loses every head-to-head.
- **14-day full-access trial, no card** + **founding-member 50% off first term, capped at 30,
  expires end of launch week** (real deadline, announced in the first video).

## Launch definition ("public beta launched" = ALL of these)

A stranger on the public internet can: (1) reach the product on its own domain over HTTPS,
(2) create an account and sign in, (3) pay via live Stripe checkout and be entitlement-gated,
(4) use /terminal with live data in a fully isolated workspace (zero cross-user leakage incl.
MT5 WS events), (5) refresh and get the same workspace back (versioned autosave), (6) run a real
screener and choose from ≥45 tested indicators, (7) read public PulseScript docs whose examples
all run — while the founder's 48 live alerts keep firing and nightly tested backups + uptime
monitoring run in production.

## Phases & ordered session backlog

Execution rule: one session = one item, verified + committed, tick the box. Full deliverable +
verification specs per item live in `.audit/launch/` design files (scanner/docs) and
`docs/sessions/` (auth/billing/deploy already have kickoff files 12–14).

### Phase A — Launch surface (OWNER GOAL 2026-07-10: "PulseScript everything Pine has + scanner + docs with examples, linked from home" — 10 milestones)
| # | ID | Milestone | Done |
|---|----|---------|------|
| 1 | SCAN-1 | Screener query engine: pure `runScan` + `POST /api/scanner/scan` + 6 presets, reusing signal-eval + computeAll; per-symbol honest status | [x] `3868ebb` |
| 2 | SCAN-2 | Scanner tab → real screener UI: preset chips, timeframe pills, sortable columns, click-to-open, honest states (`scanner-tab.tsx`) | [x] `dac7efe` |
| 3 | M1/SCAN-3 | Custom screen builder (metric·operator·value rows → indicator_compare conditions, all/any) + per-user saved screens (`scanner_screens` table, scripts-CRUD pattern) | [x] `dad7d64` |
| 4 | M2/SCAN-4 | PulseScript-powered scan: run a saved script across the universe; matched = alert()/mark on the last closed bar; per-symbol script errors isolated | [ ] |
| 5 | M3/DOCS-1 | Public `/docs` shell + home-page & header links + Getting started + Language tour + `?pulse=` run-in-terminal deep link; code blocks share the editor tokenizer | [ ] |
| 6 | M4/DOCS-2 | Pine-reference-style API docs: EVERY `ta.*`/`math.*`/`input.*`/output with signature + a runnable example per function (typed `Record<keyof typeof TA, DocEntry>` — typecheck fails on drift; every example interpreter-tested) | [ ] |
| 7 | M5/DOCS-3 | Cookbook (10 interpreter-verified strategies) + Backtesting/Optimizer pages + **“Coming from Pine” page with side-by-side Pine-concept → PulseScript examples** + sitemap/SEO | [ ] |
| 8 | M6/PULSE-1 | Sub-pane script plots: `meta(overlay: false)` renders plots in a real oscillator sub-pane (INC-11 pipeline), like RSI/MACD | [ ] |
| 9 | M7/PULSE-2 | Script drawing objects: levels/zones/labels/rays from scripts (Pine line/box/label CAPABILITY, original API) rendered via the drawings/indicators layers | [ ] |
| 10 | M8/PULSE-3 | `alert()` → real alert-engine bridge: arm a saved script as a live server-side alert with Telegram delivery + web toast (the wedge feature) | [ ] |
| 11 | M9/PULSE-4 | Interpreter optimization: committed benchmark harness, then hot-path work (ident resolution, per-bar Map churn, series cache) — target ≥3× on the cookbook bench, zero semantic changes (byte-identical outputs) | [ ] |
| 12 | M10/PULSE-5 | Editor intelligence: autocomplete + signature help + hover docs (sourced from the SAME typed doc entries as M4) + inline error squiggles at parser/runtime positions | [ ] |
| 13 | IND-1 | Indicator coverage batch 1: DEMA/TEMA/VWMA + input bounds/tooltips/offset/BB source (punchlist INC-10) | [ ] |
| 14 | IND-2 | Indicator coverage batch 2: remaining classics → registry ≥45, fixture-tested | [ ] |

**Pine-parity definition (hard rule intact):** capability parity, never identifier/syntax parity —
PulseScript stays an original language. Remaining language-core gaps tracked in
`docs/pulsescript-parity.md` (match/destructuring land inside M8; `trade.*` strategy objects stay
post-launch — the backtester already covers marks-as-strategy).

### Phase B — Multi-user foundation (folds rebuild S2/S3/S5; the 48 live alerts must never blink)
| # | ID | Session | Done |
|---|----|---------|------|
| 10 | S2-ASYNC | Shared panel loading/empty/error+retry primitives; fix infinite spinners + double-submit gaps (audit P5–P9); adopt in scanner tab | [ ] |
| 11 | AUTH-1 | Real auth core: Auth.js credentials, session cookie, `getUser()` resolves sessions, 401s (session file 12) | [ ] |
| 12 | AUTH-2 | Two-account IDOR sweep across ALL resource routes + founder migration off 'demo' (alert delivery re-verified) | [ ] |
| 13 | WS-AUTH | Authenticated WS upgrade + MT5 event ownership filter (fixes the critical leak, ws-gateway.ts:112-122) | [ ] |
| 14 | API-HARDEN | helmet, /livez+/readyz, correlation IDs, MT5 PATCH validation, calendar safeParse, signals conditions schema | [ ] |
| 15 | WORKSPACE | Versioned per-user workspace autosave/restore (fixes F3 + P3), save indicator | [ ] |

### Phase C — Revenue
| # | ID | Session | Done |
|---|----|---------|------|
| 16 | STRIPE-1 | Stripe checkout + signature-verified webhooks, test mode (session file 13) | [ ] |
| 17 | STRIPE-2 | Entitlement gating + account/billing UI + trial (pricing decision applied here) | [ ] |

### Phase D — Hosted & reliable (folds rebuild S4)
| # | ID | Session | Done |
|---|----|---------|------|
| 18 | DEPLOY-1 | Production build/env/process supervision + deploy runbook (env-driven URLs, SQLite WAL, Node 26 pin) | [ ] |
| 19 | DEPLOY-2 | VPS go-live: domain, TLS, WSS proxy, firewall, MT5 bridge token-gated; region pre-validated for Binance access | [ ] |
| 20 | DEPLOY-3 | Nightly offsite backups + restore drill + uptime monitoring on /readyz | [ ] |
| 21 | S4-WS | Client network hardening: typed ApiError, AbortController, WS gap guard, overlay-preserving resubscribe (F4/F5) | [ ] |
| 22 | LOAD-SMOKE | ~25 concurrent authenticated WS clients; p95/memory budgets; go/no-go on pulling rebuild S6 (per-tick re-render, F1) pre-launch | [ ] |

### Phase E — Beta → public launch
| # | ID | Session | Done |
|---|----|---------|------|
| 23 | AUTH-OAUTH | Google OAuth + account page + password-reset story | [ ] |
| 24 | BETA-CLOSED | 10–30 hand-picked YouTube-audience users on live infra; feedback loop; top-3 issues fixed | [ ] |
| 25 | LAUNCH-PUBLIC | Stripe live mode, launch video, status page, first real purchase end-to-end, 48h green monitoring | [ ] |

**Expansion during/after beta (not launch-blocking):** symbol catalog 48 → full Binance spot/perp
+ all FX majors/crosses (screener value scales with universe); rebuild S6–S8; punchlist
INC-2/4/5/9/16/17/18.

## GTM (runs in parallel; publishes nothing until Phase B–D close)

1. **Pre-launch assets:** public docs site (Phase A #5–7 doubles as the SEO surface — "Pine Script
   alternative" searches) · waitlist landing page with 60–90s real screen capture + a required
   question ("your #1 TradingView frustration; do you trade MT5?") · public "SuperCharts Beta"
   Telegram channel as the waitlist (the audience is Telegram-native).
2. **Video slate (channel = the distribution):** V1 build-story "I got tired of TradingView, so I
   built my own" (waitlist CTA) → V2 killer demo "My charts now trade my MT5 account" → launch
   week: V3 PulseScript end-to-end (idea → backtest → Telegram alert on camera), V4 scanner live,
   V5 order-flow suite. Post-launch: every channel video recorded INSIDE SuperCharts; weekly
   "PulseScript of the week" with a /s/ share link. Never demo anything that isn't real.
3. **First 100:** 30 hand-recruited by name (top commenters, EA clients) → ~40 from waitlist +
   launch videos (per-video UTM) → ~30 via activation-gated referral (3 invite codes unlocked
   AFTER first saved artifact). No paid ads, no Product Hunt.
4. **Metrics to instrument (one `events` table, no third-party analytics):** signups by source ·
   activation rate (first saved layout/script/alert within 48h; target >40%) · week-1 retention
   (≥2 active days, days 2–7) · trial→paid by plan+source · alerts delivered per active user per
   week (the churn early-warning).

## NOT doing until after launch (the kill list — protect focus)

Stocks/options/futures data breadth · community platform/ideas feed/script marketplace · native
or responsive mobile (Telegram is the mobile surface) · non-MT5 brokers (MT5 IS the wedge) ·
multi-user shared workspaces · iframe embeds · PWA/offline · WASM indicators · seconds-interval
parity · fundamentals screener · remaining cosmetic parity tail beyond scheduled slices.

## Top risks (with owners' mitigations)

1. **The 48 live alerts during auth migration** — AUTH-2 migrates and re-verifies Telegram
   delivery; never resubscribe-dirty.
2. **MT5 bridge on the public internet** — token-gate; if hardening slips, restrict hosted MT5 to
   founder/invited users for beta rather than delaying launch.
3. **Binance geo-blocking** — validate the VPS region for WS+REST BEFORE committing (DEPLOY-2 gate).
4. **F1 per-tick re-render under load** — LOAD-SMOKE is the explicit gate; pull rebuild S6 forward
   if it fails.
5. **React 19 RC + Next 15 in production** — pin exact versions at DEPLOY-1; upgrades are their own
   verified sessions.
6. **Pricing friction** — trial + founding-member deal; the <5-of-25 founding-purchase tripwire.
7. **Solo capacity** — cap closed beta at ~30 users; one growth experiment per week max; session
   hygiene rules stay in force.

## Design references

- Scanner full design: `.audit/launch/scanner-design.json`
- Docs full design: `.audit/launch/docs-design.json`
- Competitive gap matrix + pricing sources: `.audit/launch/wedge.json`
- GTM detail: `.audit/launch/gtm.json`
- Launch roadmap raw: `.audit/launch/roadmap.json`
