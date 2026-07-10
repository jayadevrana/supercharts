import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export function findEnvFile(start = process.cwd()): string | undefined {
  let directory = resolve(start);
  let nearestEnv: string | undefined;

  while (true) {
    const envFile = join(directory, '.env');
    if (!nearestEnv && existsSync(envFile)) nearestEnv = envFile;
    if (existsSync(join(directory, 'pnpm-workspace.yaml'))) {
      return existsSync(envFile) ? envFile : nearestEnv;
    }
    const parent = dirname(directory);
    if (parent === directory) return nearestEnv;
    directory = parent;
  }
}

/**
 * Load a local .env file for the standalone API process. Existing shell environment
 * values win, matching common deployment expectations and keeping secrets out of git.
 */
export function loadEnvFile(file = findEnvFile(), env: NodeJS.ProcessEnv = process.env): void {
  if (!file || !existsSync(file)) return;

  for (const sourceLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    const rawValue = match[2];
    if (!key || rawValue === undefined) continue;
    if (env[key] !== undefined) continue;
    const value = rawValue.trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2');
    env[key] = value;
  }
}
