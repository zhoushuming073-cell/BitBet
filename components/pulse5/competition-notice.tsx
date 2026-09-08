"use client";

import { useEffect, useRef, useState } from "react";
import type { Pulse5Engine } from "@/lib/pulse5/engine/Pulse5Engine";
import type { TradingBotState } from "./use-trading-bots";
import { buildCompetitionStandings } from "./competition-stats";

interface NoticeSnapshot {
  playerRank: number;
  streaks: Record<string, { wins: number; losses: number }>;
}

export function CompetitionNotice({ playerEngine, bots }: { playerEngine: Pulse5Engine; bots: TradingBotState[] }) {
  const [message, setMessage] = useState("");
  const previousRef = useRef<NoticeSnapshot | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (bots.length !== 2) return;
    const standings = buildCompetitionStandings(playerEngine, bots);
    const current: NoticeSnapshot = {
      playerRank: standings.findIndex((row) => row.id === "you") + 1,
      streaks: Object.fromEntries(standings.map((row) => [row.id, {
        wins: row.currentWinStreak,
        losses: row.currentLossStreak,
      }])),
    };
    const previous = previousRef.current;
    previousRef.current = current;
    if (!previous) return;

    let next = "";
    if (current.playerRank < previous.playerRank) {
      next = current.playerRank === 1 ? "👑 你目前本周第一" : `↑ 你刚刚升到第 ${current.playerRank} 名`;
    }
    if (!next) {
      for (const bot of bots) {
        const before = previous.streaks[bot.definition.id] ?? { wins: 0, losses: 0 };
        const after = current.streaks[bot.definition.id] ?? { wins: 0, losses: 0 };
        if (after.wins >= 3 && after.wins > before.wins) {
          next = `🔥 ${bot.definition.name} ${after.wins} 连胜`;
          break;
        }
        if (after.losses >= 3 && after.losses > before.losses) {
          next = `❄ ${bot.definition.name} ${after.losses} 连败`;
          break;
        }
      }
    }
    if (!next) return;
    setMessage(next);
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setMessage(""), 3200);
  }, [bots, playerEngine]);

  useEffect(() => () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
  }, []);

  return message ? <div className="competition-notice" role="status">{message}</div> : null;
}
