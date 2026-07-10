/**
 * Screener routes — POST /api/scanner/scan evaluates a preset or custom screen across the
 * symbol catalog (or an explicit symbol list) on real candles; GET /api/scanner/presets lists
 * the canned screens. The legacy GET /api/scanner/top-movers (routes/market.ts) is untouched.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { IngestionContext } from '@supercharts/ingestion';
import type { Interval, SignalCondition } from '@supercharts/types';
import { INTERVALS, SYMBOL_CATALOG } from '@supercharts/types';
import { runScan, type ScanResult, type ScanScreen } from '../scanner';
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

export function scannerRoutes(fastify: FastifyInstance, ctx: IngestionContext): void {
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
    const { interval, preset, screen, symbols } = parsed.data;

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
    const key = JSON.stringify([interval, preset ?? screen ?? null, universe]);

    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;
    const pending = inFlight.get(key);
    if (pending) return pending;

    const job = (async (): Promise<ScanResult> => {
      try {
        const bySymbol = await ensureBarsMany(ctx, universe, interval as Interval, SCAN_BARS);
        const result = runScan(bySymbol, { interval: interval as Interval, screen: scanScreen, now: Date.now() });
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
