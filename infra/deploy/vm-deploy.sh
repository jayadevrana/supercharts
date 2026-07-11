#!/usr/bin/env bash
# One-shot VM deploy for SuperCharts. Idempotent — safe to re-run.
#   ssh in, then:  curl -fsSL https://raw.githubusercontent.com/jayadevrana/supercharts/main/infra/deploy/vm-deploy.sh | bash
set -euo pipefail

REPO="https://github.com/jayadevrana/supercharts.git"
DIR="$HOME/supercharts"

echo "==> [1/6] Fetch code"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only || git -C "$DIR" pull; else git clone "$REPO" "$DIR"; fi
cd "$DIR"

echo "==> [2/6] Install deps"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

echo "==> [3/6] Configure .env"
[ -f .env ] || cp .env.production.example .env
sed -i "s|^HOST=.*|HOST=0.0.0.0|" .env
# Only generate secrets if the current value is empty/placeholder (keeps re-runs stable).
authval=$(grep "^AUTH_SECRET=" .env | sed 's/^AUTH_SECRET=//; s/#.*//' | tr -d '[:space:]')
[ -z "$authval" ] && sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=$(openssl rand -hex 32)|" .env
encval=$(grep "^ENCRYPTION_KEY=" .env | sed 's/^ENCRYPTION_KEY=//; s/#.*//' | tr -d '[:space:]')
[ -z "$encval" ] && sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(openssl rand -hex 32)|" .env

echo "==> [4/6] Build web (a few minutes)"
export NODE_OPTIONS=--max-old-space-size=3072
pnpm -F @supercharts/web build

echo "==> [5/6] Start under pm2"
command -v pm2 >/dev/null 2>&1 || sudo npm install -g pm2
pm2 delete all >/dev/null 2>&1 || true
pm2 start infra/deploy/ecosystem.config.cjs
pm2 save || true

echo "==> [6/6] Health check"
sleep 8
pm2 status
echo "--- /api/health ---"
curl -s http://localhost:4000/api/health | head -c 300 || echo "(API not up yet)"
echo
echo "==> DONE — open http://35.200.208.191:3000"
