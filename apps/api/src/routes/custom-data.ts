import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import type { IngestionContext } from '@supercharts/ingestion';
import type { AppDB } from '../db';
import { getUser } from '../auth';
import type { Candle, Interval } from '@supercharts/types';
import { INTERVAL_MS } from '@supercharts/types';
import { parseOhlcCsv, type OhlcRow, MAX_CUSTOM_ROWS } from '../csv-ohlc';

/**
 * Custom OHLC data import (Phase 3 #14).
 *
 * A user uploads a CSV; we parse it (see csv-ohlc.ts), persist the dataset, and seed the live
 * candle store under a `CUSTOM:<slug>` symbol so the existing `/api/candles` path serves it with
 * no chart changes (unknown venue → no provider → cache-only). Datasets re-seed at boot. The data
 * is the user's own — nothing is fabricated; bad rows are dropped with a warning.
 */

const CUSTOM_VENUE = 'CUSTOM';

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return s || 'data';
}

function rowToCandle(row: OhlcRow, symbolId: string, interval: Interval): Candle {
  const stepMs = INTERVAL_MS[interval] || 0;
  const typical = (row.high + row.low + row.close) / 3;
  return {
    symbol: symbolId,
    provider: 'custom',
    venue: CUSTOM_VENUE,
    interval,
    openTime: row.time,
    closeTime: stepMs > 0 ? row.time + stepMs - 1 : row.time,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    quoteVolume: row.volume * typical,
    buyVolume: 0,
    sellVolume: 0,
    delta: 0,
    trades: 0,
    vwap: typical,
    isClosed: true,
    volumeKind: 'real',
  };
}

/** Seed every stored dataset into the in-memory candle store. Called at boot + after upload. */
export function seedCustomDatasets(db: AppDB, ctx: IngestionContext): number {
  const rows = db.raw
    .prepare('SELECT symbol_id, interval, candles FROM custom_datasets')
    .all() as Array<{ symbol_id: string; interval: string; candles: string }>;
  let seeded = 0;
  for (const r of rows) {
    try {
      const candles = JSON.parse(r.candles) as Candle[];
      for (const c of candles) ctx.candleStore.upsert(r.symbol_id, r.interval as Interval, c);
      seeded += 1;
    } catch {
      /* skip a corrupt row rather than crash boot */
    }
  }
  return seeded;
}

export function customDataRoutes(fastify: FastifyInstance, db: AppDB, ctx: IngestionContext): void {
  fastify.get('/api/custom/datasets', async (req) => {
    const user = getUser(req, db);
    const items = db.raw
      .prepare(
        'SELECT id, name, symbol_id as symbolId, interval, row_count as rowCount, created_at as createdAt FROM custom_datasets WHERE user_id = ? ORDER BY created_at DESC',
      )
      .all(user.id);
    return { items };
  });

  fastify.post('/api/custom/datasets', async (req, reply) => {
    const user = getUser(req, db);
    const parsed = z
      .object({ name: z.string().trim().min(1).max(80), csv: z.string().min(1).max(8_000_000) })
      .safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid_payload', message: 'A name and CSV text are required.' };
    }

    const result = parseOhlcCsv(parsed.data.csv);
    if (result.rows.length === 0) {
      reply.code(422);
      return {
        error: 'no_rows',
        message: 'No valid OHLC rows were found in that CSV.',
        warnings: result.warnings,
      };
    }

    // Unique CUSTOM:<slug> per user.
    const base = slugify(parsed.data.name);
    let symbolId = `${CUSTOM_VENUE}:${base}`;
    const exists = db.raw.prepare('SELECT 1 FROM custom_datasets WHERE user_id = ? AND symbol_id = ?');
    for (let n = 2; exists.get(user.id, symbolId); n += 1) symbolId = `${CUSTOM_VENUE}:${base}-${n}`;

    const candles = result.rows.map((r) => rowToCandle(r, symbolId, result.interval));
    const id = nanoid();
    const now = Date.now();
    db.raw
      .prepare(
        'INSERT INTO custom_datasets (id, user_id, name, symbol_id, interval, candles, row_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, user.id, parsed.data.name.trim(), symbolId, result.interval, JSON.stringify(candles), candles.length, now);

    // Seed the live store so /api/candles serves it immediately.
    for (const c of candles) ctx.candleStore.upsert(symbolId, result.interval, c);

    const first = candles[0]!;
    const last = candles[candles.length - 1]!;
    return {
      id,
      name: parsed.data.name.trim(),
      symbolId,
      interval: result.interval,
      rowCount: candles.length,
      warnings: result.warnings,
      maxRows: MAX_CUSTOM_ROWS,
      range: { from: first.openTime, to: last.openTime },
    };
  });

  fastify.delete('/api/custom/datasets/:id', async (req) => {
    const user = getUser(req, db);
    const id = (req.params as { id: string }).id;
    db.raw.prepare('DELETE FROM custom_datasets WHERE id = ? AND user_id = ?').run(id, user.id);
    // The in-memory candle cache is cleared on the next API restart; the dataset won't re-seed.
    return { ok: true };
  });
}
