import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});

let scale;
before(async () => {
  scale = await vite.ssrLoadModule("/components/pulse5/chartScale.ts");
});
after(async () => {
  await vite.close();
});

test("Case 1: ordinary tape keeps every visible price inside the range", () => {
  const r = scale.computeTargetRange({ visiblePrices: [100000, 100075, 100150], roundOpen: 100000, livePrice: 100150 });
  assert.ok(r.lo <= 100000, "low visible price must be in range");
  assert.ok(r.hi >= 100150, "high visible price must be in range");
});

test("Case 2: tiny 1-2 USD wiggle is not over-zoomed (minimum range enforced)", () => {
  const r = scale.computeTargetRange({ visiblePrices: [99999, 100000, 100001], roundOpen: 100000, livePrice: 100000 });
  assert.ok(r.hi - r.lo >= 100000 * 0.0004, "span must be at least 0.04% of price");
  assert.ok(r.lo <= 99999 && r.hi >= 100001, "extremes still visible");
});

test("mobile display floor keeps a tiny BTC wiggle inside a 0.12% viewport", () => {
  const r = scale.rangeFromExtents({
    visibleMin: 99999,
    visibleMax: 100001,
    roundOpen: 100000,
    livePrice: 100000,
    minimumRangePercent: 0.0012,
  });
  assert.ok(r.hi - r.lo >= 120 - 1e-9, "mobile span must be at least 0.12% of price");
  assert.ok(r.lo <= 99999 && r.hi >= 100001, "real extremes still remain visible");
});

test("Case 3: sudden spike is immediately included in the target range", () => {
  const r = scale.computeTargetRange({ visiblePrices: [100000, 100120, 100500], roundOpen: 100000, livePrice: 100500 });
  assert.ok(r.hi >= 100500);
  assert.ok(r.lo <= 100000);
});

test("round-open line stays in range even if it scrolled off the visible samples", () => {
  const r = scale.computeTargetRange({ visiblePrices: [100100, 100110], roundOpen: 99900, livePrice: 100110 });
  assert.ok(r.lo <= 99900, "round open must always be accommodated");
});

test("Case 6: lowerBound implements the sliding 1-minute window", () => {
  const pts = [0, 30, 60, 90, 120, 150].map((s) => ({ time: 1_000_000 + s * 1000, price: 100000 }));
  // Window 60s wide ending at t=90s: first visible sample is t=30s.
  const idx = scale.lowerBound(pts, 1_000_000 + 30_000);
  assert.equal(pts[idx].time, 1_000_000 + 30_000);
  // Slide forward 60s: first visible sample becomes t=90s.
  const idx2 = scale.lowerBound(pts, 1_000_000 + 90_000);
  assert.equal(pts[idx2].time, 1_000_000 + 90_000);
});

test("Y-scale expands fast", () => {
  const displayed = { lo: 100000, hi: 100100 };
  const target = { lo: 100000, hi: 100200 }; // needs upward expand
  const now = 5000;
  const out = scale.smoothRange(displayed, target, now, 0);
  assert.ok(out.range.hi > 100100, "upper bound must move toward the spike immediately");
  assert.equal(out.shrinkAllowedAt, now + 1000, "expansion defers any shrink by the hysteresis delay");
});

test("Y-scale refuses to shrink before the calm delay, then shrinks slowly", () => {
  const displayed = { lo: 100000, hi: 100200 };
  const target = { lo: 100040, hi: 100160 }; // calmer, wants to contract
  // Shrink only allowed starting at t=2000; at t=1000 it must hold still.
  const held = scale.smoothRange(displayed, target, 1000, 2000);
  assert.equal(held.range.hi, 100200, "no contraction during the hysteresis window");
  assert.equal(held.range.lo, 100000);
  // After the delay it eases only a small step (slow shrink).
  const eased = scale.smoothRange(displayed, target, 2001, 2000);
  assert.ok(eased.range.hi < 100200 && eased.range.hi > target.hi, "slow partial contraction");
});
