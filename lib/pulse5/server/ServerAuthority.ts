import { BotAlphaStrategy } from "../bots/BotAlphaStrategy";
import { BotBetaStrategy } from "../bots/BotBetaStrategy";
import { BotLambdaStrategy } from "../bots/BotLambdaStrategy";
import { deriveBotDisplayState } from "../bots/BotDisplayState";
import { BOT_ALPHA_CONFIG, BOT_BETA_CONFIG } from "../bots/botConfig";
import type { BotDecisionContext, BotPastResult, BotStrategy } from "../bots/BotStrategy";
import { roundFor } from "../game/RoundEngine";
import { LedgerStore } from "../orders/LedgerStore";
import { Pulse5Engine } from "../engine/Pulse5Engine";
import type { LedgerSnapshot, Order, Side } from "../engine/types";
import { getClosedServerCandle, getHistoricalRoundMarket, getServerMarketSnapshot, type ServerMarketSnapshot } from "@/lib/game/market-price-provider";
import { ActorLedgerRepository, type ActorLedgerRecord, type ActorType, type D1Like } from "./ActorLedgerRepository";
import { getRuntimeDb } from "./runtime-db";

const BOT_INFO: Record<Exclude<ActorType, "player">, { name: string; shortName: string; label: string; interval: number; cooldown: number }> = {
  alpha: { name: "Bot Alpha", shortName: "A", label: "趋势跟随", interval: 1_250, cooldown: BOT_ALPHA_CONFIG.orderCooldownMs },
  beta: { name: "Bot Beta", shortName: "B", label: "均值回归", interval: 1_250, cooldown: BOT_BETA_CONFIG.orderCooldownMs },
  lambda: { name: "Bot Lambda", shortName: "λ", label: "Custom Quant", interval: 1_000, cooldown: 6_000 },
};

const REPLAY_STEP_MS = 5_000;
const MAX_REPLAY_ROUNDS = 12;

function actorId(userId: string, type: ActorType) { return `${userId}:${type}`; }

function recentResults(orders: Order[], currentRoundId: number): BotPastResult[] {
  const rows = new Map<number, BotPastResult>();
  for (const order of orders.filter((item) => item.roundId < currentRoundId && item.settledAt != null)) {
    const row = rows.get(order.roundId) ?? { roundId: order.roundId, profit: 0, settledAt: order.settledAt! };
    row.profit += order.profit;
    row.settledAt = Math.max(row.settledAt, order.settledAt!);
    rows.set(order.roundId, row);
  }
  return [...rows.values()].sort((a, b) => b.settledAt - a.settledAt).slice(0, 8);
}

function prepareEngine(record: ActorLedgerRecord, market: ServerMarketSnapshot, now: number) {
  const engine = new Pulse5Engine(new LedgerStore(null, record.snapshot));
  const round = roundFor(now);
  engine.setConnected(true);
  engine.seedVolatility(market.volatilityCloses);
  engine.setRoundOpen(round.id, market.roundOpen);
  engine.onBookTicker(market.bid, market.ask, market.observedAt);
  engine.onTrade(market.midPrice, market.observedAt);
  engine.seedChart(market.priceSamples.filter((sample) => sample.time <= now));
  engine.tick(now);
  return engine;
}

async function settleDue(engine: Pulse5Engine, now: number, autoClaim: boolean) {
  const due = [...new Set(engine.ledger.allOpenOrders().filter((order) => order.roundId < roundFor(now).id).map((order) => order.roundId))];
  for (const roundId of due.slice(-24)) {
    if (engine.ledger.isSettled(roundId)) continue;
    const candle = await getClosedServerCandle(roundId);
    if (candle) engine.settle(roundId, candle.open, candle.close, candle.closeTime);
  }
  if (autoClaim && engine.ledger.claimableBalance() > 0) engine.claimAll();
}

function strategyContext(engine: Pulse5Engine, market: ServerMarketSnapshot, now: number): BotDecisionContext | null {
  const view = engine.getView(now);
  if (!view.market || view.bettingState !== "OK") return null;
  const round = view.round;
  const orders = engine.ledger.openOrdersForRound(round.id);
  const last = orders[0] ?? null;
  const baseStake = Math.max(1, Math.min(500, Math.floor(view.balance * 0.04)));
  const up = engine.estimateQuote("up", baseStake, now);
  const down = engine.estimateQuote("down", baseStake, now);
  return {
    now,
    round: { id: round.id, start: round.start, lockTime: round.lockTime, end: round.end },
    currentPrice: market.midPrice,
    roundOpen: market.roundOpen,
    priceSamples: market.priceSamples.filter((sample) => sample.time <= now),
    executionOdds: { up: up?.quotable ? up.executionOdds : null, down: down?.quotable ? down.executionOdds : null },
    availableBalance: view.balance,
    recentResults: recentResults(engine.ledger.orders, round.id),
    openOrderCount: orders.length,
    lastOrderAt: last?.createdAt ?? null,
    lastOrderSide: last?.side ?? null,
    currentOrders: orders.map((order) => ({ ...order })),
    estimateQuote: (side, stake) => {
      const quote = engine.estimateQuote(side, stake, now);
      return quote ? { executionOdds: quote.executionOdds, potentialPayout: quote.potentialPayout, quotable: quote.quotable } : null;
    },
  };
}

async function saveWithRetry(
  repo: ActorLedgerRepository,
  actor: { userId: string; type: ActorType; displayName: string },
  mutate: (record: ActorLedgerRecord) => Promise<void>,
) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const record = await repo.load(actorId(actor.userId, actor.type), actor.userId, actor.type, actor.displayName);
    await mutate(record);
    if (await repo.save(record)) return record;
  }
  throw new Error("账本正在更新，请重试");
}

async function advanceActor(
  repo: ActorLedgerRepository,
  userId: string,
  type: Exclude<ActorType, "player">,
  market: ServerMarketSnapshot,
  now: number,
) {
  const info = BOT_INFO[type];
  return saveWithRetry(repo, { userId, type, displayName: info.name }, async (record) => {
    await replayMissedRounds(repo, record, type, now);
    const engine = prepareEngine(record, market, now);
    await settleDue(engine, now, true);
    const currentRound = roundFor(now).id;
    if (record.runtime.observedRoundId !== currentRound) {
      const previous = record.runtime.observedRoundId;
      if (previous && !engine.ledger.orders.some((order) => order.roundId === previous)) {
        record.runtime.skippedRoundIds = [...new Set([...record.runtime.skippedRoundIds, previous])].slice(-500);
      }
      record.runtime.observedRoundId = currentRound;
    }
    if (now - record.runtime.lastEvaluatedAt >= info.interval) {
      const lambdaConfig = type === "lambda" ? await repo.getLambdaConfig(userId) : null;
      const strategy: BotStrategy = type === "alpha"
        ? new BotAlphaStrategy()
        : type === "beta" ? new BotBetaStrategy() : new BotLambdaStrategy(lambdaConfig!);
      const context = strategyContext(engine, market, now);
      const latestOrder = engine.ledger.openOrdersForRound(currentRound)[0];
      const decision = context && (!latestOrder || now - latestOrder.createdAt >= info.cooldown)
        ? strategy.decide(context)
        : null;
      record.runtime.lastEvaluatedAt = now;
      if (decision?.action === "UP" || decision?.action === "DOWN") {
        record.runtime.orderSequence += 1;
        try {
          engine.placeOrder(
            decision.action === "UP" ? "up" : "down",
            decision.stake,
            `server-${type}-${currentRound}-${now}-${record.runtime.orderSequence}`,
            now,
            decision.reason,
            decision.meta,
          );
          record.runtime.lastAction = decision.reason;
        } catch {
          record.runtime.lastAction = "信号存在，等待执行条件";
        }
      } else if (decision) {
        record.runtime.lastAction = decision.reason;
      }
    }
    record.snapshot = engine.ledger.snapshot();
  });
}

async function replayMissedRounds(
  repo: ActorLedgerRepository,
  record: ActorLedgerRecord,
  type: Exclude<ActorType, "player">,
  now: number,
) {
  if (!record.runtime.lastEvaluatedAt) return;
  const currentRoundId = roundFor(now).id;
  const firstMissed = roundFor(record.runtime.lastEvaluatedAt).id + 5 * 60 * 1000;
  if (firstMissed >= currentRoundId) return;
  const first = Math.max(firstMissed, currentRoundId - MAX_REPLAY_ROUNDS * 5 * 60 * 1000);
  const lambdaConfig = type === "lambda" ? await repo.getLambdaConfig(record.ownerUserId) : null;
  const strategy: BotStrategy = type === "alpha"
    ? new BotAlphaStrategy()
    : type === "beta" ? new BotBetaStrategy() : new BotLambdaStrategy(lambdaConfig!);

  for (let roundId = first; roundId < currentRoundId; roundId += 5 * 60 * 1000) {
    const historical = await getHistoricalRoundMarket(roundId);
    if (!historical) continue;
    const engine = new Pulse5Engine(new LedgerStore(null, record.snapshot));
    engine.setConnected(true);
    engine.setRoundOpen(roundId, historical.open);
    engine.seedVolatility(historical.samples.filter((_, index) => index % 60 === 0).map((sample) => sample.price));
    for (let index = 20; index < historical.samples.length; index += Math.max(1, REPLAY_STEP_MS / 1000)) {
      const prefix = historical.samples.slice(Math.max(0, index - 70), index + 1);
      const sample = prefix.at(-1)!;
      if (sample.time >= historical.round.lockTime) break;
      engine.onBookTicker(sample.price - 0.5, sample.price + 0.5, sample.time);
      engine.onTrade(sample.price, sample.time);
      engine.seedChart(prefix);
      engine.tick(sample.time);
      const replayMarket: ServerMarketSnapshot = {
        midPrice: sample.price,
        bid: sample.price - 0.5,
        ask: sample.price + 0.5,
        observedAt: sample.time,
        roundOpen: historical.open,
        volatilityCloses: prefix.filter((_, position) => position % 60 === 0).map((point) => point.price),
        priceSamples: prefix,
      };
      const context = strategyContext(engine, replayMarket, sample.time);
      const latestOrder = engine.ledger.openOrdersForRound(roundId)[0];
      const decision = context && (!latestOrder || sample.time - latestOrder.createdAt >= BOT_INFO[type].cooldown)
        ? strategy.decide(context)
        : null;
      record.runtime.lastEvaluatedAt = sample.time;
      if (decision?.action !== "UP" && decision?.action !== "DOWN") {
        if (decision) record.runtime.lastAction = decision.reason;
        continue;
      }
      record.runtime.orderSequence += 1;
      try {
        engine.placeOrder(
          decision.action === "UP" ? "up" : "down",
          decision.stake,
          `replay-${type}-${roundId}-${sample.time}-${record.runtime.orderSequence}`,
          sample.time,
          decision.reason,
          decision.meta,
        );
        record.runtime.lastAction = decision.reason;
      } catch { /* execution gate remains authoritative */ }
    }
    if (!engine.ledger.orders.some((order) => order.roundId === roundId)) {
      record.runtime.skippedRoundIds = [...new Set([...record.runtime.skippedRoundIds, roundId])].slice(-500);
    }
    engine.settle(roundId, historical.open, historical.close, historical.closeTime);
    engine.claimAll();
    record.snapshot = engine.ledger.snapshot();
    record.runtime.observedRoundId = roundId;
    record.runtime.lastEvaluatedAt = historical.round.end;
  }
}

async function advancePlayer(repo: ActorLedgerRepository, userId: string, displayName: string, market: ServerMarketSnapshot, now: number) {
  return saveWithRetry(repo, { userId, type: "player", displayName }, async (record) => {
    const engine = prepareEngine(record, market, now);
    await settleDue(engine, now, false);
    record.snapshot = engine.ledger.snapshot();
  });
}

export interface AuthorityBotState {
  id: "alpha" | "beta" | "lambda";
  name: string;
  shortName: string;
  label: string;
  snapshot: LedgerSnapshot;
  lastAction: string;
  status: ReturnType<typeof deriveBotDisplayState>;
  skippedRoundIds: number[];
}

export async function getAuthorityCompetition(userId: string, displayName = "你", db: D1Like | null = getRuntimeDb(), devMarketPrice?: number) {
  const now = Date.now();
  const repo = new ActorLedgerRepository(db);
  const market = await getServerMarketSnapshot(now, devMarketPrice);
  const [player, alpha, beta, lambda, lambdaConfig] = await Promise.all([
    advancePlayer(repo, userId, displayName, market, now),
    advanceActor(repo, userId, "alpha", market, now),
    advanceActor(repo, userId, "beta", market, now),
    advanceActor(repo, userId, "lambda", market, now),
    repo.getLambdaConfig(userId),
  ]);
  const bots = [alpha, beta, lambda].map((record) => {
    const type = record.actorType as Exclude<ActorType, "player">;
    const info = BOT_INFO[type];
    const results = recentResults(record.snapshot.orders, roundFor(now).id);
    return {
      id: type,
      name: info.name,
      shortName: info.shortName,
      label: info.label,
      snapshot: record.snapshot,
      lastAction: record.runtime.lastAction,
      status: deriveBotDisplayState(type, results, record.runtime.lastAction, false),
      skippedRoundIds: record.runtime.skippedRoundIds,
    } satisfies AuthorityBotState;
  });
  return { player: player.snapshot, bots, lambdaConfig, serverTime: now };
}

export async function placeAuthorityOrder(
  userId: string,
  displayName: string,
  side: Side,
  stake: number,
  idempotencyKey: string,
  db: D1Like | null = getRuntimeDb(),
  devMarketPrice?: number,
) {
  const now = Date.now();
  const repo = new ActorLedgerRepository(db);
  const market = await getServerMarketSnapshot(now, devMarketPrice);
  const record = await saveWithRetry(repo, { userId, type: "player", displayName }, async (row) => {
    const engine = prepareEngine(row, market, now);
    await settleDue(engine, now, false);
    engine.placeOrder(side, stake, idempotencyKey, now);
    row.snapshot = engine.ledger.snapshot();
  });
  const order = record.snapshot.orders.find((item) => item.idempotencyKey === idempotencyKey);
  if (!order) throw new Error("订单保存失败");
  return { order, snapshot: record.snapshot };
}

export async function claimAuthorityOrder(userId: string, orderId: string, db: D1Like | null = getRuntimeDb()) {
  const repo = new ActorLedgerRepository(db);
  const record = await saveWithRetry(repo, { userId, type: "player", displayName: "你" }, async (row) => {
    const engine = new Pulse5Engine(new LedgerStore(null, row.snapshot));
    engine.claimOrder(orderId);
    row.snapshot = engine.ledger.snapshot();
  });
  return record.snapshot;
}

export async function claimAuthorityAll(userId: string, db: D1Like | null = getRuntimeDb()) {
  const repo = new ActorLedgerRepository(db);
  const record = await saveWithRetry(repo, { userId, type: "player", displayName: "你" }, async (row) => {
    const engine = new Pulse5Engine(new LedgerStore(null, row.snapshot));
    engine.claimAll();
    row.snapshot = engine.ledger.snapshot();
  });
  return record.snapshot;
}

export async function getAuthorityLambdaConfig(userId: string, db: D1Like | null = getRuntimeDb()) {
  return new ActorLedgerRepository(db).getLambdaConfig(userId);
}

export async function saveAuthorityLambdaConfig(userId: string, value: unknown, db: D1Like | null = getRuntimeDb()) {
  return new ActorLedgerRepository(db).saveLambdaConfig(userId, value);
}

export async function advanceAllCompetitions(db: D1Like | null = getRuntimeDb()) {
  const repo = new ActorLedgerRepository(db);
  if (!await repo.acquireLease("global-bot-tick", 15_000)) return;
  const owners = await repo.listOwners();
  await Promise.allSettled(owners.slice(0, 100).map((userId) => getAuthorityCompetition(userId, "你", db)));
}
