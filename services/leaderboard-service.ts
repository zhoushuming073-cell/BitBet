/**
 * Leaderboard service — reads and rank lookups. Stats are always computed from
 * real settled orders (never trusted from the client); see refreshStats.
 */
import { getRepositories, type LeaderboardSortKey } from "@/repository";
import type { LeaderboardStats } from "@/lib/domain/types";
import { money } from "@/lib/domain/types";

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  netProfit: number;
  roi: number;
  winRate: number;
  currentBalance: number;
  totalOrders: number;
}

const DEFAULT_MIN_ORDERS = 20; // win-rate boards need a minimum sample size

async function resolveUsername(userId: string): Promise<string> {
  const profile = await getRepositories().profiles.getProfile(userId);
  if (profile?.username) return profile.username;
  return "玩家";
}

export async function getLeaderboard(
  sortBy: LeaderboardSortKey,
  limit = 50,
  minOrders = 0,
): Promise<LeaderboardEntry[]> {
  const repos = getRepositories();
  const rows = await repos.leaderboard.listTop(sortBy, limit);
  const entries: LeaderboardEntry[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const s = rows[i];
    if (s.totalOrders < minOrders) continue;
    entries.push({
      rank: i + 1,
      userId: s.userId,
      username: await resolveUsername(s.userId),
      netProfit: s.netProfit,
      roi: s.roi,
      winRate: s.winRate,
      currentBalance: s.currentBalance,
      totalOrders: s.totalOrders,
    });
  }
  return entries;
}

export interface MyRank {
  rank: number;
  username: string;
  netProfit: number;
  roi: number;
  totalOrders: number;
}

export async function getMyRank(userId: string, sortBy: LeaderboardSortKey): Promise<MyRank | null> {
  const repos = getRepositories();
  const stats = await repos.leaderboard.getStats(userId);
  if (!stats) return null;
  const rank = await repos.leaderboard.getRank(userId, sortBy);
  return {
    rank,
    username: await resolveUsername(userId),
    netProfit: stats.netProfit,
    roi: stats.roi,
    totalOrders: stats.totalOrders,
  };
}

/** Win-rate board needs a minimum sample size so a 1-for-1 record doesn't top it. */
export function getWinRateMinOrders(): number {
  return DEFAULT_MIN_ORDERS;
}

/**
 * Recompute a user's leaderboard stats from their real orders. ROI =
 * netProfit / initialBalance. This is the authoritative derivation — the UI
 * never submits netProfit/roi/wins/losses.
 */
export async function refreshStats(userId: string): Promise<LeaderboardStats | null> {
  const repos = getRepositories();
  const wallet = await repos.wallets.getWallet(userId);
  if (!wallet) return null;

  const orders = await repos.orders.listByUser(userId, 1000);
  let wins = 0;
  let losses = 0;
  let netProfit = 0;
  let totalStaked = 0;
  let totalPayout = 0;

  for (const o of orders) {
    if (o.status !== "SETTLED") continue;
    totalStaked += o.stake;
    totalPayout += o.payout;
    netProfit += o.profit;
    if (o.profit > 0) wins += 1;
    else if (o.profit < 0) losses += 1;
  }

  const settled = wins + losses;
  const stats: LeaderboardStats = {
    _id: userId,
    userId,
    totalOrders: orders.length,
    totalRounds: new Set(orders.map((o) => o.roundId)).size,
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
