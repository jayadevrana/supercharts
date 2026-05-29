# Public demo from your Mac (safe, read-only)

Goal: a shareable HTTPS link → your Mac running the backend, that an outside person can
click to explore the terminal **without** being able to change anything or see your
secrets.

## Safety model

The API has **no real auth yet** (every request is the `demo` user — Phase 5 #20). So we
never expose it raw. `DEMO_MODE=1` turns on a read-only guard (`apps/api/src/demo-guard.ts`):

- ✅ allowed: charts/candles, alerts list, portfolio heat, P&L attribution, backtest /
  optimizer / walk-forward / sizer (read-only compute).
- ⛔ blocked (403): every create/edit/delete/toggle/wipe, Telegram send + config, MT5 —
  and the secret GETs (`/api/alerts/telegram*`, `/api/mt5*`, `/api/billing*`).

The alert engine keeps running normally on your machine — the guard only gates the HTTP
surface a visitor can reach. The web shows a **"demo · read-only"** badge when
`NEXT_PUBLIC_DEMO_MODE=1`.

**Rules:** never tunnel without `DEMO_MODE=1`. Kill the tunnel when done. Treat the link as
public (assume it gets scanned).

## Run it

```bash
cd "/Volumes/PortableSSD/new start/supercharts"

# 1. API in demo mode (read-only guard ON)
DEMO_MODE=1 pnpm -F @supercharts/api dev

# 2. Web with the demo banner (separate terminal). Next proxies /api → :4000 server-side,
#    so a single tunnel to :3000 covers the REST API too.
NEXT_PUBLIC_DEMO_MODE=1 pnpm -F @supercharts/web dev
```

## Expose it — option A (fastest, random URL): ngrok

ngrok is already installed. One-time: add your authtoken from https://dashboard.ngrok.com
(this is your account step — I can't create/authorize it for you):

```bash
ngrok config add-authtoken <YOUR_TOKEN>
ngrok http 3000
```

Send the `https://<random>.ngrok-free.app` URL it prints. Done.

- Note: charts load history over REST (proxied). **Live tick (WebSocket) won't flow through
  a single :3000 tunnel** — Next only proxies `/api`, not `/ws`. Fine for a "look at the
  product" demo. To get live ticking, also expose the API and set
  `NEXT_PUBLIC_API_URL=https://<api-tunnel>` + add that origin to `CORS_ORIGINS`.

## Expose it — option B (vanity domain via FreeDomain)

FreeDomain (github.com/DigitalPlatDev/FreeDomain) hands out a free subdomain (e.g.
`yourname.us.kg`) by merging a PR that sets DNS records. Your Mac is behind NAT, so the
record must point at a **stable tunnel hostname**, not your home IP.

ngrok free gives a *random* hostname each run (can't CNAME to it); a stable target needs
either ngrok paid (reserved domain) or a **Cloudflare named tunnel** (free) which yields a
fixed hostname. Recommended path:

1. `brew install cloudflared`, then `cloudflared tunnel login` + `cloudflared tunnel create supercharts`
   → gives a stable `<id>.cfargotunnel.com` and a config routing it to `localhost:3000`.
2. In your FreeDomain fork, add a `CNAME` record for your subdomain → that tunnel hostname,
   and open the PR. **You submit the PR** (it's your GitHub account / public contribution).
3. Once merged + DNS propagates, `https://yourname.us.kg` → your Mac.

I can scaffold the cloudflared config + the FreeDomain JSON once you've created the tunnel
and picked a name — but the `login`, `tunnel create`, and the PR are account actions only
you can do.

## Teardown

`Ctrl-C` the tunnel + the two dev servers. The link dies immediately.
