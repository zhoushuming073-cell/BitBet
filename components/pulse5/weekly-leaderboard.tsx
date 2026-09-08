"use client";

import { Trophy } from "lucide-react";
import type { Pulse5Engine } from "@/lib/pulse5/engine/Pulse5Engine";
import { currentWeekStart } from "@/lib/pulse5/bots";
import type { EquityPoint } from "@/lib/pulse5/stats/weeklyStats";
import type { TradingBotState } from "./use-trading-bots";
import { buildCompetitionStandings } from "./competition-stats";

const amount = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function EquitySparkline({ points, positive }: { points: EquityPoint[]; positive: boolean }) {
  const width = 72;
  const height = 24;
  const values = points.map((point) => point.roi);
  const rawMin = Math.min(...values, 0);
  const rawMax = Math.max(...values, 0);
  const range = Math.max(rawMax - rawMin, 0.2);
  const min = (rawMin + rawMax) / 2 - range / 2;
  const maxTime = Math.max(...points.map((point) => point.time));
  const minTime = Math.min(...points.map((point) => point.time));
  const timeRange = Math.max(1, maxTime - minTime);
  const path = points.map((point, index) => {
    const x = ((point.time - minTime) / timeRange) * width;
    const y = height - ((point.roi - min) / range) * height;
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg className={positive ? "board-spark up" : "board-spark down"} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="本周收益率曲线">
      <path d={path} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function WeeklyLeaderboard({ playerEngine, bots }: { playerEngine: Pulse5Engine; bots: TradingBotState[] }) {
  const weekStart = currentWeekStart();
  const standings = buildCompetitionStandings(playerEngine, bots, weekStart);
  const weekLabel = new Date(weekStart).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });

  return (
    <section className="weekly-board" aria-labelledby="weekly-board-title">
      <div className="section-heading board-heading">
        <div>
          <h2 id="weekly-board-title"><Trophy aria-hidden="true" /> 本周排行</h2>
          <p>{weekLabel} 起 · 每周一自动更新</p>
        </div>
        <span className="board-count">4 位玩家</span>
      </div>
      <div className="board-list">
        {standings.map((row, index) => (
          <div className="board-row" key={row.id}>
            <span className={`board-rank rank-${index + 1}`}>{index + 1}</span>
            <span className={`board-avatar ${row.accent}`}>{row.avatar}</span>
            <span className="board-player">
              <strong>{row.name}</strong>
              <small>{row.label} · 资产 {amount.format(row.assets)}</small>
            </span>
            <EquitySparkline points={row.equityCurve} positive={row.profit >= 0} />
            <span className={row.profit >= 0 ? "board-profit up" : "board-profit down"}>
              <strong>{row.profit > 0 ? "+" : ""}{amount.format(row.profit)}</strong>
              <small>{row.roi > 0 ? "+" : ""}{row.roi.toFixed(2)}%</small>
            </span>
            <span className="board-stats">
              胜率 {row.winRate.toFixed(0)}% · {row.orderCount}单 · 最长胜{row.maxWinStreak} / 败{row.maxLossStreak} · 回撤 {row.maxDrawdownPercent.toFixed(2)}% · SKIP {row.skipCount}
              {row.id === "lambda" ? ` · ${row.participationRounds}轮 · ${row.averageOrdersPerRound.toFixed(1)}单/轮 · 均Edge ${(row.averageEdge * 100).toFixed(1)}% · 对冲${row.hedgeCount}` : ""}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
