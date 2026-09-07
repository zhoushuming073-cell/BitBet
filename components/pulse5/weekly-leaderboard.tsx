"use client";

import { Trophy } from "lucide-react";
import type { Pulse5Engine } from "@/lib/pulse5/engine/Pulse5Engine";
import { currentWeekStart } from "@/lib/pulse5/bots";
import { GAME_CONFIG } from "@/lib/pulse5/game/gameConfig";
import type { TradingBotState } from "./use-trading-bots";

const amount = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

interface Standing {
  id: string;
  name: string;
  label: string;
  profit: number;
  orders: number;
  assets: number;
  roi: number;
  accent: "you" | "orange" | "slate";
}

function weeklyMetrics(engine: Pulse5Engine, weekStart: number) {
  const orders = engine.ledger.orders.filter((order) => (
    order.createdAt >= weekStart && order.status !== "OPEN"
  ));
  return {
    profit: orders.reduce((sum, order) => sum + order.profit, 0),
    orders: orders.length,
    assets: engine.ledger.balance + engine.ledger.claimableBalance(),
    roi: orders.reduce((sum, order) => sum + order.profit, 0) / GAME_CONFIG.INITIAL_BALANCE * 100,
  };
}

export function WeeklyLeaderboard({
  playerEngine,
  bots,
}: {
  playerEngine: Pulse5Engine;
  bots: TradingBotState[];
}) {
  const weekStart = currentWeekStart();
  const player = weeklyMetrics(playerEngine, weekStart);
  const botRows: Standing[] = bots.map((bot) => ({
    id: bot.definition.id,
    name: bot.definition.name,
    label: `${bot.definition.strategy.label} · ${bot.lastAction}`,
    ...weeklyMetrics(bot.engine, weekStart),
    accent: bot.definition.id === "alpha" ? "orange" : "slate",
  }));
  const playerRow: Standing = { id: "you", name: "你", label: "手动交易", ...player, accent: "you" };
  const standings = [playerRow, ...botRows].sort((a, b) => b.profit - a.profit || b.assets - a.assets);

  const weekLabel = new Date(weekStart).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });

  return (
    <section className="weekly-board" aria-labelledby="weekly-board-title">
      <div className="section-heading board-heading">
        <div>
          <h2 id="weekly-board-title"><Trophy aria-hidden="true" /> 本周排行</h2>
          <p>{weekLabel} 起 · 每周一自动更新</p>
        </div>
        <span className="board-count">3 位玩家</span>
      </div>
      <div className="board-list">
        {standings.map((row, index) => (
          <div className="board-row" key={row.id}>
            <span className={`board-rank rank-${index + 1}`}>{index + 1}</span>
            <span className={`board-avatar ${row.accent}`}>{row.name.slice(0, 1)}</span>
            <span className="board-player"><strong>{row.name}</strong><small>{row.label}</small></span>
            <span className="board-orders">{row.orders} 单</span>
            <span className={row.profit >= 0 ? "board-profit up" : "board-profit down"}>
              <strong>{row.profit > 0 ? "+" : ""}{amount.format(row.profit)}</strong>
              <small>{row.roi > 0 ? "+" : ""}{row.roi.toFixed(2)}%</small>
            </span>
            <span className="board-assets"><small>总资产</small>{amount.format(row.assets)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
