import type { PricePointLike } from "../engine/types";
import type { AggTrade } from "./OkxFeedManager";

/**
 * Rolling price-buffer utilities. One unified buffer feeds the chart: initial
 * REST history + live WebSocket trades merge into a single time-sorted array.
 *
 * The chart still renders only VISIBLE_WINDOW_SECONDS (60s); we keep a slightly
 * longer buffer so clock drift / reconnect / REST↔WS hand-off never leave the
 * viewport momentarily empty.
 */
export const BUFFER_WINDOW_MS = 90_000;

/** Normalize exchange timestamps to milliseconds. */
export function normalizeTimestamp(ts: number): number {
  if (!Number.isFinite(ts)) return 0;
  return ts < 1e12 ? ts * 1000 : ts;
}

/**
 * Merge two price-point arrays into one stable, time-ascending buffer:
 * 1. normalize timestamps
 * 2. drop non-finite / non-positive prices
 * 3. drop points older than the buffer window
 * 4. sort ascending
 * 5. dedup identical timestamps (keep the latest price)
 */
export function mergePricePoints(
  oldPoints: PricePointLike[],
  incoming: PricePointLike[],
): PricePointLike[] {
  const cutoff = Date.now() - BUFFER_WINDOW_MS;
  const merged = [...oldPoints, ...incoming]
    .map((p) => ({ time: normalizeTimestamp(p.time), price: p.price }))
    .filter((p) => Number.isFinite(p.price) && p.price > 0 && p.time >= cutoff)
    .sort((a, b) => a.time - b.time);

  const result: PricePointLike[] = [];
  for (const p of merged) {
    const last = result[result.length - 1];
    if (last && p.time === last.time) {
      // Same timestamp → the later entry (incoming) wins, so keep its price.
      result[result.length - 1] = p;
    } else {
      result.push(p);
    }
  }
  return result;
}

/**
 * Bucket raw aggTrades into fixed time windows. Each bucket emits one point at
 * the last trade's timestamp / price inside that window, giving a ~200-250ms
 * dense history that matches the live 200ms sampling cadence.
 */
export function bucketAggTrades(trades: AggTrade[], bucketMs = 250): PricePointLike[] {
  if (!trades.length) return [];

  const points: PricePointLike[] = [];
  let currentBucket = -1;
  let lastPrice = 0;
  let lastTime = 0;

  const flush = () => {
    if (lastPrice > 0) points.push({ time: lastTime, price: lastPrice });
  };

  for (const t of trades) {
    const time = normalizeTimestamp(t.T);
    const price = Number(t.p);
    if (!Number.isFinite(price) || price <= 0 || time <= 0) continue;
    const bucket = Math.floor(time / bucketMs) * bucketMs;
    if (currentBucket !== -1 && bucket !== currentBucket) flush();
    currentBucket = bucket;
    lastPrice = price;
    lastTime = time;
  }
  flush();
  return points;
}
