# Slice 1 — Dead-control sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every control in the terminal chrome either works end-to-end or is removed — fixes audit findings D1–D7, P1–P2 + aria on touched controls.

**Architecture:** Meta drawing controls (magnet/lock/hide) become real global store flags consumed by `DrawingController` via getter callbacks (same pattern as `getTool`); replay steps by the active pane's real interval via `INTERVAL_MS`; the dead Settings cog becomes a workspace-settings popover backed by existing store flags; cursor/crosshair tools drive a new ChartCore `cursorStyle`.

**Tech Stack:** React 19 / Zustand / Radix popover / Canvas ChartCore / Vitest (tests import pure modules by relative source path — repo convention).

## Global Constraints

- ADD only — never remove/break a working feature (CLAUDE.md mission rules).
- Never fabricate market data; never touch the live alerts/Telegram config.
- Verify each task: typecheck touched packages + relevant Vitest + browser check on `/terminal`.
- Destructive bulk actions confirm via `window.confirm` (existing repo pattern, alerts-dialog.tsx:908).

---

### Task 1: Pure snap helper + drawing store flags (TDD)

**Files:**
- Create: `apps/web/features/terminal/drawing-snap.ts`
- Modify: `apps/web/features/terminal/terminal-store.ts` (add `magnetSnap`, `drawingsLocked`, `drawingsHidden`, `clearDrawingsRequest` + actions)
- Test: `tests/drawing-snap.test.ts`, `tests/terminal-drawing-flags.test.ts`

**Interfaces:**
- Produces: `snapToOhlc(candles: {openTime,open,high,low,close}[], time: number, price: number): {time,price} | null` — nearest candle by time, nearest of O/H/L/C by price; null when no candles.
- Produces store fields: `magnetSnap: boolean`, `drawingsLocked: boolean`, `drawingsHidden: boolean`, `toggleMagnetSnap()`, `toggleDrawingsLocked()`, `toggleDrawingsHidden()`, `clearDrawingsRequest: {token:number}|null`, `requestClearDrawings()`.

- [x] Write failing tests (snap picks nearest candle + nearest OHLC value; empty → null; store toggles flip + request bumps token)
- [x] Run `pnpm vitest run tests/drawing-snap.test.ts tests/terminal-drawing-flags.test.ts` → FAIL (module not found)
- [x] Implement `drawing-snap.ts` + store fields
- [x] Tests pass; commit `feat(terminal): magnet/lock/hide drawing flags + pure OHLC snap helper`

### Task 2: DrawingController honors flags + snap + clearAll

**Files:**
- Modify: `apps/web/features/terminal/drawing-controller.ts`

**Interfaces:**
- Consumes: constructor gains optional `getMagnet?: () => boolean; getLocked?: () => boolean; getHidden?: () => boolean; snapPoint?: (time:number, price:number) => {time:number; price:number}`.
- Produces: `clearAll(): void` (deletes all drawings, one `onDelete(id)` each), `refreshVisibility(): void` (pushes `[]` to core when hidden, else current set).

- [x] `handle()`: return early when hidden; skip select/drag branch when locked (creation still allowed — TV semantics); apply `snapPoint` to `e.time/e.price` at every point-capture site when `getMagnet?.()`
- [x] Typecheck chart-core untouched; `pnpm -F @supercharts/web typecheck` clean
- [x] Commit `feat(terminal): drawing controller lock/hide/magnet + clearAll`

### Task 3: Left rail — real meta toggles + wired ⋯ menu + aria

**Files:**
- Modify: `apps/web/features/terminal/left-rail.tsx`

- [x] Split `TOOLS` meta group out: magnet/lock/hide render as toggle buttons bound to the new store flags (NOT `drawTool`), with `aria-pressed` + `aria-label`; draw tools get `aria-label={label}` + `aria-pressed={drawTool===id}`
- [x] ⋯ button → Radix popover menu, one real item: "Remove all drawings (active pane)" → `window.confirm` → `requestClearDrawings()`; menu item disabled with reason when `drawingsHidden`
- [x] Browser-verify: magnet/lock/hide toggle highlight; panning no longer breaks; commit `fix(terminal): left-rail meta tools are real toggles; wire overflow menu`

### Task 4: ChartPane wiring + ChartCore cursorStyle

**Files:**
- Modify: `apps/web/features/terminal/chart-pane.tsx` (controller opts at :297, clear-request watcher, hidden-flag effect, cursor effect)
- Modify: `packages/chart-core/src/chart-core.ts` (`setCursorStyle('crosshair'|'default')` — used at the `setCursor('crosshair')` site, :618)

**Interfaces:**
- Consumes: Task 1 store flags via `useTerminalStore.getState()` reads inside callbacks (refs pattern — no re-render on toggle), Task 2 controller API.
- `snapPoint` implementation: `snapToOhlc(candleBufRef.current, time, price)` (buffer already interval-aligned).

- [x] Wire `getMagnet/getLocked/getHidden/snapPoint` into the `new DrawingController` site; effect on `drawingsHidden` → `controller.refreshVisibility()`; effect on `clearDrawingsRequest` token (active pane only) → `controller.clearAll()`
- [x] `drawTool === 'cursor' ? 'default' : 'crosshair'` → `core.setCursorStyle(...)` effect — makes Cursor vs Crosshair a real distinction
- [x] Typecheck web + chart-core; browser-verify magnet snap on a trend line, lock blocks drag, hide empties layer, clear-all removes + persists deletes; commit `feat(chart): cursor style modes + drawing flag wiring`

### Task 5: Replay steps by real pane interval

**Files:**
- Modify: `apps/web/features/terminal/replay-bar.tsx`

- [x] Replace `stepRef = useRef(60_000)` with `INTERVAL_MS[activePane.interval] ?? 60_000` derived from store (`panes`/`activePaneId` selectors); autoplay effect uses the same value (add to deps)
- [x] Browser-verify on a 1h chart: one step moves the cursor readout by 1 hour; commit `fix(terminal): replay steps by the active pane interval, not a fixed minute`

### Task 6: Settings cog → real workspace-settings popover

**Files:**
- Modify: `apps/web/features/terminal/terminal-top-bar.tsx:578`

- [x] Replace the inert cog with a popover: **Workspace** switches (Left toolbar / Right panel / Script dock — `setShowLeftRail/setShowRightRail/setShowBottomPanel`) + **Active pane** switches (Buy/Sell buttons → `setPaneOverlay('tradeButtons')`, MA signal labels → `maSignals`, Volume → `volume`), every switch `aria-pressed`, popover labelled "Workspace settings"
- [x] Add missing `title`/`aria-label` to the top-bar Replay toggle (audit gap) while in the file
- [x] Browser-verify each switch has a visible effect; commit `feat(terminal): real workspace settings popover behind the settings cog`

### Task 7: Delete orphaned dialog + docs truth-up

**Files:**
- Delete: `apps/web/features/terminal/signal-builder-dialog.tsx` (verify: `grep -rn "signal-builder-dialog" apps packages` → only self)
- Modify: `docs/architecture.md` (remove `code-terminal-dialog`/`signal-builder-dialog` mentions; note left-rail flags now controlled)

- [x] Grep-verify orphan, delete, typecheck web, full `pnpm test`
- [x] Update `.audit/terminal-rebuild/PHASE0-BASELINE.md` inventory rows D1–D7/P1–P2 → fixed
- [x] Commit `chore(terminal): remove orphaned signal-builder dialog; docs truth-up`

## Self-review notes

- Spec coverage: D1(T6) D2–D4(T1–T4) D5(T3) D6–D7(T7) P1(T5) P2(T4) + aria(T3,T6). P3–P9 deferred to S2/S3 by design.
- Type consistency: store getters consumed via `getState()` inside controller callbacks — no signature drift between T1 and T4.
- No placeholders: exact files/lines from the Phase-0 audit; code written at implementation with tests-first for the pure modules.
