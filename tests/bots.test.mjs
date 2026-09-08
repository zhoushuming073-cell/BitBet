import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(async () => vite.close());

function contextFor(roundId, prices, progress) {
  const duration = 300_000;
  const now = roundId + duration * progress;
  const step = 36_000 / (prices.length - 1);
  return {
    now,
    round: { id: roundId, start: roundId, lockTime: roundId + 285_000, end: roundId + duration },
    currentPrice: prices.at(-1),
    roundOpen: prices[0],
    priceSamples: prices.map((price, index) => ({ time: now - 36_000 + step * index, price })),
    executionOdds: { up: 1.8, down: 2.1 },
    availableBalance: 10_000,
    recentResults: [],
    openOrderCount: 0,
    lastOrderAt: null,
    lastOrderSide: null,
  };
}

test("Bot Alpha follows an observable short-term trend with bounded risk", async () => {
  const { BotAlphaStrategy } = await vite.ssrLoadModule("/lib/pulse5/bots/BotAlphaStrategy.ts");
  const strategy = new BotAlphaStrategy();
  const prices = Array.from({ length: 25 }, (_, index) => 100_000 + index * 5);
  let decision;
  for (let index = 0; index < 30 && decision?.action !== "UP"; index += 1) {
    decision = strategy.decide(contextFor(1_800_000_000_000 + index * 300_000, prices, 0.4));
  }
  assert.equal(decision.action, "UP");
  assert.ok(decision.stake >= 300 && decision.stake <= 700);
  assert.ok(decision.confidence >= 0 && decision.confidence <= 1);
  assert.ok(["短线动量增强", "趋势仍然有效"].includes(decision.reason));
});

test("Bot Beta fades a visible spike only after momentum slows", async () => {
  const { BotBetaStrategy } = await vite.ssrLoadModule("/lib/pulse5/bots/BotBetaStrategy.ts");
  const strategy = new BotBetaStrategy();
  const prices = [
    100_000, 100_008, 100_016, 100_025, 100_035, 100_046, 100_058, 100_070,
    100_082, 100_094, 100_106, 100_118, 100_130, 100_141, 100_151, 100_160,
    100_168, 100_174, 100_179, 100_183, 100_186, 100_188, 100_189, 100_188, 100_187,
  ];
  let decision;
  for (let index = 0; index < 40 && decision?.action !== "DOWN"; index += 1) {
    decision = strategy.decide(contextFor(1_810_000_000_000 + index * 300_000, prices, 0.45));
  }
  assert.equal(decision.action, "DOWN");
  assert.ok(decision.stake >= 200 && decision.stake <= 500);
  assert.ok(["价格偏离均值", "动量开始衰减"].includes(decision.reason));
});

test("bot display states use only recent outcomes and current legal state", async () => {
  const { deriveBotDisplayState } = await vite.ssrLoadModule("/lib/pulse5/bots/BotDisplayState.ts");
  const wins = [{ roundId: 2, profit: 10, settledAt: 2 }, { roundId: 1, profit: 8, settledAt: 1 }];
  const losses = [{ roundId: 2, profit: -10, settledAt: 2 }, { roundId: 1, profit: -8, settledAt: 1 }];
  assert.equal(deriveBotDisplayState("alpha", wins, "趋势仍然有效", false), "HOT");
  assert.equal(deriveBotDisplayState("alpha", losses, "等待趋势形成", false), "CAUTIOUS");
  assert.equal(deriveBotDisplayState("beta", [], "继续等待偏离扩大", false), "WAITING");
  assert.equal(deriveBotDisplayState("beta", [], "动量开始衰减", true), "COOLDOWN");
});

test("Bot strategy context has no future close or current settlement result", async () => {
  const { BotAlphaStrategy } = await vite.ssrLoadModule("/lib/pulse5/bots/BotAlphaStrategy.ts");
  const strategy = new BotAlphaStrategy();
  const context = contextFor(1_820_000_000_000, Array.from({ length: 20 }, (_, i) => 90_000 + i), 0.4);
  assert.equal("closePrice" in context, false);
  assert.equal("settlementResult" in context, false);
  assert.doesNotThrow(() => strategy.decide(context));
});

test("Bot execution is server-authoritative and the browser only mirrors snapshots", async () => {
  const fs = await import("node:fs/promises");
  const hook = await fs.readFile(`${root}/components/pulse5/use-trading-bots.ts`, "utf8");
  const authority = await fs.readFile(`${root}/lib/pulse5/server/ServerAuthority.ts`, "utf8");
  const contract = await fs.readFile(`${root}/lib/pulse5/bots/BotStrategy.ts`, "utf8");
  assert.doesNotMatch(hook, /\.placeOrder\(/);
  assert.match(hook, /restoreLedger\(payload\.snapshot\)/);
  assert.match(authority, /engine\.placeOrder\(/);
  assert.doesNotMatch(hook, /ledger\.balance\s*=/);
  assert.doesNotMatch(contract, /closePrice|settlementResult|futurePrice/);
});

test("bots may place multiple mixed-direction orders in one round with unique keys", async () => {
  const fs = await import("node:fs/promises");
  const authority = await fs.readFile(`${root}/lib/pulse5/server/ServerAuthority.ts`, "utf8");
  const alpha = await fs.readFile(`${root}/lib/pulse5/bots/BotAlphaStrategy.ts`, "utf8");
  const beta = await fs.readFile(`${root}/lib/pulse5/bots/BotBetaStrategy.ts`, "utf8");
  assert.doesNotMatch(authority, /actedRounds/);
  assert.match(authority, /orderSequence/);
  assert.match(authority, /cooldown/);
  assert.match(authority, /server-\$\{type\}-\$\{currentRound\}-\$\{now\}-\$\{record\.runtime\.orderSequence\}/);
  assert.doesNotMatch(alpha, /hasOpenOrder/);
  assert.doesNotMatch(beta, /hasOpenOrder/);
});

test("weekly competition exposes no player reset control", async () => {
  const fs = await import("node:fs/promises");
  const page = await fs.readFile(`${root}/components/pulse5/market-game.tsx`, "utf8");
  assert.doesNotMatch(page, /resetGame|reset-button|重置我的虚拟余额/);
});

test("bot-only rounds use an official closed candle for settlement", async () => {
  const fs = await import("node:fs/promises");
  const authority = await fs.readFile(`${root}/lib/pulse5/server/ServerAuthority.ts`, "utf8");
  assert.match(authority, /getClosedServerCandle\(roundId\)/);
  assert.match(authority, /engine\.settle\(roundId, candle\.open, candle\.close, candle\.closeTime\)/);
  assert.match(authority, /allOpenOrders\(\)/);
});

test("mobile competition combines player and bot open orders in tabs", async () => {
  const fs = await import("node:fs/promises");
  const tabs = await fs.readFile(`${root}/components/pulse5/mobile-competition-tabs.tsx`, "utf8");
  assert.match(tabs, /playerOrders\.map/);
  assert.match(tabs, /bot\.view\.openOrders/);
  assert.match(tabs, /实时交易单/);
  assert.match(tabs, /最近结果/);
  assert.match(tabs, /本周排行/);
  assert.match(tabs, /order\.reason/);
  assert.match(tabs, /bot\.status/);
});

test("rank and streak notices compare against prior state before showing", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(`${root}/components/pulse5/competition-notice.tsx`, "utf8");
  assert.match(source, /previousRef/);
  assert.match(source, /after\.wins >= 3 && after\.wins > before\.wins/);
  assert.match(source, /current\.playerRank < previous\.playerRank/);
});
