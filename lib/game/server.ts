import { getServerMarketSnapshot } from "@/lib/game/market-price-provider";
import { createServerEngine } from "@/lib/pulse5/engine/createServerEngine";
import { roundFor } from "@/lib/pulse5/game/RoundEngine";
import { LedgerStore } from "@/lib/pulse5/orders/LedgerStore";
import type { GameStateStoreFactory } from "@/lib/pulse5/orders/GameStateStore";
import type { LedgerSnapshot, Order, Side } from "@/lib/pulse5/engine/types";
import type { OrderRecord, RoundRecord, SettlementRecord } from "@/lib/domain/types";
import { getServerRepositories } from "@/repository/server";
import { refreshLeaderboardStats } from "@/services/leaderboard-stats-service";

interface EngineEntry {
  engine: ReturnType<typeof createServerEngine>;
  warmed: boolean;
  openedRounds: Set<number>;
}

const engines = new Map<string, EngineEntry>();
let stateFactory: GameStateStoreFactory | null = null;

export function configureGameStateStoreFactory(factory: GameStateStoreFactory): void {
  if (process.env.NODE_ENV === "production" && !factory.durable) {
    throw new Error("生产环境拒绝非持久化 GameStateStoreFactory");
  }
  stateFactory = factory;
}

function createEntry(userId: string, snapshot?: LedgerSnapshot): EngineEntry {
  if (process.env.NODE_ENV === "production" && !stateFactory?.durable) {
    throw new Error("生产环境必须配置持久化 GameStateStore（SQLite/Redis 等适配器）");
  }
  const store = stateFactory?.forUser(userId) ?? new LedgerStore(null, snapshot);
  return { engine: createServerEngine(store), warmed: false, openedRounds: new Set() };
}

function entryFor(userId: string): EngineEntry {
  let entry = engines.get(userId);
  if (!entry) {
    entry = createEntry(userId);
    engines.set(userId, entry);
  }
  return entry;
}

function rollback(userId: string, snapshot: LedgerSnapshot, previous: EngineEntry): void {
  const restored = createEntry(userId, snapshot);
  restored.warmed = previous.warmed;
  restored.openedRounds = new Set(previous.openedRounds);
  engines.set(userId, restored);
}

function toOrderRecord(order: Order, userId: string): OrderRecord {
  return {
    _id: order.id,
    orderId: order.id,
    userId,
    roundId: `BTCUSDT-${order.roundId}`,
    idempotencyKey: order.idempotencyKey || order.id,
    side: order.side,
    stake: order.stake,
    lockedOdds: order.lockedOdds,
    potentialPayout: order.potentialPayout,
    entryPrice: order.priceAtEntry,
    placedAt: order.createdAt,
    status: order.status === "OPEN" ? "OPEN" : order.status === "VOID" ? "VOID" : "SETTLED",
    payout: order.payout,
    profit: order.profit,
    settlementId: order.status === "OPEN" ? undefined : `st-${order.id}`,
    createdAt: order.createdAt,
  };
}

export async function placeOrder(
  userId: string,
  side: Side,
  stake: number,
  idempotencyKey: string,
  devClientPrice?: number,
): Promise<{ order: Order; balance: number }> {
  const now = Date.now();
  const market = await getServerMarketSnapshot(now, devClientPrice);
  const entry = entryFor(userId);
  const before = entry.engine.ledger.snapshot();
  const wallet = await getServerRepositories().wallets.getWallet(userId);
  if (!wallet) throw new Error("正式账户钱包不存在");
  entry.engine.ledger.balance = wallet.availableBalance;
  try {
    if (!entry.warmed) {
      if (market.volatilityCloses.length < 20) throw new Error("服务端波动率样本不足");
      entry.engine.setConnected(true);
      entry.engine.seedVolatility(market.volatilityCloses);
      entry.warmed = true;
    }
    const round = roundFor(now);
    if (!entry.openedRounds.has(round.id)) {
      entry.engine.setRoundOpen(round.id, market.roundOpen);
      entry.openedRounds.add(round.id);
    }
    entry.engine.onBookTicker(market.bid, market.ask, market.observedAt);
    entry.engine.onTrade(market.midPrice, market.observedAt);
    const order = entry.engine.placeOrder(side, stake, idempotencyKey, now);
    const roundRecord: RoundRecord = {
      _id: `BTCUSDT-${round.id}`,
      roundId: `BTCUSDT-${round.id}`,
      symbol: "BTCUSDT",
      startTime: round.start,
      endTime: round.end,
      openPrice: market.roundOpen,
      closePrice: null,
      result: null,
      status: "OPEN",
      settledAt: null,
      createdAt: now,
    };
    const repos = getServerRepositories();
    await repos.rounds.createRound(roundRecord);
    const persisted = await repos.placeOrder(userId, toOrderRecord(order, userId), now);
    return { order, balance: persisted.wallet.availableBalance };
  } catch (error) {
    rollback(userId, before, entry);
    throw error;
  }
}

export async function claimOrder(userId: string, orderId: string): Promise<number> {
  const result = await getServerRepositories().claim(userId, `st-${orderId}`, Date.now());
  if (!result.alreadyClaimed) entryFor(userId).engine.claimOrder(orderId);
  return result.amount;
}

export async function claimAll(userId: string): Promise<number> {
  const result = await getServerRepositories().claimAll(userId, Date.now());
  if (result.count > 0) entryFor(userId).engine.claimAll();
  return result.amount;
}

export async function settle(userId: string, roundId: number, openPrice: number, closePrice: number) {
  const now = Date.now();
  const entry = entryFor(userId);
  const outcome = entry.engine.settle(roundId, openPrice, closePrice, now);
  if (outcome.alreadySettled) return outcome;
  const repos = getServerRepositories();
  const round = entry.engine.ledger.getRound(roundId);
  if (!round) throw new Error("round not found after settlement");
  await repos.rounds.createRound({
    _id: `BTCUSDT-${roundId}`,
    roundId: `BTCUSDT-${roundId}`,
    symbol: "BTCUSDT",
    startTime: round.startTime,
    endTime: round.endTime,
    openPrice,
    closePrice,
    result: round.result,
    status: "SETTLED",
    settledAt: now,
    createdAt: round.createdAt,
  });
  for (const order of entry.engine.ledger.orders.filter((item) => item.roundId === roundId)) {
    await repos.orders.createOrder(toOrderRecord(order, userId));
    if (order.status !== "WON" && order.status !== "VOID") continue;
    const settlement: SettlementRecord = {
      _id: `st-${order.id}`,
      settlementId: `st-${order.id}`,
      userId,
      roundId: `BTCUSDT-${roundId}`,
      orderId: order.id,
      result: round.result ?? "DRAW",
      stake: order.stake,
      lockedOdds: order.lockedOdds,
      payout: order.status === "VOID" ? order.stake : order.payout,
      profit: order.profit,
      claimStatus: order.claimed ? "claimed" : "pending",
      settledAt: order.settledAt ?? now,
      claimedAt: order.claimed ? now : null,
      createdAt: order.createdAt,
    };
    await repos.recordSettlement(settlement, now);
  }
  await refreshLeaderboardStats(userId, repos);
  return outcome;
}

export async function getState(userId: string) {
  const entry = entryFor(userId);
  const wallet = await getServerRepositories().wallets.getWallet(userId);
  if (!wallet) throw new Error("正式账户钱包不存在");
  return {
    balance: wallet.availableBalance,
    claimable: wallet.pendingClaim,
    openOrders: entry.engine.ledger.allOpenOrders().map((order) => ({ ...order })),
    settledOrders: entry.engine.ledger.orders.filter((order) => order.status !== "OPEN").map((order) => ({ ...order })),
  };
}
