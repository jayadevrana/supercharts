#!/usr/bin/env bash
# SuperCharts — fresh-Ubuntu bootstrap: installs the runtime, deploys the app, and serves the
# domain over HTTPS. Idempotent. Run on a bare Ubuntu 22.04/24.04 box as a sudo-capable user:
#   curl -fsSL https://raw.githubusercontent.com/jayadevrana/supercharts/main/infra/deploy/vm-bootstrap.sh | bash
set -uo pipefail
DOMAIN="supercharting.com"
DIR="$HOME/supercharts"
say(){ echo; echo "==== $* ===="; }

say "1/7 Node 22 + git + pnpm"
command -v node >/dev/null 2>&1 || { curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -; sudo apt-get install -y nodejs; }
sudo apt-get install -y git >/dev/null
command -v pnpm >/dev/null 2>&1 || sudo npm install -g pnpm@9

say "2/7 Caddy"
if ! command -v caddy >/dev/null 2>&1; then
  sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  sudo apt-get update -qq && sudo apt-get install -y caddy
fi

say "3/7 Swap (OOM guard)"
if ! sudo swapon --show 2>/dev/null | grep -q .; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

say "4/7 Clone"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only || true; else git clone https://github.com/jayadevrana/supercharts.git "$DIR"; fi
cd "$DIR"

say "5/7 .env (domain + generated secrets)"
[ -f .env ] || cp .env.production.example .env
sed -i "s|^HOST=.*|HOST=0.0.0.0|" .env
sed -i "s|^NEXT_PUBLIC_APP_URL=.*|NEXT_PUBLIC_APP_URL=https://$DOMAIN|" .env
sed -i "s|^CORS_ORIGINS=.*|CORS_ORIGINS=https://$DOMAIN,https://www.$DOMAIN|" .env
grep -q "^AUTH_SECRET=[0-9a-f]" .env    || sed -i "s|^AUTH_SECRET=.*|AUTH_SECRET=$(openssl rand -hex 32)|" .env
grep -q "^ENCRYPTION_KEY=[0-9a-f]" .env || sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(openssl rand -hex 32)|" .env

say "6/7 Build + pm2 (with reboot persistence)"
export NODE_OPTIONS=--max-old-space-size=3072
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
pnpm -F @supercharts/web build
command -v pm2 >/dev/null 2>&1 || sudo npm install -g pm2
pm2 delete all >/dev/null 2>&1 || true
pm2 start infra/deploy/ecosystem.config.cjs
pm2 save
sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME" >/dev/null 2>&1 || true
pm2 save

say "7/7 Caddy for $DOMAIN (needs DNS already pointing here)"
sudo cp infra/deploy/Caddyfile.example /etc/caddy/Caddyfile
sudo sed -i "s|app.example.com|$DOMAIN, www.$DOMAIN|" /etc/caddy/Caddyfile
sudo systemctl reload caddy 2>/dev/null || sudo systemctl restart caddy

say "VERIFY"
sleep 6
pm2 status
echo "web  localhost:3000 -> $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000)"
echo "api  localhost:4000 -> $(curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/api/health)"
echo "swap:"; free -h | grep -i swap
echo "== done — check https://$DOMAIN (cert issues in ~30-60s) =="
