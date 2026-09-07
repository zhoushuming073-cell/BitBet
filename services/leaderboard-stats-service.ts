import type { LeaderboardStats } from "@/lib/domain/types";
import { money } from "@/lib/domain/types";
import type { Repositories } from "@/repository/types";

/** Rebuild persisted leaderboard facts without importing a browser repository. */
export async function refreshLeaderboardStats(
  userId: string,
  repos: Repositories,
): Promise<LeaderboardStats | null> {
  const wallet = await repos.wallets.getWallet(userId);
  if (!wallet) return null;

  const orders = await repos.orders.listByUser(userId, 1000);
  let wins = 0;
  let losses = 0;
  let netProfit = 0;
  let totalStaked = 0;
  let totalPayout = 0;

  for (const order of orders) {
    if (order.status !== "SETTLED") continue;
    totalStaked += order.stake;
    totalPayout += order.payout;
    netProfit += order.profit;
    if (order.profit > 0) wins += 1;
    else if (order.profit < 0) losses += 1;
  }

  const settled = wins + losses;
  const stats: LeaderboardStats = {
    _id: userId,
    userId,
    totalOrders: orders.length,
    totalRounds: new Set(orders.map((order) => order.roundId)).size,
    totalStaked: money(totalStaked),
    totalPayout: money(totalPayout),
    netProfit: money(netProfit),
    roi: wallet.initialBalance > 0 ? money((netProfit / wallet.initialBalance) * 100) : 0,
    wins,
    losses,
    winRate: settled > 0 ? money((wins / settled) * 100) : 0,
    currentBalance: money(wallet.availableBalance + wallet.pendingClaim),
    updatedAt: Date.now(),
  };

  await repos.leaderboard.upsertStats(stats);
  return stats;
}
