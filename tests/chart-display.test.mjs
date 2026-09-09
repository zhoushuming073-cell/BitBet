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

let display;
before(async () => {
  display = await vite.ssrLoadModule("/components/pulse5/chartDisplay.ts");
});
after(async () => {
  await vite.close();
});

function series(mapPrice) {
  const start = 1_000_000;
  return Array.from({ length: 301 }, (_, i) => ({ time: start + i * 200, price: mapPrice(i) }));
}

test("200ms raw ticks become 60-100 mobile visual points without mutating input", () => {
  const raw = series((i) => 100000 + Math.sin(i / 8) * 3);
  const snapshot = structuredClone(raw);
  const result = display.buildMobileDisplaySeries(raw, 1_000_000, 1_060_000, raw.at(-1).price);
  assert.ok(result.points.length >= 60 && result.points.length <= 100, `got ${result.points.length} visual points`);
  assert.deepEqual(raw, snapshot, "display processing must never mutate raw market samples");
  assert.equal(result.points.at(-1).price, raw.at(-1).price, "final point must be the real latest price");
});

test("micro-chop receives stronger aggregation and lowers visual path noise", () => {
  const raw = series((i) => 100000 + (i % 2 === 0 ? 2 : -2));
  const result = display.buildMobileDisplaySeries(raw, 1_000_000, 1_060_000, raw.at(-1).price);
  assert.equal(result.texture.microChop, true);
  assert.equal(result.bucketMs, 1000);
  assert.ok(result.points.length <= 62, "a full minute of chop should render around 60 points");
  const path = (points) => points.slice(1).reduce((sum, point, i) => sum + Math.abs(point.price - points[i].price), 0);
  assert.ok(path(result.points) < path(raw) * 0.15, "display-only smoothing should substantially reduce woven noise");
});

test("a true directional move uses faster sampling, light smoothing, and an exact endpoint", () => {
  const raw = series((i) => 100000 + i * 0.8);
  const result = display.buildMobileDisplaySeries(raw, 1_000_000, 1_060_000, raw.at(-1).price);
  assert.equal(result.texture.strongMove, true);
  assert.equal(result.bucketMs, 625);
  assert.ok(result.emaAlpha >= 0.8, "trend mode should stay responsive");
  assert.ok(result.points.length >= 90 && result.points.length <= 100);
  assert.equal(result.points.at(-1).price, raw.at(-1).price);
});

test("mobile display does not draw a misleading diagonal line across a stale-feed gap", () => {
  assert.equal(
    display.shouldConnectDisplayPoints({ time: 1_000, price: 100 }, { time: 4_500, price: 101 }),
    true,
  );
  assert.equal(
    display.shouldConnectDisplayPoints({ time: 1_000, price: 100 }, { time: 5_500, price: 101 }),
    false,
  );
});
