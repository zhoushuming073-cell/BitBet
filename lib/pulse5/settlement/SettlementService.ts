import type { Order, RoundResult, RoundPortfolioSummary } from "../engine/types";
import { money, type LedgerStore } from "../orders/LedgerStore";

export interface SettleInput {
  ledger: LedgerStore;
  roundId: number;
  /** Official 5m kline open/close (settlement is separate from live odds). */
  openPrice: number;
  closePrice: number;
  now: number;
}

export interface SettleOutcome {
  result: RoundResult;
  summary: RoundPortfolioSummary;
  alreadySettled: boolean;
}

function summarize(roundId: number, orders: Order[], result: RoundResult): RoundPortfolioSummary {
  let upStake = 0;
  let downStake = 0;
  let grossPayout = 0;
  let count = 0;
  for (const order of orders) {
    if (order.roundId !== roundId || order.status === "OPEN") continue;
    count += 1;
    if (order.side === "up") upStake += order.stake;
    else downStake += order.stake;
    grossPayout += order.payout;
  }
  const totalInvested = money(upStake + downStake);
  return {
    roundId,
    totalInvested,
    upStake: money(upStake),
    downStake: money(downStake),
    winningSide: result,
    grossPayout: money(grossPayout),
    roundPnL: money(grossPayout - totalInvested),
    orderCount: count,
  };
}

/**
 * SettlementService (req 50-53, 79).
 * Official Binance 5m kline open/close decides UP/DOWN/DRAW. Every order settles
 * at its OWN locked odds. DRAW refunds every stake with no takeout. settleRound
 * is idempotent — calling it again never credits the balance twice.
 */
export function settleRound(input: SettleInput): SettleOutcome {
  const { ledger, roundId, openPrice, closePrice, now } = input;

  const result: RoundResult =
    closePrice > openPrice ? "UP" : closePrice < openPrice ? "DOWN" : "DRAW";

  const orders = ledger.orders.filter((o) => o.roundId === roundId);
  const settledBefore = ledger.isSettled(roundId);

  if (settledBefore) {
    // Idempotent: no balance mutation, just rebuild the summary.
    return { result, summary: summarize(roundId, ledger.orders, result), alreadySettled: true };
  }

  for (const order of orders) {
    if (order.status !== "OPEN") continue;
    if (result === "DRAW") {
      order.status = "VOID";
      order.payout = money(order.stake); // full refund
      order.profit = 0;
      ledger.credit(order.stake);
    } else if (
      (result === "UP" && order.side === "up") ||
      (result === "DOWN" && order.side === "down")
    ) {
      order.status = "WON";
      order.payout = money(order.stake * order.lockedOdds);
      order.profit = money(order.payout - order.stake);
      ledger.credit(order.payout);
    } else {
      order.status = "LOST";
      order.payout = 0;
      order.profit = money(-order.stake);
    }
    order.settledAt = now;
  }

  const existingRound = ledger.getRound(roundId);
  if (existingRound) {
    existingRound.closePrice = closePrice;
    existingRound.result = result;
    existingRound.status = "SETTLED";
    existingRound.settledAt = now;
    ledger.upsertRound(existingRound);
  }

  ledger.markSettled(roundId);
  ledger.persist();

  return { result, summary: summarize(roundId, ledger.orders, result), alreadySettled: false };
}
