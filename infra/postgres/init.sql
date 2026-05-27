-- SuperCharts PostgreSQL schema
-- Bootstrap script. Drizzle migrations supersede this at runtime; this exists for fresh containers.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- =========================
-- Identity & accounts
-- =========================
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           CITEXT UNIQUE NOT NULL,
  email_verified  TIMESTAMPTZ,
  password_hash   TEXT,
  display_name    TEXT,
  avatar_url      TEXT,
  role            TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- OAuth tokens at rest: store ciphertext+nonce just like provider_credentials does.
-- Plain-TEXT access/refresh tokens here would mean a single DB leak hands every
-- linked provider account to the attacker. Encryption is performed at the app
-- layer with ENCRYPTION_KEY (AES-256-GCM).
CREATE TABLE IF NOT EXISTS accounts (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider                 TEXT NOT NULL,
  provider_account_id      TEXT NOT NULL,
  access_token_ciphertext  BYTEA,
  access_token_nonce       BYTEA,
  refresh_token_ciphertext BYTEA,
  refresh_token_nonce      BYTEA,
  expires_at               TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================
-- Subscriptions & billing
-- =========================
CREATE TABLE IF NOT EXISTS subscriptions (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan                  TEXT NOT NULL CHECK (plan IN ('pro_6m','pro_12m','free')),
  status                TEXT NOT NULL CHECK (status IN ('active','past_due','canceled','trialing','incomplete','none')),
  stripe_customer_id    TEXT,
  stripe_subscription_id TEXT,
  current_period_end    TIMESTAMPTZ,
  cancel_at_period_end  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);

CREATE TABLE IF NOT EXISTS billing_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  type        TEXT NOT NULL,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================
-- Watchlists
-- =========================
CREATE TABLE IF NOT EXISTS watchlists (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS watchlist_symbols (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  watchlist_id  UUID NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  symbol_id     TEXT NOT NULL,
  sort_order    INT NOT NULL DEFAULT 0,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (watchlist_id, symbol_id)
);

-- =========================
-- Layouts & drawings
-- =========================
CREATE TABLE IF NOT EXISTS chart_layouts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  grid        TEXT NOT NULL DEFAULT '1' CHECK (grid IN ('1','2','4','8','16')),
  config      JSONB NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS drawing_objects (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  layout_id   UUID REFERENCES chart_layouts(id) ON DELETE CASCADE,
  symbol_id   TEXT NOT NULL,
  type        TEXT NOT NULL,
  payload     JSONB NOT NULL,
  z_index     INT NOT NULL DEFAULT 0,
  locked      BOOLEAN NOT NULL DEFAULT FALSE,
  visible     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_drawings_user_symbol ON drawing_objects(user_id, symbol_id);

CREATE TABLE IF NOT EXISTS drawing_templates (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL,
  style       JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================
-- Alerts
-- =========================
CREATE TABLE IF NOT EXISTS alerts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol_id   TEXT NOT NULL,
  type        TEXT NOT NULL,
  config      JSONB NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alert_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alert_id    UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  payload     JSONB NOT NULL,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================
-- Preferences & provider creds
-- =========================
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme       TEXT NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark','light','high_contrast','custom')),
  preferences JSONB NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_credentials (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,
  ciphertext   BYTEA NOT NULL,
  nonce        BYTEA NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

-- =========================
-- News saved items
-- =========================
CREATE TABLE IF NOT EXISTS news_saved_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  news_id     TEXT NOT NULL,
  payload     JSONB NOT NULL,
  saved_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, news_id)
);
