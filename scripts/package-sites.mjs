import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const web = join(root, 'apps/web');
const nextServerApp = join(web, '.next/server/app');
const nextStatic = join(web, '.next/static');
const stage = join(root, '.sites-stage');
const dist = join(stage, 'dist');
const client = join(dist, 'client');
const server = join(dist, 'server');
const archive = join(root, '.sites-artifacts/supercharts-sites.tgz');

const pages = [
  ['index.html', 'index.html'],
  ['pricing.html', 'pricing.html'],
  ['login.html', 'login.html'],
  ['signup.html', 'signup.html'],
  ['terminal.html', 'terminal.html'],
  ['legal/terms.html', 'legal/terms.html'],
  ['legal/privacy.html', 'legal/privacy.html'],
  ['legal/disclaimer.html', 'legal/disclaimer.html'],
  ['_not-found.html', '404.html'],
];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyFile(from, to) {
  await mkdir(dirname(to), { recursive: true });
  await writeFile(to, await readFile(from));
}

async function copyDir(from, to) {
  if (!(await exists(from))) return;
  const cp = spawnSync('rsync', ['-a', '--exclude=._*', `${from}/`, `${to}/`], {
    cwd: root,
    stdio: 'inherit',
  });
  if (cp.status !== 0) throw new Error(`rsync failed for ${from}`);
}

const worker = `const pageByPath = new Map([
  ["/", "/index.html"],
  ["/pricing", "/pricing.html"],
  ["/login", "/login.html"],
  ["/signup", "/signup.html"],
  ["/terminal", "/terminal.html"],
  ["/legal/terms", "/legal/terms.html"],
  ["/legal/privacy", "/legal/privacy.html"],
  ["/legal/disclaimer", "/legal/disclaimer.html"],
]);

function withHeaders(response, extra = {}) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function asset(env, request, path) {
  if (!env.ASSETS) return new Response("Sites asset binding missing", { status: 500 });
  const url = new URL(request.url);
  url.pathname = path;
  return env.ASSETS.fetch(new Request(url, request));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "SuperCharts API is not hosted on this static Sites deployment." }), {
        status: 503,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    let response = await asset(env, request, url.pathname);
    if (response.ok) return response;

    const cleanPath = url.pathname.replace(/\\/$/, "") || "/";
    const page = pageByPath.get(cleanPath) ?? (cleanPath.startsWith("/s/") ? "/404.html" : null);
    if (page) {
      response = await asset(env, request, page);
      if (response.ok) return withHeaders(response, { "content-type": "text/html; charset=utf-8" });
    }

    response = await asset(env, request, "/404.html");
    return new Response(response.body, { status: 404, headers: response.headers });
  },
};
`;

await rm(stage, { recursive: true, force: true });
await mkdir(client, { recursive: true });
await mkdir(server, { recursive: true });
await mkdir(dirname(archive), { recursive: true });

for (const [from, to] of pages) {
  await copyFile(join(nextServerApp, from), join(client, to));
}

await copyDir(nextStatic, join(client, '_next/static'));
await copyFile(join(root, '.openai/hosting.json'), join(dist, '.openai/hosting.json'));
await writeFile(join(server, 'index.js'), worker);

const tar = spawnSync('tar', ['-C', stage, '-czf', archive, 'dist'], { cwd: root, stdio: 'inherit' });
if (tar.status !== 0) throw new Error('tar failed');

console.log(archive);
