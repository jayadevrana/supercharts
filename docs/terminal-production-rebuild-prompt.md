# SuperCharts terminal — production rebuild prompt

Copy the prompt below into the implementation agent responsible for the terminal. The scope is the authenticated/charting workspace only: `/terminal` and its supporting web, API, ingestion, chart-core, persistence, and test code. Do not redesign the public landing, pricing, legal, or marketing pages as part of this work.

---

You are the principal product engineer and staff-level frontend architect for **SuperCharts**, a serious crypto and forex charting terminal. Your assignment is to take the existing `/terminal` experience to a production-grade, TradingView-inspired workspace: dense, fast, discoverable, coherent, and completely functional. Do not make a superficial skin or a collection of mock controls.

## Outcome

Deliver a polished terminal that has the interaction grammar and information hierarchy traders expect from a first-class professional charting product, while remaining an original SuperCharts product. Match the quality bar of TradingView's chart workspace, **not its proprietary source, branding, assets, exact copy, or visual identity**.

Every visible action must be one of the following:

1. Works end-to-end against real application state and a real route/service.
2. Is intentionally unavailable because of a concrete condition (for example, a provider does not supply order-book data), and says why plus how to resolve it.
3. Is explicitly marked as an upcoming capability behind a feature flag and is not presented as a normal active control.

There must be no dead buttons, fake toast confirmations, inert menu items, placeholder values presented as live, or controls that silently do nothing.

## Existing application — preserve and extend

This is an established pnpm monorepo, not a blank project. Inspect it before making changes and preserve working features.

- `apps/web`: Next.js 15 App Router, React 19, Tailwind, Radix, Zustand.
- `apps/api`: Fastify, Zod, `node:sqlite`, WebSocket gateway.
- `apps/ingestion`: market-data fan-in, candle storage/backfill, tick/order-flow aggregation.
- `packages/chart-core`: custom layered Canvas 2D charting engine. It is the product's core; do **not** replace it with Lightweight Charts, a TradingView library, or an embedded third-party chart.
- `packages/indicators`: the single shared indicator implementation for charts, PulseScript, alerts, and backtests. Do not fork indicator math.
- `packages/script-lang`: original PulseScript language. Do not copy Pine syntax, identifiers, or APIs.
- `packages/types`: shared domain contracts.

The application already has multi-chart layouts; live Binance/OANDA/Yahoo/mock providers; drawings; overlays; 38+ indicators; indicator browser/legend/data window; order-flow tools; news/calendar; alerts and Telegram delivery; strategy/backtest/optimizer; CSV; MT5; PulseScript; sharing; and user persistence. Treat these as real assets to integrate, not features to rewrite from scratch.

Read `AGENTS.md`, `docs/architecture.md`, `README.md`, `docs/pulsescript-design.md`, the current screenshots, the test suite, and `.audit/tv-parity/PUNCHLIST.md` before planning. Reconcile that audit with current source: several listed items have already landed. Never regress completed work or re-implement it under a different name.

### Non-negotiable safety and data rules

- Do not break the existing live alert/Telegram configuration. Never mutate real alert or trading data during UI testing.
- Never fabricate candles, volume, order flow, DOM, footprint, fill, news, or backtest results. Clearly show unavailable, delayed, stale, loading, and provider-limited states.
- Binance-only market-depth/order-flow capabilities must remain unavailable for venues that cannot truthfully provide them.
- Preserve secret boundaries: tokens and credentials remain server-side; only safe metadata reaches the browser.
- Before real multi-user release, fix the known user-scoping issue in the MT5 WebSocket broadcast path. A user must never receive another user's account, alert, layout, or trading event.
- Preserve backwards compatibility for saved layouts, drawings, alerts, indicator instances, scripts, and the existing SQLite data. Use versioned migrations and safe defaults.

## Product direction

### 1. Workspace shell

Create one consistent desktop-first terminal shell. It should feel deliberate at 1280–2560px wide and remain usable down to a compact laptop width.

- A fixed, compact top bar with clear grouped zones:
  - product/workspace actions;
  - symbol search and exchange-aware instrument identity;
  - interval and chart-type controls;
  - indicator, alert, replay, layout, save, and chart utility actions;
  - account/connectivity/user status.
- Use visual grouping, dividers, tooltips, selected states, keyboard shortcuts, and badges sparingly. Do not turn the top bar into a wall of unlabeled icons.
- Keep the left drawing rail narrow, tool-grouped, keyboard-accessible, and aware of active-tool state. Tool choices must map to the drawing controller and show cursor/status feedback.
- Keep the chart canvas visually dominant. The right rail and bottom dock must be resizable, collapsible, and restore their last intentional size. Their layout must never cover the active chart without an explicit modal/dock state.
- Support chart grids and per-pane state consistently. The active-pane model must be obvious; any toolbar operation that applies to the active pane needs a clear target indicator.
- Add an accessible command/search surface for common actions (symbol, interval, indicator, drawing, layout, alert, replay, settings) with keyboard invocation and an accurate result state.

### 2. Chart interaction quality

Make the chart feel precise and trustworthy.

- Pan, wheel/pinch zoom, zoom anchors, reset, crosshair, cursor affordances, time-scale movement, and price-scale interactions must be smooth and predictable. Keep rendering in the existing Canvas layer system and avoid React re-rendering on every pointer move/tick.
- Right-click behavior must be context-sensitive: chart body, drawing, indicator legend, time axis, and price axis have distinct actions. Copy/format a price, add an indicator, create a prefilled alert, reset the relevant scale, and configure scale modes only when the action is valid.
- Implement and expose real price-scale behavior: regular, logarithmic, percentage/indexed where correct, auto-scale, invert, and reset. Axis ticks and hit-testing must be mathematically correct for every scale mode.
- Preserve or complete multi-pane time-axis alignment, shared crosshair behavior, independently managed price scales, sub-pane resize/collapse/maximize, and an accessible non-drag fallback for every drag operation.
- Ensure drawings use a clear lifecycle: select → create/edit → persist → undo/redo → delete. Display safe confirmation only for destructive bulk actions; do not confirm normal edits.
- All chart state changes must remain safe under symbol/interval changes, network reconnects, partial history, empty data, and late WebSocket events.

### 3. Information architecture and panels

Make the dense feature set navigable instead of merely available.

- Rebuild the right rail as a stable tab system with clear tabs, grouping, empty states, loading/error states, and a compact collapsed version. Existing indicator, data, layers, news, heat, P&L, logs, DOM, time-and-sales, and connection surfaces should use the same panel primitives.
- The indicator experience must support search aliases, categories, favorites/recent items, drag/drop with keyboard fallback, multi-instance management, style/settings, data-window values, legend overflow actions, and truthful source/provider status. Keep the existing registry as the source of truth.
- Use the bottom dock for persistent, high-density work: PulseScript, strategy tester/backtest, optimizer output, console/logs, and optionally a trade/order surface when connected. Do not open a giant modal for tools that benefit from repeated iteration.
- Modal dialogs are for focused, short-lived tasks: symbol search, indicator discovery, alert creation, sharing, import, integrations, and account settings. They need a consistent header, close behavior, focus trap, escape handling, width rules, scroll ownership, sticky actions, and mobile/compact-laptop fallback.
- Reuse a small set of semantic components—workspace panel, dock tab, toolbar group, menu item, status chip, empty/error state, field row, confirmation dialog—instead of inventing ad-hoc component styles per feature.

### 4. Visual system

Create an original dark analytical visual system inspired by professional trading terminals:

- Near-black neutral layers with clear elevation boundaries; restrained blue as the primary interaction accent; conventional but accessible bull/bear colors; semantic warning/error/success colors.
- A tokenized scale for color, spacing, borders, radii, typography, focus rings, shadows, z-index, animation duration, and chart/panel chrome. Use CSS variables and Tailwind tokens—never scatter literal values throughout feature files.
- Optimize for high information density without tiny hit areas. Maintain readable default type, high-contrast text, and 36px-or-larger targets where the control is not a dense chart tool.
- No ornamental gradients, oversized cards, excessive rounded containers, or dashboard-like empty space in the terminal. Visual hierarchy comes from alignment, spacing, contrast, and intentional grouping.
- Support light mode only if it can meet the same contrast/performance standard; otherwise ship a robust dark terminal first with an explicit system/theme architecture ready for light mode.
- Respect reduced motion. Use motion only to clarify state transitions (dock opening, menu, resize settling, toasts) and never animate chart price data gratuitously.

### 5. No-dead-control contract

Before changing UI, create a control inventory for `/terminal`:

| Control | User goal | State owner | Route/service | Success signal | Empty/loading/error/disabled behavior | Test |
| --- | --- | --- | --- | --- | --- | --- |

Inventory every top-bar action, rail tool, menu item, dialog primary action, layout control, panel control, keyboard shortcut, and icon button. Do not call the terminal complete until every row is implemented and covered by a meaningful test. Disabled controls require a visible reason; hide secondary unavailable functions when hiding is clearer.

For every async action:

- prevent accidental duplicate submissions;
- show in-place progress rather than a generic toast alone;
- preserve user input on failure;
- provide a human-readable error and a retry path where possible;
- update the actual source-of-truth state only after confirmed success;
- use an optimistic update only when rollback is defined and tested.

### 6. Production architecture

Improve the current architecture through explicit boundaries, not a destabilizing rewrite.

#### Frontend

- Treat chart rendering, viewport input, and high-frequency market events as an imperative chart-runtime boundary. React owns layout, accessible controls, and low-frequency view state; it must not subscribe every component to streaming ticks.
- Split the large terminal files by responsibility. Target clear units such as `terminal-shell`, `workspace-toolbar`, `workspace-layout`, `chart-pane-runtime`, `chart-interactions`, `indicator-workbench`, `right-rail`, `bottom-dock`, and feature dialogs. Do not create a mega-component or a global God store.
- Replace broad mutable Zustand state with small, typed slices and selectors: workspace/layout, active pane, UI chrome, persistence sync, panel state, and ephemeral interaction state. Document which state is local, shared client state, persisted server state, or derived.
- Introduce a typed API client boundary with Zod validation at the edge, normalized application errors, cancellation/deduplication for requests, WebSocket reconnect/backoff, and event versioning/sequence protection against stale updates.
- Make all persisted workspace models versioned and migration-aware. Debounce saves, surface save/offline/error state, and avoid overwriting newer remote changes.

#### Backend and data

- Retain Fastify route modules, but introduce service/repository boundaries where routes currently own business logic. Validate inputs and outputs with shared schemas.
- Keep real-time contracts typed and user-scoped. Authenticate subscriptions, authorize every resource, include event version/sequence metadata where ordering matters, and perform reconnect/replay safely.
- Make SQLite an explicit single-node development/small-install deployment profile. Add repository interfaces and a migration plan for production Postgres; use Redis for shared ephemeral streams/cache/jobs only when the deployment needs multiple app nodes; keep ClickHouse optional for high-volume analytics rather than adding infrastructure without a need.
- Add structured logs, correlation IDs, health/readiness endpoints, error reporting hooks, rate limits, request-size limits, secure headers, audit logs for trading/integration actions, backup/restore documentation, and a clear deployment configuration model.
- Keep MT5 and broker actions behind explicit intent/risk/confirmation boundaries. Chart UI must never be able to send a real trade merely because a button was clicked twice or a stale event arrived.

#### Performance budgets

- Maintain 60fps pointer/crosshair interaction on a normal current laptop under a one-pane live feed; avoid unbounded allocations in pointer/tick paths.
- Batch market updates via `requestAnimationFrame` or existing chart scheduler; clean up subscriptions and canvases on pane/layout changes.
- Lazy-load heavyweight dialogs/editor/rare chart layers, but prefetch intentionally after likely user intent.
- Define measurable budgets for initial terminal JS, time-to-interactive, chart paint, memory per pane, and WebSocket reconnect. Capture them in CI or documented performance checks.

### 7. Accessibility and keyboard operation

- Use semantic buttons/inputs, real labels, correct ARIA for tabs/menus/dialogs, visible focus, and robust focus restoration.
- Every action available through hover, drag, color, or an icon must have a discoverable keyboard and screen-reader path.
- Establish a keyboard map with conflict handling: global command palette, symbol search, interval search, indicator search, draw/select/escape, undo/redo, layout switch, and dock/rail focus. Show shortcuts in tooltips and command results.
- Do not trap shortcuts while typing in forms or the PulseScript editor unless the shortcut is explicitly editor-scoped.

### 8. Testing and definition of done

Work in vertical slices. For each slice:

1. inspect the existing implementation and tests;
2. add/update domain types and pure tests first;
3. implement the service/state/UI path;
4. test the real interaction in a browser against local mock/safe providers;
5. typecheck relevant packages, run focused tests, then the full suite at milestones;
6. capture a deterministic visual regression/screenshot for desktop and compact-laptop layouts;
7. update the control inventory and docs.

Required test layers:

- Unit tests for math, layout transforms, state reducers/selectors, serializers/migrations, and error mapping.
- Route/service integration tests for authorization, persistence, provider-unavailable cases, and schema validation.
- Browser end-to-end tests for each core workflow: open/change symbol, change interval/chart type, add/configure/remove indicator, draw/persist/undo drawing, change layout, create/edit/disable alert, use replay, run a safe backtest, save/load workspace, connect/disconnect integration without exposing secrets, and recover from a provider/WS failure.
- Visual regression for the shell, one- and multi-pane charts, indicator settings, alert dialog, right rail, bottom dock, empty/error state, and a narrow desktop viewport.
- Accessibility smoke tests for keyboard navigation, dialog focus, tabs, and icon buttons.

Do not claim completion because the screen looks close. Completion requires all controls in the inventory to have verified behavior, relevant tests passing, no new console errors, no known data fabrication, and a written list of intentionally deferred features.

## Delivery sequence

### Phase 0 — Baseline and decisions

- Run the existing app and tests. Record baseline screenshots, console errors, performance observations, and the current terminal control inventory.
- Reconcile the parity audit with source and create a prioritized gap list: broken/inert controls first, then workflow blockers, then visual consistency, then advanced parity.
- Present a concise architecture/design plan before code changes. Do not start a broad rewrite without a controlled migration sequence.

### Phase 1 — Foundation and shell

- Establish design tokens and shared terminal primitives.
- Build the unified terminal shell, toolbar grouping, rails, dock, panel/resizing behavior, command palette, and persistence boundaries.
- Preserve old controls while migrating them; delete obsolete code only after behavior is verified.

### Phase 2 — Chart workbench

- Finish chart/axis/context-menu/crosshair/drawing interactions and multi-pane ergonomics.
- Complete the indicator workbench, legend, data window, panes, and settings interaction model using the existing registry and chart-core layers.

### Phase 3 — Workflows

- Bring alerts, backtesting, PulseScript, replay, import, sharing, providers, and MT5 surfaces into the same UX and error-handling system.
- Replace any pseudo-action with a real flow or an explicit, justified unavailable state.

### Phase 4 — Operational hardening

- Finish persistence migrations, auth/authorization gaps, MT5 user scoping, WebSocket resilience, observability, performance checks, accessibility, and test coverage.
- Provide deployment/runbook notes and a production-readiness checklist with anything intentionally deferred.

## Expected deliverables

1. A short product/technical design document with before/after workspace map, state ownership, and migration plan.
2. A checked control inventory proving there are no dead controls.
3. Incremental implementation commits with focused tests.
4. Updated architecture documentation and screenshots.
5. A final verification report: commands run, browser flows verified, test results, performance observations, remaining limitations, and confirmation that live alerts/Telegram/trading state were not altered.

Start by auditing the current terminal. State what already works, what is broken or inconsistent, and what will be preserved. Then propose the first vertical slice; do not begin with a visual-only redesign.

