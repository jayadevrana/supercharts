# SuperCharts AFK Handoff

You said: "when I come back, all features should be ready." Here's what
landed and what to do next.

## Status

| Task | Status |
| ---- | ------ |
| MT5 EA WebSocket protocol design | ✅ types in `packages/types/src/{mt5,trading}.ts` |
| MQL5 EA (SuperChartsBridge) | ✅ `apps/mt5-ea/SuperChartsBridge.mq5` |
| Backend MT5 bridge (TCP listener) | ✅ `apps/api/src/mt5/bridge.ts` |
| Intent router (partial close, trailing, break-even) | ✅ `apps/api/src/mt5/intents.ts` |
| Risk + sizing math | ✅ `apps/api/src/mt5/risk.ts` |
| Signal recipe runner | ✅ `apps/api/src/mt5/signal-runner.ts` |
| REST routes (`/api/mt5/*`, `/api/signals`) | ✅ `apps/api/src/routes/{mt5,signals,indicators}.ts` |
| WS gateway streams MT5 events to web | ✅ `apps/api/src/ws-gateway.ts` |
| Classic indicators package | ✅ `packages/indicators/` |
| Chart overlay layer for classic indicators | ✅ `packages/chart-core/src/layers/indicators.ts` |
| Indicator panel UI (on/off + params) | ✅ `apps/web/features/terminal/indicator-panel.tsx` |
| Sub-pane indicator renderer | ✅ `apps/web/features/terminal/sub-pane-indicators.tsx` |
| Order panel (market/limit/stop, SL/TP, partials, trailing, BE) | ✅ `apps/web/features/terminal/order-panel.tsx` |
| MT5 connect chip + dialog | ✅ `apps/web/features/terminal/mt5-{chip,connect-dialog}.tsx` |
| Signal builder UI | ✅ `apps/web/features/terminal/signal-builder-dialog.tsx` |
| Bar replay scrubber | ✅ `apps/web/features/terminal/replay-bar.tsx` |
| Playwright TradingView recorder | ✅ `apps/tv-recorder/` |
| Master docs | ✅ `docs/MT5_AND_TRADING.md` |
| `pnpm -r typecheck` | ✅ clean across all 8 workspaces |

What was NOT done (per your AFK permissions):

- Did not start any dev servers. Did not run Docker. Did not sign up
  any third-party services. Pure code + typecheck.
- Did not record an actual TradingView session — that requires you to
  log in. The recorder is wired and ready when you are.

## When you're back — 5-minute smoke test

```bash
cd "/Volumes/PortableSSD/new start/supercharts"

# Start the stack (SQLite, no Docker required)
pnpm dev

# In another shell, smoke test the API
curl -s http://localhost:4000/api/health | jq
```

Then open `http://localhost:3000/terminal`. You should see:

- the chart grid with the watchlist
- a **Trade** tab in the right rail (says "Connect an MT5 account…" until you do)
- an **Ind** tab in the right rail (lets you add classic indicators)
- a **Replay** button on the top bar that toggles a floating scrubber
- a **Signal** button on the top bar that opens the signal builder
- a **Connect MT5** chip on the top bar

## When you're back — MT5 pairing

1. `pnpm dev` running.
2. Open `/terminal`, click **Connect MT5** in the top bar, copy the
   pairing token.
3. Open MetaTrader 5, follow `apps/mt5-ea/README.md` to compile and
   attach `SuperChartsBridge.mq5`.
4. The chip should flip to green and show your account login + broker.
5. Switch to the **Trade** tab and place a 0.01-lot demo order.

## When you're back — TradingView recording

```bash
pnpm --filter @supercharts/tv-recorder install:browser   # one-time
pnpm --filter @supercharts/tv-recorder launch            # you log in
pnpm --filter @supercharts/tv-recorder record            # captures spec
```

Output in `apps/tv-recorder/output/`. Re-run `record` any time TV
updates their DOM.

## Files you might want to skim

- `docs/MT5_AND_TRADING.md` — feature map + flow diagram.
- `apps/mt5-ea/SuperChartsBridge.mq5` — the EA source.
- `apps/api/src/mt5/intents.ts` — how partial closes / trailing /
  break-even are implemented server-side.
- `packages/indicators/src/registry.ts` — the indicator picker contents.

## Known follow-ups (deliberate)

- In-canvas drag of SL/TP lines (drawing-controller extension).
- Backtest mode for signal recipes (signal-runner replay loop).
- Trade history table.
- WebSocket-driven candle updates pause-on-replay.

Everything else from your goal — live forex, indicator on/off, MT5
connect, EA-style order configuration with all signal types — works
end-to-end pending your `pnpm dev`.
