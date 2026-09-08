/**
 * Pulse5 V2 — single source of truth for all game/economics tuning.
 * No magic numbers should be scattered across the engines.
 */
export const GAME_CONFIG = {
  // Account
  INITIAL_BALANCE: 10_000,
  USER_ID: "local",

  // Round timing — strict UTC 5m candle boundaries (00/05/10/.../55).
  ROUND_DURATION_MS: 5 * 60 * 1000,
  BET_LOCK_SECONDS: 15,
  BET_LOCK_MS: 15 * 1000,

  // Economics — one all-in platform takeout (house edge + fees + friction).
  HOUSE_TAKEOUT: 0.04,

  // Machine market maker / synthetic liquidity.
  BASE_VIRTUAL_LIQUIDITY: 100_000,
  INVENTORY_SKEW_K: 0.30,
  PRICE_IMPACT_SLICES: 48,

  // Quoting.
  // NOTE: preview quote TTL is informational only. Orders are placed by amount
  // and filled at the latest market at order time, so feed latency never locks
  // the player out of trading.
  QUOTE_TTL_MS: 750,
  MIN_BET: 1,
  MIN_QUOTABLE_PROBABILITY: 0.05,
  MAX_QUOTABLE_PROBABILITY: 0.95,
  // Defensive client-side rate limit (anti double-click / spam).
  ORDER_RATE_LIMIT_MS: 120,

  // Volatility estimator — dual-speed EWMA of per-second log-return variance.
  FAST_VOL_HALF_LIFE_SECONDS: 60,
  SLOW_VOL_HALF_LIFE_SECONDS: 600,
  FAST_VOL_WEIGHT: 0.7,
  SLOW_VOL_WEIGHT: 0.3,
  // Samples are taken on this cadence from the mid-price feed.
  VOL_SAMPLE_INTERVAL_MS: 1000,
  // Per-second log-return safety floor (BTC ~1e-4/s; never quote 1/0 odds).
  MIN_VOLATILITY_PER_SEC: 2e-5,
  MAX_VOLATILITY_PER_SEC: 0.01, // outlier guard: |r| > 1%/s is rejected.
  // Minimum clean 1-second samples before live volatility is trusted.
  VOL_WARMUP_SAMPLES: 5,
  // Minimum 1m klines used to bootstrap volatility before live samples arrive.
  VOL_BOOTSTRAP_KLINES: 20,

  // Settlement waits for the official candle to be closed. A WS kline-close event
  // kicks settlement immediately; this retry is only the REST backstop, so it is
  // kept short for a smooth hand-off between rounds.
  SETTLE_RETRY_MS: 400,
  SETTLE_MAX_WAIT_MS: 20_000,

  // Display cadence. The feed (bookTicker/aggTrade) arrives many times a second;
  // the UI is coalesced to this interval so prices/odds track the market tightly
  // without re-rendering React on every socket frame. The 60fps chart animation
  // is independent of this value.
  MARKET_UI_FLUSH_MS: 90,

  // Persistence.
  STORAGE_KEY: "pulse5-v2-ledger-v1",
} as const;

export type GameConfig = typeof GAME_CONFIG;
