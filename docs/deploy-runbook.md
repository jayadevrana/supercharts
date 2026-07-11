# SuperCharts — deployment runbook (GCP VM)

> Server already provisioned: **e2-medium, Ubuntu 22.04, asia-south1-a, external IP
> `35.200.208.191`**, Node 22 + pnpm 9 + git + Caddy installed, firewall open on 22/80/443/3000/4000/7878.
> This runbook gets the app running on it. It is a **fresh instance** — it does NOT touch your
> local machine's running alerts/Telegram config; you re-add your bot + alerts in the VM's UI.

## Architecture recap

- **Two processes** (pm2): `supercharts-api` (:4000 — also embeds ingestion, the WebSocket
  gateway, the MT5 bridge on :7878, and the alert engine) and `supercharts-web` (:3000, Next.js).
- **Data**: `node:sqlite` file at `apps/api/data/supercharts.sqlite` (single-node; WAL on).
- **Region matters**: Binance is IP-blocked from the US — this VM is in Mumbai on purpose. Never
  move it to a `us-*` region or the crypto feed/scanner/order-flow go dark.

---

## Phase 1 — bare-IP HTTP (get it live today)

SSH in from Cloud Shell or your terminal:
`gcloud compute ssh supercharts-prod --zone=asia-south1-a`

```bash
# 1. Clone the repo (use your repo URL; private repos need a deploy key or PAT).
cd ~
git clone <YOUR_REPO_URL> supercharts
cd supercharts

# 2. Install deps (full — tsx + next are needed to run).
pnpm install

# 3. Create the root .env from the template and fill secrets IN THE EDITOR (not in any chat).
cp .env.production.example .env
nano .env
#   - AUTH_SECRET, ENCRYPTION_KEY  →  paste `openssl rand -hex 32` output for each
#   - leave OANDA/Telegram blank for now (add via the UI later)
#   - keep HOST=0.0.0.0 for bare-IP mode

# 4. Build the web app (do this with nothing else heavy running — Next build wants RAM).
pnpm -F @supercharts/web build

# 5. Start both processes under pm2 and make them survive reboots.
sudo npm install -g pm2
pm2 start infra/deploy/ecosystem.config.cjs
pm2 save
pm2 startup    # run the sudo command it prints

# 6. Watch them come up.
pm2 status
pm2 logs supercharts-api --lines 40   # expect "SuperCharts API listening on 0.0.0.0:4000" + Binance connected
```

Open **`http://35.200.208.191:3000`** in a browser. You should see the terminal with live BTC/USDT
candles. `http://35.200.208.191:4000/api/health` should return `{"ok":true, providers:[binance connected …]}`.

If the chart is blank: check `pm2 logs supercharts-api` for a Binance connection error (region/geo),
and confirm the `:4000` firewall rule is active (the browser opens the WebSocket to `:4000` directly
in bare-IP mode).

---

## Phase 2 — domain + HTTPS (do before inviting anyone)

Browsers throttle or distrust plain-HTTP sites and some WebSocket features need `wss`. Get a domain:

1. Point a domain's **A record → `35.200.208.191`** (any registrar; Cloudflare DNS is free).
2. On the VM: `sudo cp infra/deploy/Caddyfile.example /etc/caddy/Caddyfile`, edit it to your
   domain, then `sudo systemctl reload caddy`. Caddy fetches a Let's Encrypt cert automatically.
3. Harden: in `.env` set `HOST=127.0.0.1`, `NEXT_PUBLIC_APP_URL=https://yourdomain`,
   `CORS_ORIGINS=https://yourdomain`; `pm2 restart all`. Then **close the 3000/4000 firewall
   rules** (`gcloud compute firewall-rules delete supercharts-web` and re-create allowing only
   80/443) — only Caddy stays public.
4. Visit `https://yourdomain`.

---

## Updating the deployment

```bash
cd ~/supercharts && git pull
pnpm install
pnpm -F @supercharts/web build
pm2 restart all
```

## Backups (do this before real users — Phase D / DEPLOY-3)

The whole state is one SQLite file. Nightly cron, keeping 14 days:
```bash
mkdir -p ~/backups
(crontab -l 2>/dev/null; echo '0 2 * * * sqlite3 ~/supercharts/apps/api/data/supercharts.sqlite ".backup ~/backups/sc-$(date +\%F).sqlite" && ls -t ~/backups/*.sqlite | tail -n +15 | xargs -r rm') | crontab -
```
For real durability, also copy the nightly file off-box (e.g. `gsutil cp` to a GCS bucket).

## Known gaps (still TODO in the launch backlog, not blockers for a smoke test)

- **Auth is a single-user demo stub** — everyone shares one workspace until AUTH-1..2 land. Fine
  for you testing solo; **not** ready for multiple strangers (they'd see each other's data).
- **MT5 WS events are broadcast unscoped** — do not expose hosted MT5 to multiple users until
  WS-AUTH lands.
- **No Stripe yet** — billing is Phase C.
- These are exactly why the launch plan sequences auth/billing before a public beta.

## Ops notes

- Account has a **billing identity-verification due ~Nov 8, 2026** — complete it or the VM can be
  suspended. The recurring "Gaia id not found" gcloud warning is non-fatal (all resources created
  fine).
- Caddy isn't in Ubuntu's default repos; the official apt repo was added during provisioning.
