"use client";

import { useMemo, useState } from "react";
import { Bot, Clock3, ListOrdered, Trophy } from "lucide-react";
import type { Pulse5Engine } from "@/lib/pulse5/engine/Pulse5Engine";
import type { Order } from "@/lib/pulse5/engine/types";
import type { TradingBotState } from "./use-trading-bots";
import { HistoryTable } from "./history-table";
import { WeeklyLeaderboard } from "./weekly-leaderboard";

type TabId = "orders" | "history" | "leaderboard";

interface LiveOrderRow {
  order: Order;
  user: string;
  role: "本人" | "机器人";
}

const money = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function timeLabel(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function MobileCompetitionTabs({
  playerEngine,
  playerOrders,
  settledOrders,
  claimable,
  bots,
  onClaim,
  onClaimAll,
}: {
  playerEngine: Pulse5Engine;
  playerOrders: Order[];
  settledOrders: Order[];
  claimable: number;
  bots: TradingBotState[];
  onClaim: (orderId: string) => void;
  onClaimAll: () => void;
}) {
  const [activeTab, setActiveTab] = useState<TabId>("orders");
  const liveOrders = useMemo<LiveOrderRow[]>(() => {
    const rows: LiveOrderRow[] = playerOrders.map((order) => ({ order, user: "你", role: "本人" }));
    for (const bot of bots) {
      for (const order of bot.view.openOrders) {
        rows.push({ order, user: bot.definition.name, role: "机器人" });
      }
    }
    return rows.sort((a, b) => b.order.createdAt - a.order.createdAt);
  }, [bots, playerOrders]);

  return (
    <section className="mobile-competition" aria-label="交易信息">
      <div className="mobile-tabs" role="tablist" aria-label="交易信息菜单">
        <button type="button" role="tab" aria-selected={activeTab === "orders"} onClick={() => setActiveTab("orders")}>
          <ListOrdered aria-hidden="true" />实时交易单
        </button>
        <button type="button" role="tab" aria-selected={activeTab === "history"} onClick={() => setActiveTab("history")}>
          <Clock3 aria-hidden="true" />最近结果
        </button>
        <button type="button" role="tab" aria-selected={activeTab === "leaderboard"} onClick={() => setActiveTab("leaderboard")}>
          <Trophy aria-hidden="true" />本周排行
        </button>
      </div>

      <div className="mobile-tab-body">
        {activeTab === "orders" ? (
          <div className="live-order-panel" role="tabpanel">
            <div className="bot-status-strip">
              {bots.map((bot) => (
                <span key={bot.definition.id} title={`${bot.definition.name}：${bot.lastAction}`}>
                  <Bot aria-hidden="true" /><b>{bot.definition.shortName}</b>
                  <i data-state={bot.status}>{bot.status}</i>
                  <small>{bot.lastAction}</small>
                </span>
              ))}
            </div>
            <div className="live-order-count">{liveOrders.length} 笔本轮交易</div>
            {liveOrders.length > 0 ? (
              <div className="live-order-list">
                <div className="live-order-head" aria-hidden="true">
                  <span>时间</span><span>用户 / 理由</span><span>方向</span><span>金额</span>
                </div>
                {liveOrders.map(({ order, user, role }) => (
                  <div className="live-order-row" key={`${user}-${order.id}`}>
                    <span>{timeLabel(order.createdAt)}</span>
                    <span className="live-order-user"><strong>{user}</strong><small>{role}{order.reason ? ` · ${order.reason}` : ""}</small></span>
                    <span className={order.side === "up" ? "up" : "down"}>{order.side === "up" ? "看涨" : "看跌"}</span>
                    <b>{money.format(order.stake)}</b>
                  </div>
                ))}
              </div>
            ) : (
              <div className="live-orders-empty">本轮暂未成交，机器人正在按各自策略观察行情</div>
            )}
          </div>
        ) : null}

        {activeTab === "history" ? (
          <div role="tabpanel">
            <HistoryTable orders={settledOrders} claimable={claimable} onClaim={onClaim} onClaimAll={onClaimAll} />
          </div>
        ) : null}

        {activeTab === "leaderboard" ? (
          <div role="tabpanel">
            <WeeklyLeaderboard playerEngine={playerEngine} bots={bots} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
