import type { Pulse5Engine } from "@/lib/pulse5/engine/Pulse5Engine";
import { currentWeekStart } from "@/lib/pulse5/bots";
import { computeWeeklyStats, type WeeklyStats } from "@/lib/pulse5/stats/weeklyStats";
import type { TradingBotState } from "./use-trading-bots";

export interface CompetitionStanding extends WeeklyStats {
  id: "you" | "alpha" | "beta" | "lambda";
  name: string;
  avatar: string;
  label: string;
  accent: "you" | "orange" | "slate" | "lambda";
}

export function buildCompetitionStandings(
  playerEngine: Pulse5Engine,
  bots: TradingBotState[],
  weekStart = currentWeekStart(),
  now = Date.now(),
): CompetitionStanding[] {
  const player: CompetitionStanding = {
    id: "you",
    name: "你",
    avatar: "你",
    label: "手动交易",
    accent: "you",
    ...computeWeeklyStats(playerEngine, weekStart, [], now),
  };
  const botRows: CompetitionStanding[] = bots.map((bot) => ({
    id: bot.definition.id,
    name: bot.definition.name,
    avatar: bot.definition.shortName,
    label: `${bot.status} · ${bot.definition.strategy.label}`,
    accent: bot.definition.id === "alpha" ? "orange" : bot.definition.id === "lambda" ? "lambda" : "slate",
    ...computeWeeklyStats(bot.engine, weekStart, bot.skippedRoundIds, now),
  }));
  return [player, ...botRows].sort((a, b) => b.profit - a.profit || b.assets - a.assets);
}
