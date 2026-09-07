import { CHART_CONFIG as C } from "./chartConfig";
import type { PricePoint } from "./types";

/** First sample whose time is >= left (binary search; samples are ascending). */
export function lowerBound(points: PricePoint[], left: number): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].time < left) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface RangeInput {
  /** Prices of the samples currently inside the rolling 1-minute window. */
  visiblePrices: number[];
  /** Current round open (always included even if it scrolled off the left). */
  roundOpen: number;
  /** Animated live price at the right edge. */
  livePrice: number;
}

export interface PriceRange {
  lo: number;
  hi: number;
}

export interface ExtentsInput {
  visibleMin: number;
  visibleMax: number;
  roundOpen: number;
  livePrice: number;
  /** Final plotted span floor. Mobile passes a wider display-only value. */
  minimumRangePercent?: number;
}

export function rangeFromExtents({
  visibleMin,
  visibleMax,
  roundOpen,
  livePrice,
  minimumRangePercent = C.MIN_RANGE_PERCENT,
}: ExtentsInput): PriceRange | null {
  let rawMin = visibleMin;
  let rawMax = visibleMax;
  if (roundOpen > 0) {
    rawMin = Math.min(rawMin, roundOpen);
    rawMax = Math.max(rawMax, roundOpen);
  }
  if (livePrice > 0) {
    rawMin = Math.min(rawMin, livePrice);
    rawMax = Math.max(rawMax, livePrice);
  }
  if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) return null;

  const anchor = livePrice || roundOpen || rawMax;
  // Padding makes the final viewport 1.3x this base span. Divide the floor by
  // that factor so `minimumRangePercent` describes the final visible range.
  const paddedFactor = 1 + C.Y_AXIS_PADDING_RATIO * 2;
  const span = Math.max(rawMax - rawMin, (anchor * minimumRangePercent) / paddedFactor);
  const center = (rawMin + rawMax) / 2;
  const padding = span * C.Y_AXIS_PADDING_RATIO;
  return {
    lo: center - span / 2 - padding,
    hi: center + span / 2 + padding,
  };
}

/**
 * Target vertical range for the visible window. Always accommodates the
 * visible samples, the round open and the live price; enforces a minimum span
 * proportional to price (no over-zoom on a flat tape) and pads both ends.
 */
export function computeTargetRange({ visiblePrices, roundOpen, livePrice }: RangeInput): PriceRange | null {
  let visibleMin = Infinity;
  let visibleMax = -Infinity;
  for (const v of visiblePrices) {
    if (Number.isFinite(v)) {
      if (v < visibleMin) visibleMin = v;
      if (v > visibleMax) visibleMax = v;
    }
  }
  return rangeFromExtents({ visibleMin, visibleMax, roundOpen, livePrice });
}

/** One frame of expand-fast / shrink-slow smoothing for the displayed range. */
export function smoothRange(
  displayed: PriceRange,
  target: PriceRange,
  perfNow: number,
  shrinkAllowedAt: number,
): { range: PriceRange; shrinkAllowedAt: number } {
  let { lo, hi } = displayed;
  let nextShrinkAt = shrinkAllowedAt;
  const expanding = target.lo < lo || target.hi > hi;
  if (expanding) {
    nextShrinkAt = perfNow + C.Y_SCALE_SHRINK_DELAY_MS;
    if (target.lo < lo) lo += (target.lo - lo) * C.SCALE_EXPAND_LERP;
    if (target.hi > hi) hi += (target.hi - hi) * C.SCALE_EXPAND_LERP;
  } else if (perfNow >= shrinkAllowedAt) {
    lo += (target.lo - lo) * C.SCALE_SHRINK_LERP;
    hi += (target.hi - hi) * C.SCALE_SHRINK_LERP;
  }
  return { range: { lo, hi }, shrinkAllowedAt: nextShrinkAt };
}
