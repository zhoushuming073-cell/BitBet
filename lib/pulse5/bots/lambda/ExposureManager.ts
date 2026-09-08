import type { Order, Side } from "../../engine/types";

export interface LambdaExposure {
  up: number;
  down: number;
  gross: number;
  netSide: Side | null;
  sameSideRun: number;
  pnlIfUp: number;
  pnlIfDown: number;
}

export function calculateExposure(orders: Order[]): LambdaExposure {
  let up = 0;
  let down = 0;
  let upPayout = 0;
  let downPayout = 0;
  for (const order of orders.filter((item) => item.status === "OPEN")) {
    if (order.side === "up") { up += order.stake; upPayout += order.potentialPayout; }
    else { down += order.stake; downPayout += order.potentialPayout; }
  }
  const chronological = orders.filter((item) => item.status === "OPEN").slice().sort((a, b) => b.createdAt - a.createdAt);
  const latestSide = chronological[0]?.side;
  let sameSideRun = 0;
  for (const order of chronological) {
    if (order.side !== latestSide) break;
    sameSideRun += 1;
  }
  const gross = up + down;
  return {
    up,
    down,
    gross,
    netSide: up === down ? null : up > down ? "up" : "down",
    sameSideRun,
    pnlIfUp: upPayout - gross,
    pnlIfDown: downPayout - gross,
  };
}

export function projectedWorstPnl(exposure: LambdaExposure, side: Side, stake: number, payout: number) {
  const gross = exposure.gross + stake;
  const upPayout = exposure.pnlIfUp + exposure.gross + (side === "up" ? payout : 0);
  const downPayout = exposure.pnlIfDown + exposure.gross + (side === "down" ? payout : 0);
  return Math.min(upPayout - gross, downPayout - gross);
}
