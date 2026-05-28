import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Built-in node:sqlite. Stable in Node 22+, fully featured in Node 26.
 * Wraps node:sqlite's `DatabaseSync` to mirror better-sqlite3's prepare/run/get/all
 * surface. Production deploys swap in `pg` against the same SQL — call sites unchanged.
 */
export interface PreparedStmt {
  run: (...params: unknown[]) => { changes: number | bigint; lastInsertRowid: number | bigint };
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
}

export interface AppDB {
  raw: {
    prepare: (sql: string) => PreparedStmt;
    exec: (sql: string) => void;
    transaction: <Args extends unknown[]>(fn: (...args: Args) => unknown) => (...args: Args) => unknown;
  };
}

export function openDB(env: NodeJS.ProcessEnv = process.env): AppDB {
  const url = env.DATABASE_URL ?? 'file:./data/supercharts.sqlite';
  // Refuse to silently fall back to SQLite when the operator supplied a non-file URL
  // (e.g. `postgresql://…`). That used to write to `./data/supercharts.sqlite` while
  // the operator believed they were on Postgres — data-lossy and very confusing.
  if (!url.startsWith('file:')) {
    throw new Error(
      `DATABASE_URL scheme not supported by this build: ${url.split(':')[0] ?? ''}. ` +
        `Only file:./… SQLite URLs are supported in this MVP; Postgres support lands ` +
        `in the same phase as Auth.js (Phase 11). Use file:./data/supercharts.sqlite.`,
    );
  }
  const filePath = resolve(process.cwd(), url.slice('file:'.length));
  mkdirSync(dirname(filePath), { recursive: true });

  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);

  const wrapStmt = (sql: string): PreparedStmt => {
    const stmt = db.prepare(sql);
    return {
      // node:sqlite's typed parameter signatures are strict; cast to its expected union.
      // Routes already validate inputs through Zod before reaching here.
      run: (...params) => stmt.run(...(params as never[])),
      get: (...params) => stmt.get(...(params as never[])),
      all: (...params) => stmt.all(...(params as never[])),
    };
  };

  const transaction = <Args extends unknown[]>(fn: (...args: Args) => unknown) =>
    ((...args: Args) => {
      db.exec('BEGIN');
      try {
        const out = fn(...args);
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    });

  return {
    raw: {
      prepare: wrapStmt,
      exec: (sql) => db.exec(sql),
      transaction,
    },
  };
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id           TEXT PRIMARY KEY,
      email        TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      display_name TEXT,
      role         TEXT NOT NULL DEFAULT 'user',
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      plan          TEXT NOT NULL,
      status        TEXT NOT NULL,
      stripe_customer_id    TEXT,
      stripe_subscription_id TEXT,
      current_period_end    INTEGER,
      cancel_at_period_end  INTEGER NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS watchlists (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      name       TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS watchlist_symbols (
      id           TEXT PRIMARY KEY,
      watchlist_id TEXT NOT NULL,
      symbol_id    TEXT NOT NULL,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      added_at     INTEGER NOT NULL,
      UNIQUE (watchlist_id, symbol_id),
      FOREIGN KEY (watchlist_id) REFERENCES watchlists(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chart_layouts (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      name       TEXT NOT NULL,
      grid       TEXT NOT NULL DEFAULT '1',
      config     TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS drawing_objects (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      layout_id  TEXT,
      symbol_id  TEXT NOT NULL,
      type       TEXT NOT NULL,
      payload    TEXT NOT NULL,
      z_index    INTEGER NOT NULL DEFAULT 0,
      locked     INTEGER NOT NULL DEFAULT 0,
      visible    INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_drawings_user_symbol ON drawing_objects(user_id, symbol_id);

    CREATE TABLE IF NOT EXISTS alerts (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      symbol_id  TEXT NOT NULL,
      interval   TEXT NOT NULL DEFAULT '1m',
      type       TEXT NOT NULL,
      config     TEXT NOT NULL,
      enabled    INTEGER NOT NULL DEFAULT 1,
      last_fired_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_user_enabled ON alerts(user_id, enabled);

    CREATE TABLE IF NOT EXISTS alert_events (
      id         TEXT PRIMARY KEY,
      alert_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      side       TEXT NOT NULL,
      symbol     TEXT NOT NULL,
      interval   TEXT NOT NULL,
      bar_time   INTEGER NOT NULL,
      price      REAL NOT NULL,
      ma_value   REAL NOT NULL,
      label      TEXT NOT NULL,
      fired_at   INTEGER NOT NULL,
      telegram   TEXT,
      telegram_error TEXT,
      UNIQUE (alert_id, bar_time),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_alertevents_user ON alert_events(user_id, fired_at DESC);

    CREATE TABLE IF NOT EXISTS telegram_configs (
      user_id    TEXT PRIMARY KEY,
      bot_token  TEXT NOT NULL,
      chat_id    TEXT NOT NULL,
      enabled    INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Multi-bot support: one row per (user, bot). Users can route different alert
    -- groups to different bots (e.g. "Default" for swing trades, "Scalp" for 30m
    -- crosses). Backwards-compat: the singleton telegram_configs row migrates here
    -- as label = 'Default' on first boot via the JS code below the exec() block.
    CREATE TABLE IF NOT EXISTS telegram_bots (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      label      TEXT NOT NULL,
      bot_token  TEXT NOT NULL,
      chat_id    TEXT NOT NULL,
      enabled    INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_telegram_bots_user ON telegram_bots(user_id);

    -- Virtual paper trades opened by the alert engine when the alert's
    -- delivery.paper flag is on. status='open' = still live; pnl_percent null until
    -- the position closes (on the next opposite cross OR explicit close).
    CREATE TABLE IF NOT EXISTS paper_trades (
      id           TEXT PRIMARY KEY,
      alert_id     TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      symbol       TEXT NOT NULL,
      interval     TEXT NOT NULL,
      side         TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'open',
      entry_time   INTEGER NOT NULL,
      entry_price  REAL NOT NULL,
      exit_time    INTEGER,
      exit_price   REAL,
      pnl_percent  REAL,
      bars         INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_papertrades_alert ON paper_trades(alert_id, status);
    CREATE INDEX IF NOT EXISTS idx_papertrades_user ON paper_trades(user_id, status);

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id     TEXT PRIMARY KEY,
      theme       TEXT NOT NULL DEFAULT 'dark',
      preferences TEXT NOT NULL DEFAULT '{}',
      updated_at  INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS news_saved_items (
      id       TEXT PRIMARY KEY,
      user_id  TEXT NOT NULL,
      news_id  TEXT NOT NULL,
      payload  TEXT NOT NULL,
      saved_at INTEGER NOT NULL,
      UNIQUE (user_id, news_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mt5_pairing_tokens (
      token      TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mt5_accounts (
      account_id TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      broker     TEXT NOT NULL,
      server     TEXT NOT NULL,
      currency   TEXT NOT NULL,
      first_seen_at INTEGER NOT NULL,
      last_seen_at  INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS signal_recipes (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      account_id TEXT NOT NULL,
      symbol     TEXT NOT NULL,
      interval   TEXT NOT NULL,
      enabled    INTEGER NOT NULL DEFAULT 1,
      name       TEXT NOT NULL,
      payload    TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_recipes_user ON signal_recipes(user_id);

    CREATE TABLE IF NOT EXISTS indicator_layouts (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      pane_id    TEXT NOT NULL,
      symbol     TEXT NOT NULL,
      interval   TEXT NOT NULL,
      payload    TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_indlayout_user ON indicator_layouts(user_id, pane_id);
  `);

  // Backfill telegram_bots from the legacy singleton config so existing setups don't
  // lose their bot when multi-bot support ships. Idempotent — only inserts when the
  // user has a telegram_configs row but zero telegram_bots rows.
  try {
    const legacy = db
      .prepare(
        `SELECT user_id as userId, bot_token as botToken, chat_id as chatId, enabled, updated_at as updatedAt
         FROM telegram_configs`,
      )
      .all() as Array<{
      userId: string; botToken: string; chatId: string; enabled: number; updatedAt: number;
    }>;
    for (const row of legacy) {
      const has = db
        .prepare('SELECT 1 FROM telegram_bots WHERE user_id = ? LIMIT 1')
        .get(row.userId);
      if (has) continue;
      const id = `tb_${row.userId}_default`;
      db.prepare(
        `INSERT INTO telegram_bots (id, user_id, label, bot_token, chat_id, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, row.userId, 'Default', row.botToken, row.chatId, row.enabled, row.updatedAt, row.updatedAt);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[db] telegram_bots backfill skipped:', err);
  }

  // Idempotent column additions for older DBs created before MA-cross alerts shipped.
  // SQLite's ALTER TABLE ADD COLUMN is safe but errors if the column already exists,
  // so we catch and ignore the duplicate-column error.
  for (const stmt of [
    "ALTER TABLE alerts ADD COLUMN interval TEXT NOT NULL DEFAULT '1m'",
    'ALTER TABLE alerts ADD COLUMN last_fired_at INTEGER',
  ]) {
    try {
      db.exec(stmt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/duplicate column name/i.test(msg)) throw err;
    }
  }

  const exists = db.prepare("SELECT id FROM users WHERE id = 'demo'").get();
  if (!exists) {
    const now = Date.now();
    db.prepare(
      "INSERT INTO users (id, email, display_name, role, created_at, updated_at) VALUES ('demo', 'demo@supercharts.local', 'Demo trader', 'user', ?, ?)",
    ).run(now, now);
    db.prepare(
      "INSERT INTO user_preferences (user_id, theme, preferences, updated_at) VALUES ('demo', 'dark', '{}', ?)",
    ).run(now);
    db.prepare(
      "INSERT INTO watchlists (id, user_id, name, sort_order, created_at, updated_at) VALUES ('wl_default', 'demo', 'Default', 0, ?, ?)",
    ).run(now, now);
    const stmt = db.prepare(
      'INSERT INTO watchlist_symbols (id, watchlist_id, symbol_id, sort_order, added_at) VALUES (?, ?, ?, ?, ?)',
    );
    const wlSyms = [
      'BINANCE:BTCUSDT',
      'BINANCE:ETHUSDT',
      'BINANCE:SOLUSDT',
      'BINANCE:BNBUSDT',
      'BINANCE:XRPUSDT',
      'BINANCE:DOGEUSDT',
      'OANDA:EUR_USD',
      'OANDA:GBP_USD',
      'OANDA:USD_JPY',
      'OANDA:XAU_USD',
    ];
    wlSyms.forEach((s, i) => stmt.run(`wls_${i}`, 'wl_default', s, i, now));
  }
}
