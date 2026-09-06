/**
 * Chart-only configuration for the rolling real-time BTC curve.
 *
 * The game round stays 5 minutes (see game/gameConfig.ts); these values only
 * control what the price chart displays and how it animates. Nothing here
 * feeds the odds, order, settlement or balance logic.
 */
export const CHART_CONFIG = {
  /** Sliding viewport: always show the most recent 2 minutes. */
  VISIBLE_WINDOW_SECONDS: 120,
  /** Keep a longer in-memory buffer (5 minutes) so rolling stays smooth. */
  DATA_RETENTION_SECONDS: 300,
  /** Market samples are committed to history at most ~5 times per second. */
  CHART_SAMPLE_MS: 200,
  /** Vertical padding above/below the visible price range (15%). */
  Y_AXIS_PADDING_RATIO: 0.15,
  /** Minimum vertical span = 0.04% of current price, to avoid zooming noise. */
  MIN_RANGE_PERCENT: 0.0004,
  /** Visual price tracking for ordinary ticks… */
  PRICE_INTERPOLATION_MS: 180,
  /** …and for large jumps (track fast so the line never lags badly). */
  JUMP_INTERPOLATION_MS: 90,
  /** Relative move (fraction of price) that counts as a "jump". */
  JUMP_RELATIVE: 0.0008,
  /** Y-axis range eases outward quickly… */
  SCALE_EXPAND_LERP: 0.35,
  /** …and contracts back only slowly… */
  SCALE_SHRINK_LERP: 0.06,
  /** …and contraction is allowed only after the range holds calm this long. */
  Y_SCALE_SHRINK_DELAY_MS: 1000,
} as const;

export const VISIBLE_WINDOW_MS = CHART_CONFIG.VISIBLE_WINDOW_SECONDS * 1000;
/** Chart buffer size at CHART_SAMPLE_MS cadence (plus a little headroom). */
export const CHART_BUFFER_SIZE = Math.ceil(
  (CHART_CONFIG.DATA_RETENTION_SECONDS * 1000) / CHART_CONFIG.CHART_SAMPLE_MS,
);

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
