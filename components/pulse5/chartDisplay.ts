import type { PricePoint } from "./types";

/**
 * Mobile chart display settings. These values are deliberately isolated from
 * market sampling, quotes, orders, bots and settlement.
 */
export const CHART_DISPLAY_CONFIG = {
  NORMAL_BUCKET_MS: 750,
  CHOP_BUCKET_MS: 1000,
  TREND_BUCKET_MS: 625,
  NORMAL_EMA_ALPHA: 0.56,
  CHOP_EMA_ALPHA: 0.32,
  TREND_EMA_ALPHA: 0.84,
  MOBILE_MIN_RANGE_PERCENT: 0.0012,
  CHOP_MAX_RANGE_PERCENT: 0.0006,
  CHOP_MIN_FLIP_RATIO: 0.45,
  CHOP_MAX_EFFICIENCY: 0.18,
  TREND_MIN_RANGE_PERCENT: 0.0015,
  TREND_MIN_DISPLACEMENT_PERCENT: 0.0006,
  TREND_MIN_EFFICIENCY: 0.48,
  MOBILE_MAX_CONNECTED_GAP_MS: 4_000,
} as const;

export interface TapeTexture {
  rangePercent: number;
  displacementPercent: number;
  pathEfficiency: number;
  directionFlipRatio: number;
  microChop: boolean;
  strongMove: boolean;
}

export interface DisplaySeries {
  points: PricePoint[];
  texture: TapeTexture;
  bucketMs: number;
  emaAlpha: number;
}

export function shouldConnectDisplayPoints(previous: PricePoint, next: PricePoint): boolean {
  return next.time >= previous.time &&
    next.time - previous.time <= CHART_DISPLAY_CONFIG.MOBILE_MAX_CONNECTED_GAP_MS;
}

const EMPTY_TEXTURE: TapeTexture = {
  rangePercent: 0,
  displacementPercent: 0,
  pathEfficiency: 0,
  directionFlipRatio: 0,
  microChop: false,
  strongMove: false,
};

export function analyzeTape(points: PricePoint[], currentPrice: number): TapeTexture {
  if (points.length < 4 || !(currentPrice > 0)) return EMPTY_TEXTURE;

  let min = points[0].price;
  let max = points[0].price;
  let totalPath = 0;
  let directionChanges = 0;
  let directionSteps = 0;
  let previousDirection = 0;
  // Ignore sub-$0.20 moves around a $100k BTC price when counting flips. They
  // add no useful directional information but can dominate exchange ticks.
  const directionEpsilon = currentPrice * 0.000002;

  for (let i = 1; i < points.length; i += 1) {
    const price = points[i].price;
    if (price < min) min = price;
    if (price > max) max = price;
    const delta = price - points[i - 1].price;
    totalPath += Math.abs(delta);
    if (Math.abs(delta) <= directionEpsilon) continue;
    const direction = delta > 0 ? 1 : -1;
    if (previousDirection !== 0 && direction !== previousDirection) directionChanges += 1;
    previousDirection = direction;
    directionSteps += 1;
  }

  const net = Math.abs(points[points.length - 1].price - points[0].price);
  const rangePercent = (max - min) / currentPrice;
  const displacementPercent = net / currentPrice;
  const pathEfficiency = totalPath > 0 ? net / totalPath : 0;
  const directionFlipRatio = directionSteps > 1 ? directionChanges / (directionSteps - 1) : 0;
  const duration = points[points.length - 1].time - points[0].time;
  const strongMove =
    rangePercent >= CHART_DISPLAY_CONFIG.TREND_MIN_RANGE_PERCENT ||
    (displacementPercent >= CHART_DISPLAY_CONFIG.TREND_MIN_DISPLACEMENT_PERCENT &&
      pathEfficiency >= CHART_DISPLAY_CONFIG.TREND_MIN_EFFICIENCY);
  const microChop =
    !strongMove &&
    duration >= 8_000 &&
    rangePercent <= CHART_DISPLAY_CONFIG.CHOP_MAX_RANGE_PERCENT &&
    directionFlipRatio >= CHART_DISPLAY_CONFIG.CHOP_MIN_FLIP_RATIO &&
    pathEfficiency <= CHART_DISPLAY_CONFIG.CHOP_MAX_EFFICIENCY;

  return { rangePercent, displacementPercent, pathEfficiency, directionFlipRatio, microChop, strongMove };
}

function aggregateBuckets(points: PricePoint[], bucketMs: number, lastWeight: number): PricePoint[] {
  if (points.length <= 2) return points.map((point) => ({ ...point }));

  const aggregated: PricePoint[] = [];
  let bucketId = Math.floor(points[0].time / bucketMs);
  let priceTotal = 0;
  let count = 0;
  let last = points[0];

  const flush = () => {
    if (count === 0) return;
    const mean = priceTotal / count;
    aggregated.push({ time: last.time, price: mean * (1 - lastWeight) + last.price * lastWeight });
  };

  for (const point of points) {
    const nextBucketId = Math.floor(point.time / bucketMs);
    if (nextBucketId !== bucketId) {
      flush();
      bucketId = nextBucketId;
      priceTotal = 0;
      count = 0;
    }
    priceTotal += point.price;
    count += 1;
    last = point;
  }
  flush();
  return aggregated;
}

function applyEma(points: PricePoint[], alpha: number): PricePoint[] {
  if (points.length === 0) return [];
  const result: PricePoint[] = [{ ...points[0] }];
  let value = points[0].price;
  for (let i = 1; i < points.length; i += 1) {
    value += (points[i].price - value) * alpha;
    result.push({ time: points[i].time, price: value });
  }
  return result;
}

/**
 * Builds a disposable mobile-only drawing series from raw ticks. The input is
 * never mutated. The final point is always the real current price, so display
 * smoothing cannot leak into the current-price label or any execution logic.
 */
export function buildMobileDisplaySeries(
  rawPoints: PricePoint[],
  left: number,
  right: number,
  currentPrice: number,
): DisplaySeries {
  const visible: PricePoint[] = [];
  for (const point of rawPoints) {
    if (point.time >= left && point.time <= right && Number.isFinite(point.price)) {
      visible.push(point);
    }
  }

  const texture = analyzeTape(visible, currentPrice);
  const bucketMs = texture.strongMove
    ? CHART_DISPLAY_CONFIG.TREND_BUCKET_MS
    : texture.microChop
      ? CHART_DISPLAY_CONFIG.CHOP_BUCKET_MS
      : CHART_DISPLAY_CONFIG.NORMAL_BUCKET_MS;
  const emaAlpha = texture.strongMove
    ? CHART_DISPLAY_CONFIG.TREND_EMA_ALPHA
    : texture.microChop
      ? CHART_DISPLAY_CONFIG.CHOP_EMA_ALPHA
      : CHART_DISPLAY_CONFIG.NORMAL_EMA_ALPHA;
  const lastWeight = texture.strongMove ? 0.82 : texture.microChop ? 0.25 : 0.55;
  const smoothed = applyEma(aggregateBuckets(visible, bucketMs, lastWeight), emaAlpha);

  if (currentPrice > 0) {
    const endpoint = { time: right, price: currentPrice };
    if (smoothed.length > 0 && smoothed[smoothed.length - 1].time === right) {
      smoothed[smoothed.length - 1] = endpoint;
    } else {
      smoothed.push(endpoint);
    }
  }

  return { points: smoothed, texture, bucketMs, emaAlpha };
}
