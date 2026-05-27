-- SuperCharts ClickHouse schema
-- All time-series market data lives here.

CREATE DATABASE IF NOT EXISTS supercharts;

-- =========================
-- Raw streams
-- =========================
CREATE TABLE IF NOT EXISTS supercharts.market_trades_raw (
  provider        LowCardinality(String),
  venue           LowCardinality(String),
  symbol          LowCardinality(String),
  event_time      DateTime64(3, 'UTC'),
  receive_time    DateTime64(3, 'UTC'),
  trade_id        String,
  price           Float64,
  quantity        Float64,
  notional        Float64,
  aggressor_side  Enum8('buyer'=1,'seller'=2,'unknown'=0),
  sequence        UInt64
)
ENGINE = MergeTree
PARTITION BY (provider, toDate(event_time))
ORDER BY (venue, symbol, event_time, trade_id)
TTL toDate(event_time) + INTERVAL 90 DAY;

CREATE TABLE IF NOT EXISTS supercharts.market_quotes_raw (
  provider        LowCardinality(String),
  venue           LowCardinality(String),
  symbol          LowCardinality(String),
  event_time      DateTime64(3, 'UTC'),
  bid             Float64,
  bid_size        Float64,
  ask             Float64,
  ask_size        Float64,
  mid             Float64,
  spread          Float64
)
ENGINE = MergeTree
PARTITION BY (provider, toDate(event_time))
ORDER BY (venue, symbol, event_time)
TTL toDate(event_time) + INTERVAL 30 DAY;

CREATE TABLE IF NOT EXISTS supercharts.order_book_deltas_raw (
  provider       LowCardinality(String),
  venue          LowCardinality(String),
  symbol         LowCardinality(String),
  event_time     DateTime64(3, 'UTC'),
  sequence_start UInt64,
  sequence_end   UInt64,
  type           Enum8('snapshot'=1,'delta'=2),
  bids           Array(Tuple(Float64, Float64)),
  asks           Array(Tuple(Float64, Float64))
)
ENGINE = MergeTree
PARTITION BY (provider, toDate(event_time))
ORDER BY (venue, symbol, event_time, sequence_end)
TTL toDate(event_time) + INTERVAL 14 DAY;

CREATE TABLE IF NOT EXISTS supercharts.order_book_snapshots (
  provider     LowCardinality(String),
  venue        LowCardinality(String),
  symbol       LowCardinality(String),
  event_time   DateTime64(3, 'UTC'),
  bids         Array(Tuple(Float64, Float64)),
  asks         Array(Tuple(Float64, Float64)),
  depth_levels UInt16
)
ENGINE = MergeTree
PARTITION BY (provider, toDate(event_time))
ORDER BY (venue, symbol, event_time);

-- =========================
-- Candle pyramid
-- =========================
CREATE TABLE IF NOT EXISTS supercharts.candles_1s (
  provider     LowCardinality(String),
  venue        LowCardinality(String),
  symbol       LowCardinality(String),
  open_time    DateTime64(3, 'UTC'),
  close_time   DateTime64(3, 'UTC'),
  open         Float64,
  high         Float64,
  low          Float64,
  close        Float64,
  volume       Float64,
  quote_volume Float64,
  buy_volume   Float64,
  sell_volume  Float64,
  trades       UInt32,
  vwap         Float64
)
ENGINE = ReplacingMergeTree(close_time)
PARTITION BY (provider, toYYYYMMDD(open_time))
ORDER BY (venue, symbol, open_time)
TTL toDate(open_time) + INTERVAL 7 DAY;

CREATE TABLE IF NOT EXISTS supercharts.candles_1m AS supercharts.candles_1s;
ALTER TABLE supercharts.candles_1m MODIFY TTL toDate(open_time) + INTERVAL 365 DAY;

CREATE TABLE IF NOT EXISTS supercharts.candles_5m AS supercharts.candles_1s;
ALTER TABLE supercharts.candles_5m MODIFY TTL toDate(open_time) + INTERVAL 730 DAY;

CREATE TABLE IF NOT EXISTS supercharts.candles_15m AS supercharts.candles_1s;
ALTER TABLE supercharts.candles_15m MODIFY TTL toDate(open_time) + INTERVAL 1095 DAY;

CREATE TABLE IF NOT EXISTS supercharts.candles_1h AS supercharts.candles_1s;
ALTER TABLE supercharts.candles_1h MODIFY TTL toDate(open_time) + INTERVAL 1825 DAY;

CREATE TABLE IF NOT EXISTS supercharts.candles_4h AS supercharts.candles_1s;
ALTER TABLE supercharts.candles_4h MODIFY TTL toDate(open_time) + INTERVAL 3650 DAY;

CREATE TABLE IF NOT EXISTS supercharts.candles_1d AS supercharts.candles_1s;
ALTER TABLE supercharts.candles_1d REMOVE TTL;

-- =========================
-- Order-flow aggregates
-- =========================
CREATE TABLE IF NOT EXISTS supercharts.footprint_bars (
  provider          LowCardinality(String),
  venue             LowCardinality(String),
  symbol            LowCardinality(String),
  interval          LowCardinality(String),
  candle_open_time  DateTime64(3, 'UTC'),
  price_level       Float64,
  bid_volume        Float64,
  ask_volume        Float64,
  delta             Float64,
  total_volume      Float64,
  imbalance_side    Enum8('none'=0,'buy'=1,'sell'=2),
  imbalance_ratio   Float64,
  absorption_flag   UInt8,
  stacked_imb_flag  UInt8
)
ENGINE = ReplacingMergeTree
PARTITION BY (provider, toYYYYMMDD(candle_open_time))
ORDER BY (venue, symbol, interval, candle_open_time, price_level);

CREATE TABLE IF NOT EXISTS supercharts.volume_profile_cache (
  provider     LowCardinality(String),
  venue        LowCardinality(String),
  symbol       LowCardinality(String),
  from_time    DateTime64(3, 'UTC'),
  to_time      DateTime64(3, 'UTC'),
  price_level  Float64,
  total_volume Float64,
  buy_volume   Float64,
  sell_volume  Float64,
  delta        Float64,
  trades       UInt32,
  is_poc       UInt8,
  is_hvn       UInt8,
  is_lvn       UInt8,
  in_value_area UInt8
)
ENGINE = MergeTree
PARTITION BY (provider, toYYYYMM(from_time))
ORDER BY (venue, symbol, from_time, to_time, price_level);

CREATE TABLE IF NOT EXISTS supercharts.liquidity_heatmap_cache (
  provider        LowCardinality(String),
  venue           LowCardinality(String),
  symbol          LowCardinality(String),
  time_bucket     DateTime64(3, 'UTC'),
  price_level     Float64,
  bid_liquidity   Float64,
  ask_liquidity   Float64,
  side            Enum8('bid'=1,'ask'=2,'mid'=0),
  intensity       Float32,
  added           Float64,
  pulled          Float64,
  executed        Float64,
  age_ms          UInt32
)
ENGINE = MergeTree
PARTITION BY (provider, toYYYYMMDD(time_bucket))
ORDER BY (venue, symbol, time_bucket, price_level)
TTL toDate(time_bucket) + INTERVAL 7 DAY;

-- =========================
-- News & health
-- =========================
CREATE TABLE IF NOT EXISTS supercharts.news_events (
  id             String,
  source         LowCardinality(String),
  published_at   DateTime64(3, 'UTC'),
  symbols        Array(String),
  topics         Array(String),
  title          String,
  url            String,
  sentiment      Float32,
  relevance      Float32,
  raw            String
)
ENGINE = ReplacingMergeTree(published_at)
PARTITION BY toYYYYMM(published_at)
ORDER BY (source, published_at, id);

CREATE TABLE IF NOT EXISTS supercharts.provider_health_events (
  provider     LowCardinality(String),
  venue        LowCardinality(String),
  event_time   DateTime64(3, 'UTC'),
  status       LowCardinality(String),
  latency_ms   UInt32,
  message      String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_time)
ORDER BY (provider, event_time)
TTL toDate(event_time) + INTERVAL 30 DAY;
