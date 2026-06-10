# Session 11 — Phase 4 · #18 · Embedded iframe charts

> One session = this task only. Effort L–XL. Pattern-match the shipped strategy-share feature (#16): public token → sanitized, read-only.

## Kickoff prompt (paste into Claude Code)

```
Read CLAUDE.md, docs/architecture.md, and docs/sessions/11-phase4-18-iframe-embeds.md, then implement ONLY that task end-to-end.
Rules: one increment this session; never break the live alerts/Telegram config; never fabricate market data; every number you report must be copy-pasted from a command run in THIS session.
Verify (typecheck + Vitest + headless-browser screenshot), commit small, tick Phase 4 #18 in CLAUDE.md + update the Recent log (cap 5 — move older to docs/changelog.md verbatim), then STOP.
```

## Goal

A user can embed a live, read-only SuperCharts chart on their own website via an `<iframe>` snippet — one symbol + interval + theme, branded with a "Powered by SuperCharts" CTA. Original implementation; do not copy another vendor's embed API or markup.

## Scope v1 (keep it tight)

- **Token model**: `chart_embeds` table (token → userId, symbol, interval, theme, createdAt). Reuse the `strategy_shares` token pattern (`nanoid`, regenerate, revoke).
- **API** (`routes/embed.ts`): authed `POST/GET/DELETE /api/embeds` (manage own embeds) + public no-auth `GET /api/public/embed/:token` returning only `{symbol, interval, theme}` — nothing about the owner. Public candle access goes through the existing `/api/candles` path; expose only what the public page needs (read-only; no drawings/alerts/scripts).
- **Embed page** `app/embed/[token]/page.tsx`: a single minimal ChartPane — candles + volume, live WS ticks, crosshair; NO top bar, rails, dialogs, or order panel. Footer strip: symbol · interval · "Powered by SuperCharts" linking to the landing page (`target="_blank"`).
- **Headers**: the embed route must be frameable by third parties — ensure no `X-Frame-Options: DENY` / restrictive `frame-ancestors` applies to `/embed/*` while the rest of the app keeps its defaults (check `next.config` headers).
- **Snippet UI**: an "Embed" entry (top-bar or share-adjacent) → dialog: pick symbol/interval/theme/size → creates the embed → shows the copyable `<iframe src=".../embed/<token>" width height>` snippet + list of existing embeds with revoke.

## Hard rules

- Public payload is sanitized like `strategy-share.ts` — never leak userId/account/internal ids (write the sanitizer as a pure tested module `apps/api/src/chart-embed.ts`).
- Read-only: the embed page must not be able to mutate anything (no authed fetches at all).
- Revoked token → public endpoint 404s and the page renders an honest "embed disabled" state.

## Verify before commit

- Unit tests: sanitizer leak-prevention (assert no owner fields), token revoke. Report count.
- API smoke with curl: create → public GET (no cookie) returns only the safe shape → revoke → 404.
- Browser: open `/embed/<token>` in a fresh incognito context (no auth cookie) → live chart ticks; embed it in a local test HTML file via iframe → renders inside the frame. Screenshot both.
- `pnpm typecheck` clean (api + web).

## Done means

- [ ] Public iframe renders live read-only chart, zero leakage  ·  [ ] tests + curl smoke green  ·  [ ] #18 ticked + Recent log + one commit
