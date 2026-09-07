import { authErrorResponse, requireUser } from "@/lib/auth/require-user";
import type { LeaderboardSortKey } from "@/repository";
import { getServerRepositories } from "@/repository/server";

export const dynamic = "force-dynamic";

const SORTS = new Set<LeaderboardSortKey>(["netProfit", "roi", "winRate", "currentBalance"]);

export async function GET(request: Request) {
  try {
    const identity = requireUser(request);
    const requested = new URL(request.url).searchParams.get("sort") as LeaderboardSortKey | null;
    const sortBy = requested && SORTS.has(requested) ? requested : "netProfit";
    const repos = getServerRepositories();
    const [profile, wallet, orders, stats, rank] = await Promise.all([
      repos.profiles.getProfile(identity.userId),
      repos.wallets.getWallet(identity.userId),
      repos.orders.listByUser(identity.userId, 20),
      repos.leaderboard.getStats(identity.userId),
      repos.leaderboard.getRank(identity.userId, sortBy),
    ]);
    return Response.json({ profile, wallet, orders, stats, rank });
  } catch (error) {
    return authErrorResponse(error);
  }
}
