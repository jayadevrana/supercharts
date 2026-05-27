# SuperCharts MT5 Bridge EA

Expert Advisor that bridges a MetaTrader 5 terminal to the SuperCharts
backend over a plain TCP socket carrying newline-delimited JSON.

Why TCP + NDJSON instead of HTTPS or WebSocket? Native MQL5 has direct
`SocketCreate/SocketRead/SocketSend` primitives, but implementing WebSocket
framing (HTTP Upgrade handshake, frame masking, ping/pong) in MQL5 is
painful and brittle. NDJSON over TCP keeps the wire format trivial and
matches what most trading bridges actually use in practice. The backend
runs a tiny TCP listener (Node `net.createServer`) on a dedicated port
alongside the regular HTTPS API.

## Wire format

* Each direction sends one JSON object per line. UTF-8 encoded.
* Server-to-EA messages are commands (e.g. `mt5_open`, `mt5_close`).
* EA-to-server messages are events (e.g. `mt5_hello`, `mt5_account_snapshot`,
  `mt5_tick`, `mt5_positions_snapshot`, `mt5_order_result`).
* Types are documented in [`packages/types/src/mt5.ts`](../../packages/types/src/mt5.ts).

## Install in MetaTrader 5

1. In MT5: **File → Open Data Folder**.
2. Copy `SuperChartsBridge.mq5` into `MQL5/Experts/`.
3. In MetaEditor: open the file, press **F7** to compile. Should produce
   `SuperChartsBridge.ex5` with no errors.
4. Allow algorithmic trading: **Tools → Options → Expert Advisors**.
   * Check `Allow algorithmic trading`.
   * Check `Allow DLL imports` (not strictly required for this EA, but
     useful for many bridges).
   * Add `127.0.0.1` (or your backend host) to **Allow WebRequest for
     listed URL** if you later add a REST fallback. (Not needed for the
     TCP socket path.)
5. Drag the EA onto **any chart** (the chart symbol does not restrict
   streaming — the backend tells the EA which symbols to stream).
6. In the inputs dialog set:
   * `InpHost` — host of the SuperCharts API. `127.0.0.1` if the MT5
     terminal runs on the same machine. Public IP/DNS otherwise.
   * `InpPort` — TCP port the bridge listens on. Default `7878`. Must
     match `MT5_BRIDGE_PORT` on the backend.
   * `InpAccountToken` — paste the pairing token shown on the
     SuperCharts terminal `/terminal` → MT5 connect dialog. The backend
     uses the token to bind this EA session to your SuperCharts user.
   * `InpDefaultSymbols` — comma-separated initial symbols (the backend
     can subscribe more on demand).
7. On the chart you should see "SuperCharts bridge connected to ..." in
   the Experts log. The web UI's MT5 chip should turn green.

## Permissions

This EA places live orders. If you point `InpHost` at an unfamiliar
backend you are letting that backend send `mt5_open` / `mt5_close`
commands against your account. Only point it at a backend you control.
The pairing token is short-lived (24 hours by default) and tied to the
SuperCharts user account.

## Stopping

Remove the EA from the chart, or close MT5. The backend marks the
account `offline` after 15 seconds without a heartbeat. Open positions
and pending orders are unaffected.
