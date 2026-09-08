import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(async () => vite.close());

test("Lambda probability is directional but deliberately bounded", async () => {
  const { signalToProbability } = await vite.ssrLoadModule("/lib/pulse5/bots/lambda/ProbabilityModel.ts");
  assert.ok(signalToProbability(1).up > 0.5);
  assert.ok(signalToProbability(-1).up < 0.5);
  assert.ok(signalToProbability(99).up <= 0.85 && signalToProbability(99).up >= 0.75);
  assert.ok(signalToProbability(-99).up >= 0.15 && signalToProbability(-99).up <= 0.25);
});

test("Lambda executes only positive edge and reduces stake after impact", async () => {
  const { findExecutableStake } = await vite.ssrLoadModule("/lib/pulse5/bots/lambda/ExecutionManager.ts");
  const { DEFAULT_LAMBDA_CONFIG } = await vite.ssrLoadModule("/lib/pulse5/bots/lambda/LambdaConfig.ts");
  const stakes = [];
  const result = findExecutableStake({
    availableBalance: 2000,
    estimateQuote: (_side, stake) => {
      stakes.push(stake);
      return { quotable: true, executionOdds: stake > 60 ? 1.5 : 2, potentialPayout: stake * 2 };
    },
  }, "up", 100, { up: 0.58, down: 0.42 }, { up: 0, down: 0, gross: 0, pnlIfUp: 0, pnlIfDown: 0, netSide: null, sameSideRun: 0 }, 2000, DEFAULT_LAMBDA_CONFIG);
  assert.ok(stakes.length > 1);
  assert.ok(result.stake < 100);
  assert.ok(result.edge >= DEFAULT_LAMBDA_CONFIG.minEdge);
});

test("Lambda config sanitizer caps user-controlled risk and conditions", async () => {
  const { sanitizeLambdaConfig } = await vite.ssrLoadModule("/lib/pulse5/bots/lambda/LambdaConfig.ts");
  const config = sanitizeLambdaConfig({ maxSingleOrderRatio: 1, maxRoundExposureRatio: 1, extraConditions: Array(9).fill({ field: "edge", operator: "gt", value: 0, join: "AND" }) });
  assert.equal(config.maxSingleOrderRatio, 0.06);
  assert.equal(config.maxRoundExposureRatio, 0.25);
  assert.equal(config.extraConditions.length, 4);
});

test("browser Lambda UI never receives future close or settlement fields", async () => {
  const fs = await import("node:fs/promises");
  const contract = await fs.readFile(`${root}/lib/pulse5/bots/BotStrategy.ts`, "utf8");
  const authority = await fs.readFile(`${root}/lib/pulse5/server/ServerAuthority.ts`, "utf8");
  assert.doesNotMatch(contract, /futurePrice|finalClose|settlementResult/);
  assert.match(authority, /priceSamples\.filter\(\(sample\) => sample\.time <= now\)/);
});

test("Lambda learns only once per settled round and parameter changes stay tiny", async () => {
  const { DEFAULT_LAMBDA_CONFIG } = await vite.ssrLoadModule("/lib/pulse5/bots/lambda/LambdaConfig.ts");
  const { defaultLambdaLearningState, learnFromSettledRound, MAX_PARAMETER_CHANGE_PER_ROUND } = await vite.ssrLoadModule("/lib/pulse5/bots/lambda/LambdaLearning.ts");
  const initial = defaultLambdaLearningState(DEFAULT_LAMBDA_CONFIG);
  const roundId = 1_800_000_000_000;
  const orders = [{ stake: 100, profit: -8, strategyMeta: { edge: 0.05, adaptiveHedge: false } }];
  const next = learnFromSettledRound(initial, roundId, orders, roundId + 300_000);
  assert.equal(next.exp, 10);
  assert.equal(next.totalRounds, 1);
  assert.equal(next.processedRoundIds.includes(roundId), true);
  assert.ok(Math.abs(next.config.minEdge - initial.config.minEdge) <= MAX_PARAMETER_CHANGE_PER_ROUND.minEdge + 1e-9);
  assert.ok(Math.abs(next.config.indicators[0].weight - initial.config.indicators[0].weight) <= MAX_PARAMETER_CHANGE_PER_ROUND.signalWeight + 1e-9);
  assert.strictEqual(learnFromSettledRound(next, roundId, orders, roundId + 300_000), next);
});

test("online tick owns Bot advancement while state stays read-mostly", async () => {
  const fs = await import("node:fs/promises");
  const stateRoute = await fs.readFile(`${root}/app/api/game/state/route.ts`, "utf8");
  const tickRoute = await fs.readFile(`${root}/app/api/game/tick/route.ts`, "utf8");
  const authority = await fs.readFile(`${root}/lib/pulse5/server/ServerAuthority.ts`, "utf8");
  const client = await fs.readFile(`${root}/components/pulse5/market-game.tsx`, "utf8");
  const migration = await fs.readFile(`${root}/drizzle/0001_lambda_learning.sql`, "utf8");
  assert.doesNotMatch(stateRoute, /tickAuthorityCompetition/);
  assert.match(tickRoute, /tickAuthorityCompetition/);
  assert.match(authority, /online-tick:\$\{userId\}/);
  assert.doesNotMatch(authority, /replayMissedRounds|replay-\$\{type\}/);
  assert.match(client, /refreshAuthority\(controller\.signal, true\)/);
  assert.match(migration, /lambda_learning_states/);
});
