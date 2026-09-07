import type { LeaderboardSortKey } from "@/repository";
import { getServerRepositories } from "@/repository/server";

export const dynamic = "force-dynamic";

const SORTS = new Set<LeaderboardSortKey>(["netProfit", "roi", "winRate", "currentBalance"]);

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requested = url.searchParams.get("sort") as LeaderboardSortKey | null;
    const sortBy = requested && SORTS.has(requested) ? requested : "netProfit";
    const minOrders = sortBy === "winRate" ? 20 : 0;
    const repos = getServerRepositories();
    const stats = await repos.leaderboard.listTop(sortBy, 50, minOrders);
    const rows = await Promise.all(stats.map(async (row, index) => ({
      rank: index + 1,
      userId: row.userId,
      username: (await repos.profiles.getProfile(row.userId))?.username ?? "玩家",
      netProfit: row.netProfit,
      roi: row.roi,
      winRate: row.winRate,
      currentBalance: row.currentBalance,
      totalOrders: row.totalOrders,
    })));
    return Response.json({ rows, minOrders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "排行榜加载失败" }, { status: 503 });
  }
}
