/**
 * Leaderboard service — reads and rank lookups. Stats are always computed from
 * real settled orders (never trusted from the client); see refreshStats.
 */
import { getRepositories, type LeaderboardSortKey } from "@/repository";
import type { LeaderboardStats } from "@/lib/domain/types";
import { refreshLeaderboardStats } from "./leaderboard-stats-service";

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
  const rows = await repos.leaderboard.listTop(sortBy, limit, minOrders);
  const entries: LeaderboardEntry[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const s = rows[i];
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
export async function refreshStats(
  userId: string,
): Promise<LeaderboardStats | null> {
  return refreshLeaderboardStats(userId, getRepositories());
}
