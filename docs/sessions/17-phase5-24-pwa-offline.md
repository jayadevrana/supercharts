# Session 17 — Phase 5 · #24 · PWA + offline snapshot

> One session = this task only. Effort L. Best after Session 16 (mobile) — install prompts matter most on phones.

## Kickoff prompt (paste into Claude Code)

```
Read CLAUDE.md, docs/architecture.md, and docs/sessions/17-phase5-24-pwa-offline.md, then implement ONLY that task end-to-end.
Rules: one increment this session; never break the live alerts/Telegram config; never fabricate market data; every number you report must be copy-pasted from a command run in THIS session.
Verify (typecheck + Vitest + browser offline simulation), commit small, tick Phase 5 #24 in CLAUDE.md + update the Recent log (cap 5 — move older to docs/changelog.md verbatim), then STOP.
```

## Goal

SuperCharts installs as a PWA and, when offline, shows the last-seen chart snapshot — clearly labeled as a snapshot. **The honesty rule is the feature**: offline data must never look live.

## Scope

1. **Manifest** (name, icons, theme, display: standalone) + install affordance.
2. **Service worker** (hand-rolled or workbox via next-pwa — pick what fits Next 15 App Router cleanly): cache-first for the app shell/static assets; network-only for `/api/*` (NEVER cache API responses in the SW — staleness must be impossible to confuse with live).
3. **Snapshot store (IndexedDB)**: on each candle snapshot/backfill, persist the latest N (≈500) candles per recently-viewed symbol+interval (cap ~10 entries, LRU). Pure tested module for the read/write/LRU logic.
4. **Offline mode**: on WS/fetch failure + `navigator.onLine === false`, ChartPane renders the IndexedDB snapshot with a persistent banner: "Offline — snapshot from HH:MM" ; live-tick UI elements (tape, DOM, alerts status) show explicit "offline" states, never stale rows.
5. **Reconnect**: on `online`, resubscribe WS, refresh candles, drop the banner (the existing reconnect path probably covers most — verify, don't duplicate).

## Hard rules

- An offline chart without a banner is a fabrication bug — the banner/state must be unmissable.
- No SW caching of authed API data; logout clears the IndexedDB snapshots.
- SW must not break dev mode (gate registration to production build, or guard).

## Verify before commit

- Unit tests: snapshot LRU/cap logic, offline-state reducer. Report count.
- Browser (production build `pnpm build` + start): Lighthouse/devtools shows installable PWA; load BTCUSDT → devtools offline → reload: shell loads, snapshot chart + banner render, tape/DOM show offline states; back online → live ticks resume, banner clears. Screenshots of offline + recovered.
- `pnpm typecheck` clean; full Vitest no regressions.

## Done means

- [ ] Installable + honest offline snapshot loop proven  ·  [ ] tests green  ·  [ ] #24 ticked + Recent log + one commit
