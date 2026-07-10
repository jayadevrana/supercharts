import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findEnvFile, loadEnvFile } from '../apps/api/src/env';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('loadEnvFile', () => {
  it('loads local .env credentials without overwriting an existing environment value', () => {
    const directory = mkdtempSync(join(tmpdir(), 'supercharts-env-'));
    directories.push(directory);
    const file = join(directory, '.env');
    writeFileSync(file, 'KITE_API_KEY=local-key\nKITE_ACCESS_TOKEN="local-token"\n');
    const env: NodeJS.ProcessEnv = { KITE_API_KEY: 'shell-key' };

    loadEnvFile(file, env);

    expect(env.KITE_API_KEY).toBe('shell-key');
    expect(env.KITE_ACCESS_TOKEN).toBe('local-token');
  });

  it('finds the workspace-root .env when the API runs from its package directory', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'supercharts-workspace-'));
    directories.push(workspace);
    const apiDirectory = join(workspace, 'apps', 'api');
    mkdirSync(apiDirectory, { recursive: true });
    writeFileSync(join(workspace, 'pnpm-workspace.yaml'), 'packages: []\n');
    writeFileSync(join(workspace, '.env'), 'KITE_API_KEY=local-key\n');

    expect(findEnvFile(apiDirectory)).toBe(join(workspace, '.env'));
  });
});
