import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../apps/web/lib/api';

describe('api client body/header defaults', () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];

  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal('window', { location: { origin: 'http://localhost:3000' } });
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return { ok: true, json: async () => ({ ok: true }) } as Response;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('body-less DELETE sends no JSON content-type (Fastify 400s empty JSON bodies)', async () => {
    await api('/drawings/abc', { method: 'DELETE' });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['content-type']).toBeUndefined();
    expect(calls[0]!.init.body).toBeUndefined();
  });

  it('body-less POST still defaults to {} with a JSON content-type', async () => {
    await api('/alerts/1/backtest', { method: 'POST' });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(calls[0]!.init.body).toBe('{}');
  });

  it('requests WITH a body keep the JSON content-type', async () => {
    await api('/drawings', { method: 'POST', body: '{"a":1}' });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(calls[0]!.init.body).toBe('{"a":1}');
  });
});
