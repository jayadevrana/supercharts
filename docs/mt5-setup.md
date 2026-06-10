# Connecting a real MT5 account to SuperCharts

This is the actual, code-derived procedure. There is no broker login form —
SuperCharts never sees your MT5 password. Instead, a small Expert Advisor
(EA) runs inside *your* MetaTrader 5 terminal and opens an outbound TCP
socket to the SuperCharts API. The EA streams account / positions / ticks
to the server and executes the order commands the server sends back.

```
┌──────────────────────┐   TCP, newline-delimited JSON   ┌──────────────────────────┐
│ MetaTrader 5         │ ───────────────────────────────►│ SuperCharts API (:4000)  │
│ SuperChartsBridge EA │ ◄───────────────────────────────│ MT5 bridge (default      │
│ (your machine/VPS)   │   mt5_open / mt5_close / …      │ 127.0.0.1:7878)          │
└──────────────────────┘                                 └──────────────────────────┘
```

- EA source: `apps/mt5-ea/SuperChartsBridge.mq5` (install guide: `apps/mt5-ea/README.md`)
- Bridge listener: `apps/api/src/mt5/bridge.ts` (started in `apps/api/src/main.ts`)
- Wire types: `packages/types/src/mt5.ts`
- REST routes: `apps/api/src/routes/mt5.ts`

## 1. Server side — where the bridge listens

The API starts a raw TCP listener alongside the HTTP server:

| Env var           | Default     | Meaning                                                                 |
| ----------------- | ----------- | ----------------------------------------------------------------------- |
| `MT5_BRIDGE_PORT` | `7878`      | TCP port the EA connects to.                                            |
| `MT5_BRIDGE_HOST` | `127.0.0.1` | Bind address. **Loopback by default** — only an MT5 terminal on the same machine can connect. Set `0.0.0.0` to accept a remote MT5/VPS (then firewall the port yourself). |

`GET /api/mt5/status` reports the live values plus every account that has
ever paired and whether its EA is connected right now. `GET /api/health`
also includes `mt5BridgePort`.

## 2. Get a pairing token

Terminal top bar → **Connect MT5** chip → the dialog shows live connection
status and a pairing token (`POST /api/mt5/pair-tokens` under the hood).

Token semantics (implemented in `apps/api/src/mt5/state.ts` +
`routes/mt5.ts`):

- Valid for **24 hours** from issue.
- **Not consumed on use** — the EA re-sends the same token on every
  reconnect, and each successful attach/detach renews the 24h window, so a
  configured EA stays paired indefinitely.
- Tokens are persisted in SQLite (`mt5_pairing_tokens`) and re-loaded when
  the API restarts — a server restart does **not** strand a configured EA.
- "Generate new token" issues an additional token; it does not revoke
  earlier ones (they age out 24h after their last use).
- Treat the token like an API key: whoever has it can pair an EA session to
  your SuperCharts user.

## 3. Install + attach the EA in MetaTrader 5

1. MT5 → `File → Open Data Folder` → copy
   `apps/mt5-ea/SuperChartsBridge.mq5` into `MQL5/Experts/`.
2. Open it in MetaEditor, press **F7** — it must compile to
   `SuperChartsBridge.ex5` with no errors.
3. `Tools → Options → Expert Advisors` → enable **Allow algorithmic
   trading**. (No DLL imports, no WebRequest URLs — the EA uses MQL5's
   native `SocketCreate`/`SocketConnect`.)
4. Drag `SuperChartsBridge` onto **any** chart (the chart's symbol doesn't
   matter) and set the inputs:

   | Input               | Value                                                              |
   | ------------------- | ------------------------------------------------------------------ |
   | `InpHost`           | Host running the SuperCharts API (`127.0.0.1` if same machine).    |
   | `InpPort`           | `MT5_BRIDGE_PORT` (default `7878`).                                 |
   | `InpAccountToken`   | The pairing token from the dialog.                                  |
   | `InpDefaultSymbols` | Comma-separated symbols to stream (default `EURUSD,GBPUSD,USDJPY,XAUUSD`). |
   | `InpStreamAllTicks` | `true` to stream every Market Watch symbol.                         |

5. The Experts log should print `SuperCharts bridge connected to …`. In the
   web terminal the MT5 chip flips green and shows login / broker / equity.

The EA sends `mt5_hello {token, account, symbols}`; the server redeems the
token, binds the account (`login@broker`) to your user, records it in
`mt5_accounts`, and starts streaming. Heartbeats run every ~5s; the server
marks the account offline after 20s of silence (positions at the broker are
unaffected — the EA only disconnects from SuperCharts).

## 4. What you can do once paired

All REST endpoints are owner-scoped to the paired user:

| Endpoint                          | Purpose                                              |
| --------------------------------- | ---------------------------------------------------- |
| `GET /api/mt5/status`             | Bridge host/port + known accounts + live flags.      |
| `GET /api/mt5/accounts`           | Live accounts: snapshot (equity/balance), symbols.   |
| `GET /api/mt5/positions`          | Open positions + pending orders.                     |
| `POST /api/mt5/orders`            | Submit an `OrderIntent` (market/limit/stop, SL/TP in pips or price, fixed-lot / %-risk / cash-risk sizing, TP1/2/3 partials, trailing, break-even). |
| `PATCH /api/mt5/positions/:id`    | Modify SL/TP.                                        |
| `DELETE /api/mt5/positions/:id`   | Close (full, or partial via `?fraction=0.5`; fraction must be in (0, 1]). |
| `DELETE /api/mt5/orders/:id`      | Cancel a pending order.                              |

The right-rail **order panel** drives these. Partial-close ladders,
trailing stops and break-even shifts are executed server-side
(`apps/api/src/mt5/intents.ts`) as plain `mt5_modify`/`mt5_close` commands
on each tick, so behaviour is identical across brokers.

## 5. Troubleshooting (honest failure modes)

| Symptom                                   | Cause / fix                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| Chip shows **MT5 · awaiting EA** (amber)  | The account paired before but its EA is offline (MT5 closed, network, server restart). Restart MT5 / re-attach the EA — same token keeps working. |
| EA log: `SocketConnect … failed`          | Wrong `InpHost`/`InpPort`, API not running, or the bridge binds `127.0.0.1` and the EA is remote → set `MT5_BRIDGE_HOST=0.0.0.0`. |
| EA connects then immediately disconnects  | Invalid or expired (>24h unused) pairing token — generate a new one in the dialog. The server logs `hello with invalid pairing token`. |
| Order rejected `account_offline`/`bridge_offline` | The EA isn't connected; the intent is never silently queued.        |
| Order rejected `unknown_symbol`           | The broker symbol isn't in the EA's streamed set — enable it in MT5 Market Watch (right-click → Show) or add it to `InpDefaultSymbols`. |
| Order rejected `no_tick`                  | No tick received yet for that symbol — wait for the first quote.            |

## 6. Security notes

- The EA executes whatever `mt5_open`/`mt5_close` commands its backend
  sends. Only point `InpHost` at a SuperCharts instance you control.
- Use a **demo/paper account** until you trust the full path end-to-end.
- The bridge default bind is loopback; expose it deliberately, never by
  accident.
