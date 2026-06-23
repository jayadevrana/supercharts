# SuperCharts — Session prompts (one file = one Claude Code session)

Every remaining work item has its own prompt file here. **Workflow:**

1. Open the next file in the table below.
2. Copy its **Kickoff prompt** into a FRESH Claude Code session (`claude` from the repo root — never reuse a long session).
3. The session does that one task, verifies, commits, ticks the box in CLAUDE.md, updates the Recent log, and stops.
4. Tick the Done column here. Next work = next session.

If a session starts producing numbers no command produced, or drifts off-task: kill it, `/clear`, restart from the same file. Never argue with a poisoned context.

## Order & status

| # | File | Task | Depends on | Done |
|---|------|------|------------|------|
| 01 | `01-inc4-data-window-per-plot.md` | Data Window per-plot colours/names/hidden/change bar | — | [ ] |
| 02 | `02-inc15-chart-context-menu.md` | Chart context-menu staples + cursors | INC-14 ✅ | [ ] |
| 03 | `03-inc12-price-scale-modes.md` | Log/percent/auto/invert price scale + axis menu | — | [ ] |
| 04 | `04-inc5-pulse-smc-sts-data-window.md` | Pulse/SMC/STS in the Data Window | best after 01 | [ ] |
| 05 | `05-inc2-browser-fast-path.md` | Indicators-dialog category rail + scripts + info | — | [ ] |
| 06 | `06-inc10-indicator-coverage.md` | DEMA/TEMA/VWMA, bounds, offset, BB source | — | [ ] |
| 07 | `07-inc9-per-plot-toggles.md` | Per-plot enable / show-in-legend | best after 01 | [ ] |
| 08 | `08-inc16-pane-resize.md` | Sub-pane resize + maximize/collapse | — | [ ] |
| 09 | `09-inc17-legend-drag-reorder.md` | Legend drag-reorder + pane-aware drops | INC-13 ✅ | [ ] |
| 10 | `10-inc18-interaction-feel.md` | Magnet crosshair + hovered-pane Data Window | — | [ ] |
| 11 | `11-phase4-18-iframe-embeds.md` | Embedded iframe charts | — | [ ] |
| 12 | `12-phase5-20-auth.md` | Auth.js credentials + OAuth + WS scoping | — ⚠️ riskiest | [ ] |
| 13 | `13-phase5-21-stripe-billing.md` | Stripe billing live (test mode first) | 12 | [ ] |
| 14 | `14-phase5-22-per-user-persistence.md` | Complete workspace persistence audit+fill | 12 | [ ] |
| 15 | `15-phase4-19-multi-user-workspaces.md` | Multi-user workspaces | 12 (+14 ideal) | [ ] |
| 16 | `16-phase5-23-mobile-responsive.md` | Mobile responsive terminal | — | [ ] |
| 17 | `17-phase5-24-pwa-offline.md` | PWA + honest offline snapshot | best after 16 | [ ] |
| 18 | `18-phase5-25-wasm-indicators.md` | WASM pass (measure first, adopt only if ≥2×) | — | [ ] |

01–10 = the active TradingView-parity MISSION (specs: `.audit/tv-parity/PUNCHLIST.md`). 11–18 = roadmap Phases 4–5. Items without dependencies can run in any order; the listed order is recommended.

## Universal rules (baked into every kickoff prompt)

- **One increment per session** — finish, verify, commit, update logs, STOP.
- **Never break the live config**: 48 alerts on 1d EMA(5)×EMA(10), Telegram delivery configured locally (bot details redacted).
- **Never fabricate**: no fake market data, no metric that wasn't copy-pasted from a command run in that session.
- **Verify loop**: typecheck touched packages → relevant Vitest → headless-browser check on /terminal → commit small.
- **End ritual**: tick the roadmap box → Recent log entry (cap 5, older → `docs/changelog.md` verbatim) → one commit.
- Blocked? Append to **Questions for owner** in CLAUDE.md and stop — don't improvise around it.

## Maintaining this folder

- New work item → copy the structure of any file here (Kickoff / Goal / What exists / Spec / Files / Verify / Done).
- When a session completes its task, it may append one line under "Done" in its own file (date + commit hash) — nothing else here changes mid-session.
