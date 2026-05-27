/**
 * Thin fetch wrapper. Same-origin in dev via Next.js rewrites, configurable in production via NEXT_PUBLIC_API_URL.
 */
const BASE = '/api';

export async function api<T = unknown>(
  path: string,
  init: RequestInit & { searchParams?: Record<string, string | number | undefined> } = {},
): Promise<T> {
  const { searchParams, ...rest } = init;
  const url = new URL(`${BASE}${path}`, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  // Fastify rejects `application/json` POST/PUT/PATCH requests with no body
  // (FST_ERR_CTP_EMPTY_JSON_BODY). Default to an empty JSON object so callers don't
  // have to remember `body: '{}'` for every body-less request.
  const method = (rest.method ?? 'GET').toUpperCase();
  const bodyDefault =
    rest.body == null && (method === 'POST' || method === 'PUT' || method === 'PATCH') ? '{}' : rest.body;
  const res = await fetch(url.pathname + url.search, {
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    ...rest,
    body: bodyDefault,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`api ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

export function wsUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_WS_URL;
  if (explicit) return explicit;
  if (typeof window === 'undefined') return 'ws://localhost:4000/ws';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = process.env.NEXT_PUBLIC_API_URL
    ? new URL(process.env.NEXT_PUBLIC_API_URL).host
    : window.location.host.replace(':3000', ':4000');
  return `${protocol}//${host}/ws`;
}
