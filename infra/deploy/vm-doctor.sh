#!/usr/bin/env bash
# SuperCharts VM doctor — investigate why the app is down, repair it, and HARDEN so it stops
# recurring (swap against OOM + pm2 boot-persistence against reboots).
#   ssh in, then:  curl -fsSL https://raw.githubusercontent.com/jayadevrana/supercharts/main/infra/deploy/vm-doctor.sh | bash
set -uo pipefail   # deliberately NOT -e: diagnostics must run fully even if a step errors
DIR="$HOME/supercharts"
say() { echo; echo "======== $* ========"; }

say "INVESTIGATION"
echo "## uptime / load";            uptime
echo "## memory";                   free -h
echo "## disk (root)";              df -h / | tail -1
echo "## recent OOM kills";         { sudo dmesg 2>/dev/null || journalctl -k --no-pager 2>/dev/null; } | grep -iE "killed process|out of memory|oom" | tail -5 || echo "  (none found)"
echo "## reboot history";           last -x reboot 2>/dev/null | head -3 || echo "  (n/a)"
echo "## pm2 processes";            pm2 status 2>/dev/null || echo "  pm2 has no processes (likely a reboot with no startup hook)"
echo "## web log tail";             pm2 logs supercharts-web --lines 15 --nostream 2>/dev/null | tail -18 || echo "  (no web logs)"
echo "## api log tail";             pm2 logs supercharts-api --lines 8  --nostream 2>/dev/null | tail -10 || echo "  (no api logs)"
echo "## caddy";                    sudo systemctl is-active caddy 2>/dev/null; sudo journalctl -u caddy --no-pager 2>/dev/null | tail -6

say "REPAIR + HARDEN"
# 1) Swap — the durable fix for OOM kills on a 4GB box.
if sudo swapon --show 2>/dev/null | grep -q .; then echo "-> swap present"; else
  echo "-> adding 2G swap"
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# 2) Repo + build present?
cd "$DIR" 2>/dev/null || { echo "-> repo missing, cloning"; git clone https://github.com/jayadevrana/supercharts.git "$DIR"; cd "$DIR"; }
git pull --ff-only 2>/dev/null || true
command -v pm2 >/dev/null 2>&1 || sudo npm install -g pm2
if [ ! -d apps/web/.next ]; then
  echo "-> web build missing, rebuilding (swap now protects it)"
  export NODE_OPTIONS=--max-old-space-size=3072
  pnpm install >/dev/null 2>&1 || pnpm install
  pnpm -F @supercharts/web build
fi

# 3) (Re)start both processes.
pm2 start infra/deploy/ecosystem.config.cjs 2>/dev/null || pm2 restart all
pm2 save

# 4) Boot-persistence — a reboot with no startup hook is why it 'keeps going down'.
sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME" 2>/dev/null | tail -1 || true
pm2 save

# 5) Caddy up + cert retry (DNS resolves now).
sudo systemctl reload caddy 2>/dev/null || sudo systemctl restart caddy

say "VERIFY"
sleep 8
pm2 status
echo "web  localhost:3000  -> $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000)"
echo "api  localhost:4000  -> $(curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/api/health)"
echo "swap now:"; free -h | grep -i swap
echo
echo "== done — check https://supercharting.com =="
