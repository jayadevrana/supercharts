/**
 * pm2 process manager config for the SuperCharts VM (DEPLOY-1).
 *
 * Two processes only — the API embeds ingestion, the WebSocket gateway, the MT5 bridge and the
 * alert engine (apps/api/src/main.ts → bootstrapIngestion), so there is no separate ingestion
 * service to run.
 *
 *   pm2 start infra/deploy/ecosystem.config.cjs
 *   pm2 save && pm2 startup     # survive reboots
 *   pm2 logs / pm2 status / pm2 restart supercharts-api
 *
 * The API reads the root `.env` itself (apps/api/src/env.ts). Next reads apps/web/.env.production
 * if present. Run from the repo root.
 */
const path = require('node:path');
const root = __dirname.replace(/\/infra\/deploy$/, '');

module.exports = {
  apps: [
    {
      name: 'supercharts-api',
      cwd: path.join(root, 'apps/api'),
      script: 'pnpm',
      args: 'start', // = tsx src/main.ts (embeds ingestion + WS + MT5 + alerts)
      interpreter: 'none',
      autorestart: true,
      max_restarts: 20,
      max_memory_restart: '1200M',
      time: true,
    },
    {
      name: 'supercharts-web',
      cwd: path.join(root, 'apps/web'),
      script: 'pnpm',
      args: 'start', // = next start -p 3000 (build first: pnpm -F @supercharts/web build)
      interpreter: 'none',
      autorestart: true,
      max_restarts: 20,
      max_memory_restart: '1200M',
      time: true,
    },
  ],
};
