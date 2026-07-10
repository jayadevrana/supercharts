/**
 * Screener routes — POST /api/scanner/scan evaluates a preset or custom screen across the
 * symbol catalog (or an explicit symbol list) on real candles; GET /api/scanner/presets lists
 * the canned screens. The legacy GET /api/scanner/top-movers (routes/market.ts) is untouched.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { AppDB } from '../db';
import { getUser } from '../auth';
import type { IngestionContext } from '@supercharts/ingestion';
import type { Interval, SignalCondition } from '@supercharts/types';
import { INTERVALS, SYMBOL_CATALOG } from '@supercharts/types';
import { runScan, runScriptScan, type ScanResult, type ScanScreen } from '../scanner';
import { parse } from '@supercharts/script-lang';
import { SCAN_PRESETS, presetScreen } from '../scan-presets';
import { ensureBarsMany } from '../candle-window';

const INTERVAL_SET = new Set<Interval>(INTERVALS);

const indicatorSpecSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  name: z.string().default(''),
  paneId: z.string().default('price'),
  inputs: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
  style: z.record(z.union([z.string(), z.number()])).default({}),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
});

// Conditions reuse the SignalCondition union; validate the envelope here and let the shared
// evaluator's per-type handling own the semantics (full schema tightening tracked in API-HARDEN).
const conditionSchema = z.object({ type: z.string().min(1) }).passthrough();

const scanSchema = z.object({
  interval: z.string().refine((v) => INTERVAL_SET.has(v as Interval), 'unknown interval'),
  preset: z.string().optional(),
  /** Run a saved PulseScript across the universe instead of conditions (M2/SCAN-4). */
  scriptId: z.string().optional(),
  screen: z
    .object({
      conditions: z.array(conditionSchema).max(10),
      logic: z.enum(['all', 'any']).default('all'),
      indicatorSpecs: z.array(indicatorSpecSchema).max(20).default([]),
    })
    .optional(),
  symbols: z.array(z.string().min(1)).max(200).optional(),
});

const SCAN_BARS = 200; // metric warmup + cross history, matches the alert-engine floor
const CACHE_TTL_MS = 20_000;

interface CacheEntry {
  at: number;
  result: ScanResult;
}

const savedScreenSchema = z.object({
  name: z.string().min(1).max(120),
  /** Builder rows + logic as the web app models them — stored opaque, rebuilt client-side. */
  config: z.object({
    logic: z.enum(['all', 'any']),
    rows: z.array(z.object({ kind: z.string() }).passthrough()).min(1).max(10),
    interval: z.string().optional(),
  }),
});

interface ScreenRowDb {
  id: string;
  name: string;
  config: string;
  createdAt: number;
  updatedAt: number;
}

export function scannerRoutes(fastify: FastifyInstance, ctx: IngestionContext, db: AppDB): void {
  /* ── Saved custom screens (per-user CRUD, scripts-route pattern) ── */
  fastify.get('/api/scanner/screens', async (req) => {
    const user = getUser(req, db);
    const rows = db.raw
      .prepare(
        `SELECT id, name, config, created_at as createdAt, updated_at as updatedAt
         FROM scanner_screens WHERE user_id = ? ORDER BY updated_at DESC`,
      )
      .all(user.id) as ScreenRowDb[];
    return { items: rows.map((r) => ({ ...r, config: JSON.parse(r.config) as unknown })) };
  });

  fastify.post('/api/scanner/screens', async (req, reply) => {
    const user = getUser(req, db);
    const parsed = savedScreenSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload', details: parsed.error.flatten() };
    }
    const id = nanoid();
    const now = Date.now();
    db.raw
      .prepare('INSERT INTO scanner_screens (id, user_id, name, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, user.id, parsed.data.name, JSON.stringify(parsed.data.config), now, now);
    return { id, name: parsed.data.name, config: parsed.data.config, createdAt: now, updatedAt: now };
  });

  fastify.delete('/api/scanner/screens/:id', async (req, reply) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    const res = db.raw.prepare('DELETE FROM scanner_screens WHERE id = ? AND user_id = ?').run(id, user.id);
    if (Number(res.changes) === 0) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return { ok: true };
  });

  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<ScanResult>>();

  fastify.get('/api/scanner/presets', async () => ({
    presets: SCAN_PRESETS.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      logic: p.logic,
      conditions: p.conditions,
      indicatorSpecs: p.indicatorSpecs,
    })),
  }));

  fastify.post('/api/scanner/scan', async (req, reply) => {
    const parsed = scanSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload', details: parsed.error.flatten() };
    }
    const { interval, preset, screen, symbols, scriptId } = parsed.data;

    // Script scan path — load the saved script, parse errors → 400 with line/col.
    let script: { id: string; source: string; updatedAt: number } | null = null;
    if (scriptId) {
      const user = getUser(req, db);
      const row = db.raw
        .prepare('SELECT id, source, updated_at as updatedAt FROM user_scripts WHERE id = ? AND user_id = ?')
        .get(scriptId, user.id) as { id: string; source: string; updatedAt: number } | undefined;
      if (!row) {
        reply.code(404);
        return { error: 'script_not_found' };
      }
      script = row;
      try {
        parse(script.source); // syntax errors are the caller's problem — honest 400, not a 500
      } catch (err) {
        reply.code(400);
        return { error: 'script_parse_error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    let scanScreen: ScanScreen;
    if (preset) {
      try {
        scanScreen = presetScreen(preset);
      } catch {
        reply.code(400);
        return { error: 'unknown_preset', presets: SCAN_PRESETS.map((p) => p.id) };
      }
    } else if (screen) {
      scanScreen = screen as unknown as ScanScreen;
    } else {
      scanScreen = { conditions: [] as SignalCondition[], logic: 'all', indicatorSpecs: [] };
    }

    const universe = symbols && symbols.length > 0 ? symbols : SYMBOL_CATALOG.map((s) => s.id);
    const key = JSON.stringify([
      interval,
      script ? ['script', script.id, script.updatedAt] : preset ?? screen ?? null,
      universe,
    ]);

    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;
    const pending = inFlight.get(key);
    if (pending) return pending;

    const job = (async (): Promise<ScanResult> => {
      try {
        const bySymbol = await ensureBarsMany(ctx, universe, interval as Interval, SCAN_BARS);
        const result = script
          ? runScriptScan(bySymbol, script.source, { interval: interval as Interval, now: Date.now() })
          : runScan(bySymbol, { interval: interval as Interval, screen: scanScreen, now: Date.now() });
        cache.set(key, { at: Date.now(), result });
        // Bounded cache — screens are user-generated keys.
        if (cache.size > 100) {
          const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
          if (oldest) cache.delete(oldest[0]);
        }
        return result;
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, job);
    return job;
  });
}
