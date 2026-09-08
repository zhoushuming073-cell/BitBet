import type { Pulse5Engine } from "@/lib/pulse5/engine/Pulse5Engine";
import type { Order } from "@/lib/pulse5/engine/types";
import { GAME_CONFIG } from "@/lib/pulse5/game/gameConfig";

export interface EquityPoint {
  time: number;
  roi: number;
}

export interface WeeklyStats {
  profit: number;
  roi: number;
  assets: number;
  orderCount: number;
  winRate: number;
  maxWinStreak: number;
  maxLossStreak: number;
  currentWinStreak: number;
  currentLossStreak: number;
  maxDrawdownPercent: number;
  skipCount: number;
  participationRounds: number;
  averageOrdersPerRound: number;
  averageEdge: number;
  hedgeCount: number;
  equityCurve: EquityPoint[];
}

function chronological(orders: Order[]): Order[] {
  return orders.slice().sort((a, b) =>
    (a.settledAt ?? a.createdAt) - (b.settledAt ?? b.createdAt) || a.createdAt - b.createdAt,
  );
}

function streaks(orders: Order[]) {
  let win = 0;
  let loss = 0;
  let maxWin = 0;
  let maxLoss = 0;
  for (const order of chronological(orders).filter((item) => item.status === "WON" || item.status === "LOST")) {
    if (order.status === "WON") {
      win += 1;
      loss = 0;
      maxWin = Math.max(maxWin, win);
    } else {
      loss += 1;
      win = 0;
      maxLoss = Math.max(maxLoss, loss);
    }
  }
  return { maxWin, maxLoss, currentWin: win, currentLoss: loss };
}

/** One shared source for the three weekly competition rows and notices. */
export function computeWeeklyStats(
  engine: Pulse5Engine,
  weekStart: number,
  skippedRoundIds: readonly number[] = [],
  now = Date.now(),
): WeeklyStats {
  const orders = engine.ledger.orders.filter((order) => order.createdAt >= weekStart && order.createdAt <= now);
  const settled = orders.filter((order) => order.status !== "OPEN");
  const decided = settled.filter((order) => order.status === "WON" || order.status === "LOST");
  const wins = decided.filter((order) => order.status === "WON").length;
  const openStake = orders.reduce((sum, order) => sum + (order.status === "OPEN" ? order.stake : 0), 0);
  const profit = settled.reduce((sum, order) => sum + order.profit, 0);
  const byRound = new Map<number, { time: number; profit: number }>();
  for (const order of settled) {
    const event = byRound.get(order.roundId) ?? { time: order.settledAt ?? order.createdAt, profit: 0 };
    event.time = Math.max(event.time, order.settledAt ?? order.createdAt);
    event.profit += order.profit;
    byRound.set(order.roundId, event);
  }

  const equityCurve: EquityPoint[] = [{ time: weekStart, roi: 0 }];
  let cumulative = 0;
  let peak = 0;
  let maxDrawdownPercent = 0;
  for (const event of [...byRound.values()].sort((a, b) => a.time - b.time)) {
    cumulative += event.profit;
    peak = Math.max(peak, cumulative);
    maxDrawdownPercent = Math.max(maxDrawdownPercent, ((peak - cumulative) / GAME_CONFIG.INITIAL_BALANCE) * 100);
    equityCurve.push({ time: event.time, roi: (cumulative / GAME_CONFIG.INITIAL_BALANCE) * 100 });
  }
  if (equityCurve.at(-1)!.time < now) {
    equityCurve.push({ time: now, roi: (cumulative / GAME_CONFIG.INITIAL_BALANCE) * 100 });
  }

  const streak = streaks(settled);
  const participationRounds = new Set(orders.map((order) => order.roundId)).size;
  const modeled = orders.filter((order) => order.strategyMeta);
  return {
    profit,
    roi: (profit / GAME_CONFIG.INITIAL_BALANCE) * 100,
    assets: engine.ledger.balance + engine.ledger.claimableBalance() + openStake,
    orderCount: orders.length,
    winRate: decided.length > 0 ? (wins / decided.length) * 100 : 0,
    maxWinStreak: streak.maxWin,
    maxLossStreak: streak.maxLoss,
    currentWinStreak: streak.currentWin,
    currentLossStreak: streak.currentLoss,
    maxDrawdownPercent,
    skipCount: new Set(skippedRoundIds.filter((roundId) => roundId >= weekStart && roundId <= now)).size,
    participationRounds,
    averageOrdersPerRound: participationRounds > 0 ? orders.length / participationRounds : 0,
    averageEdge: modeled.length > 0 ? modeled.reduce((sum, order) => sum + (order.strategyMeta?.edge ?? 0), 0) / modeled.length : 0,
    hedgeCount: modeled.filter((order) => order.strategyMeta?.adaptiveHedge).length,
    equityCurve,
  };
}
