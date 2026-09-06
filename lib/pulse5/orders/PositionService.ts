import type { CurrentPosition, Order, SidePosition } from "../engine/types";

export interface RawAggregate {
  stake: number;
  payout: number;
  avgOdds: number;
  count: number;
}

function aggregate(orders: Order[], side: "up" | "down"): SidePosition {
  let stake = 0;
  let payout = 0;
  let count = 0;
  for (const order of orders) {
    if (order.status !== "OPEN" || order.side !== side) continue;
    stake += order.stake;
    payout += order.stake * order.lockedOdds;
    count += 1;
  }
  stake = round2(stake);
  payout = round2(payout);
  return {
    stake,
    payout,
    count,
    avgOdds: stake > 0 ? payout / stake : 0,
  };
}

function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

/**
 * PositionService (req 34-39).
 * Each side aggregates independently (no netting). Avg odds is payout-weighted,
 * never a simple arithmetic mean.
 */
export function buildPosition(roundId: number, orders: Order[], availableBalance: number): CurrentPosition {
  const open = orders.filter((o) => o.roundId === roundId && o.status === "OPEN");
  const up = aggregate(open, "up");
  const down = aggregate(open, "down");
  const totalInvested = round2(up.stake + down.stake);
  // totalCost = sum of every stake; each side's payout only returns if it wins.
  const pnlIfUp = round2(up.payout - totalInvested);
  const pnlIfDown = round2(down.payout - totalInvested);
  return {
    roundId,
    up,
    down,
    totalInvested,
    pnlIfUp,
    pnlIfDown,
    exposure: round2(Math.abs(pnlIfUp - pnlIfDown)),
    availableBalance: round2(availableBalance),
  };
}

/** What-if helper used by the hedge calculator (no ledger mutation). */
export function projectedPnL(upPayout: number, downPayout: number, totalCost: number) {
  return {
    pnlIfUp: round2(upPayout - totalCost),
    pnlIfDown: round2(downPayout - totalCost),
  };
}
