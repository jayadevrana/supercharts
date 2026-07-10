# STATUS — live progress track (read this first, any agent)

> **Purpose:** the single up-to-date "what's done / what's next" file so any agent (Claude
> sessions, Codex, humans) can pick up cold. Update this file in the SAME commit as the work.
> Master goal + full backlog: `docs/LAUNCH-PLAN.md`. Working rules: `CLAUDE.md` (mirrored in
> `AGENTS.md`). Codebase map: `docs/architecture.md`.

## Mission

Launch SuperCharts publicly as the TradingView alternative for algo crypto/forex traders.
25-session ordered backlog in `docs/LAUNCH-PLAN.md` — work it top to bottom, one verified
increment per session, tick the box there AND log here.

## Hard rules (non-negotiable, any agent)

1. **Never break the live alert/Telegram config** — 48 armed production alerts (1d EMA5×EMA10).
   Read-only against `/api/alerts`; never mutate alert or trading data while testing.
2. **Never fabricate market data** — no fake candles/results; unavailable states stay honest.
3. One increment → typecheck touched packages → relevant Vitest → **full `pnpm test`** →
   browser-verify on live `/terminal` → small commit → tick LAUNCH-PLAN + update this file.
4. PulseScript stays an ORIGINAL language (never copy Pine identifiers/syntax); indicator math
   only in `packages/indicators`; chart engine stays our Canvas `chart-core`.
5. Tests live in `tests/` and import pure modules by RELATIVE SOURCE PATH (no build step).
   Commands: `pnpm test` · `pnpm -F @supercharts/<pkg> typecheck` · dev servers usually already
   running on :3000 (web) / :4000 (api) — check before starting new ones
   (`lsof -i tcp:3000 -i tcp:4000`); restart recipe in CLAUDE.md → Ops.

## Done (newest first — commit hashes are the ground truth)

| Date | Item | Commits | Evidence |
|---|---|---|---|
| 2026-07-10 | **SCAN-1** — screener query engine: pure `runScan` (apps/api/src/scanner.ts) + 6 presets (scan-presets.ts) + `ensureBarsMany` (candle-window.ts) + `POST /api/scanner/scan` / `GET /api/scanner/presets` (routes/scanner.ts) | `3868ebb` | 8 tests → suite 414/414; live 1h oversold: 48 scanned, 42 ok/6 insufficient/1 match; BTC RSI cross-checked 72.185 both paths |
| 2026-07-10 | **LAUNCH PLAN** set — north star, pricing rec, 25-session backlog, GTM, kill list | `8508123` `01375aa` | docs/LAUNCH-PLAN.md; designs in .audit/launch/*.json |
| 2026-07-10 | **PulseScript ergonomics + editor colors** — `pulse 1` header, colon bodies, no-let assignment; CodeMirror tokenizer + palette (pulse-language.ts) | `d352f2c` `8c90707` | 10 tests → 406/406; browser: 7+ token colors, sample runs live |
| 2026-07-10 | **Rebuild Slice 1** — dead-control sweep (magnet/lock/hide real, settings cog, replay interval, cursor modes, orphan deleted) + 2 latent bugs fixed (drawing id adoption; api.ts DELETE content-type 400) | `f79dcfb`…`0bbbaad` | 16 tests → 396/396; drawing round-trip 2→0 server-verified |
| 2026-07-10 | **Phase 0 audit** — baseline, control inventory, MT5 WS leak pinned, arch risks | `3580797` | .audit/terminal-rebuild/PHASE0-BASELINE.md |

## In progress

- **SCAN-2** (backlog #2): Scanner tab → real screener UI. Design:
  `.audit/launch/scanner-design.json`. Plan: extract `scanner-tab.tsx` from
  `right-rail.tsx:580` (keep Top movers as a mode), preset chips from GET /api/scanner/presets,
  interval pills (15m/1h/4h/1d), sortable metric columns via pure `scanner-tab-util.ts`
  (tested), matched-rows view + honest scanned/no-data/match counts, click row → open symbol,
  30s refresh, error+Retry state.

## Next (after SCAN-2)

SCAN-3 (custom screen builder + per-user saved screens) → SCAN-4 (PulseScript scans) →
DOCS-1..3 (public /docs, design in .audit/launch/docs-design.json) → IND-1..2 → Phase B (auth).

## Known landmines for newcomers

- `lib/api.ts` only sends the JSON content-type when a body exists — don't "fix" it back;
  body-less DELETEs 400 otherwise (FST_ERR_CTP_EMPTY_JSON_BODY).
- The indicator runner has process-wide metadata (`setIndicatorMetadata`) — always set it
  synchronously right before a synchronous compute (see scanner.ts for the pattern).
- Scanner evaluates the last CLOSED bar (still-forming bar trimmed) — same as the alert engine.
- Zustand store is a God store pending split (rebuild S7) — add slices, don't grow it.
- React 19 RC + Next 15: HMR occasionally serves stale chunks after mid-edit saves — clear
  `.next` + restart if imports "disappear".
- Installing deps (`pnpm add`) can kill both dev watchers — restart per CLAUDE.md Ops.
