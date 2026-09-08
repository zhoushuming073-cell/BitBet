import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
let Pulse5Engine;
let computeWeeklyStats;

before(async () => {
  ({ Pulse5Engine } = await vite.ssrLoadModule("/lib/pulse5/engine/Pulse5Engine.ts"));
  ({ computeWeeklyStats } = await vite.ssrLoadModule("/lib/pulse5/stats/weeklyStats.ts"));
});
after(async () => vite.close());

function settled(roundId, index, status, profit, settledAt) {
  const stake = Math.abs(profit) || 100;
  return {
    id: `${roundId}-${index}`, userId: "local", roundId, side: status === "WON" ? "up" : "down", stake,
    lockedOdds: 2, potentialPayout: stake * 2, priceAtEntry: 100000, pFairUpAtEntry: 0.5,
    pMarketUpAtEntry: 0.5, volatilityAtEntry: 0.0001, inventoryAtEntry: 0, priceImpactPercent: 0,
    quoteId: `q-${index}`, idempotencyKey: `k-${index}`, status, payout: status === "WON" ? stake + profit : 0,
    profit, claimed: true, createdAt: roundId + index, settledAt,
  };
}

test("weekly panel metrics come from settled orders and round-level equity events", () => {
  const engine = new Pulse5Engine(null);
  const orders = [
    settled(100_000, 1, "WON", 50, 200_000),
    settled(100_000, 2, "WON", 20, 200_000),
    settled(300_000, 3, "LOST", -40, 400_000),
    settled(300_000, 4, "LOST", -20, 400_000),
    settled(500_000, 5, "LOST", -10, 600_000),
    settled(700_000, 6, "WON", 50, 800_000),
  ];
  for (const order of orders) engine.ledger.addOrder(order);
  const stats = computeWeeklyStats(engine, 0, [50_000, 50_000, 250_000], 900_000);
  assert.equal(stats.orderCount, 6);
  assert.equal(stats.winRate, 50);
  assert.equal(stats.maxWinStreak, 2);
  assert.equal(stats.maxLossStreak, 3);
  assert.equal(stats.currentWinStreak, 1);
  assert.equal(stats.profit, 50);
  assert.ok(Math.abs(stats.maxDrawdownPercent - 0.7) < 1e-9);
  assert.equal(stats.skipCount, 2);
  assert.equal(stats.equityCurve.length, 6, "start + four settled rounds + current endpoint");
});
