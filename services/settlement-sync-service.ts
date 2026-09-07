/**
 * Settlement sync bridge — mirrors the engine's authoritative (offshore) settle /
 * claim events into the CloudBase persistence layer (account wallet, orders,
 * settlements, leaderboard). The engine keeps running unchanged; this layer just
 * records the outcome so it survives across devices and feeds the leaderboard.
 *
 * Everything here is idempotent on the persistence side (upserts keyed by id),
 * and guarded against double-run per session via a synced-round set.
 */
import type { Order as EngineOrder, RoundRecord as EngineRound } from "@/lib/pulse5/engine/types";
import type { OrderRecord, RoundRecord, SettlementRecord } from "@/lib/domain/types";
import { getRepositories } from "@/repository";
import { claimSettlement } from "./wallet-service";
import { refreshStats } from "./leaderboard-service";

export function toRoundId(engineRoundId: number): string {
  return `BTCUSDT-${engineRoundId}`;
}

function toSettlementId(orderId: string): string {
  return `st-${orderId}`;
}

function toOrderRecord(order: EngineOrder, userId: string): OrderRecord {
  const status: OrderRecord["status"] =
    order.status === "OPEN" ? "OPEN" : order.status === "VOID" ? "VOID" : "SETTLED";
  return {
    _id: order.id,
    orderId: order.id,
    userId,
    roundId: toRoundId(order.roundId),
    idempotencyKey: order.idempotencyKey || order.id,
    side: order.side,
    stake: order.stake,
    lockedOdds: order.lockedOdds,
    potentialPayout: order.potentialPayout,
    entryPrice: order.priceAtEntry,
    placedAt: order.createdAt,
    status,
    payout: order.payout,
    profit: order.profit,
    settlementId: order.status === "OPEN" ? undefined : toSettlementId(order.id),
    createdAt: order.createdAt,
  };
}

function toRoundRecord(round: EngineRound): RoundRecord {
  return {
    _id: toRoundId(round.id),
    roundId: toRoundId(round.id),
    symbol: "BTCUSDT",
    startTime: round.startTime,
    endTime: round.endTime,
    openPrice: round.openPrice,
    closePrice: round.closePrice,
    result: round.result,
    status: round.status === "SETTLED" ? "SETTLED" : "OPEN",
    settledAt: round.settledAt,
    createdAt: round.createdAt,
  };
}

const syncedRounds = new Set<string>();

/** Called right after an engine bet is placed (registered users only). */
export async function syncBet(userId: string, order: EngineOrder): Promise<void> {
  const repos = getRepositories();
  await repos.placeOrder(userId, toOrderRecord(order, userId), Date.now());
}

/** Called once after a round settles (registered users only). */
export async function syncSettlement(
  userId: string,
  round: EngineRound,
  orders: EngineOrder[],
): Promise<void> {
  const roundId = toRoundId(round.id);
  if (syncedRounds.has(roundId)) return;
  syncedRounds.add(roundId);

  const repos = getRepositories();
  await repos.rounds.createRound(toRoundRecord(round));

  for (const o of orders) {
    await repos.orders.createOrder(toOrderRecord(o, userId));
    if (o.status !== "WON" && o.status !== "VOID") continue;
    const settlement: SettlementRecord = {
      _id: toSettlementId(o.id),
      settlementId: toSettlementId(o.id),
      userId,
      roundId,
      orderId: o.id,
      result: o.side === "up" ? "UP" : "DOWN",
      stake: o.stake,
      lockedOdds: o.lockedOdds,
      payout: o.payout,
      profit: o.profit,
      claimStatus: o.claimed ? "claimed" : "pending",
      settledAt: o.settledAt ?? Date.now(),
      claimedAt: o.claimed ? o.settledAt ?? Date.now() : null,
      createdAt: o.createdAt,
    };
    await repos.recordSettlement(settlement, Date.now());
  }
  await refreshStats(userId);
}

/** Called after an engine claim (registered users only). Best-effort idempotent. */
export async function syncClaim(userId: string, order: EngineOrder): Promise<void> {
  try {
    await claimSettlement(userId, toSettlementId(order.id));
    await refreshStats(userId);
  } catch {
    /* settlement not synced yet — ignore, claim stays consistent on the engine side */
  }
}
