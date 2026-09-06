"use client";

import { ArrowDown, ArrowUp, Gift } from "lucide-react";
import type { Order, OrderStatus } from "@/lib/pulse5/engine/types";

const money = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const STATUS_LABEL: Record<OrderStatus, string> = {
  WON: "猜中",
  LOST: "未中",
  VOID: "已退款",
  OPEN: "待结算",
};

function roundLabel(roundId: number) {
  return new Date(roundId).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function HistoryTable({
  orders,
  claimable,
  onClaim,
  onClaimAll,
}: {
  orders: Order[];
  claimable: number;
  onClaim: (orderId: string) => void;
  onClaimAll: () => void;
}) {
  const recentOrders = orders.slice(0, 5);
  const hasClaimable = claimable > 0;

  return (
    <section className="history-panel" aria-labelledby="history-title">
      <div className="section-heading">
        <div>
          <h2 id="history-title">最近结果</h2>
          <p>仅显示最近 5 次已结算竞猜</p>
        </div>
        {hasClaimable ? (
          <button className="claim-all" type="button" onClick={onClaimAll}>
            <Gift aria-hidden="true" />
            <span>一键领取</span>
            <b>+{money.format(claimable)}</b>
          </button>
        ) : null}
      </div>

      {recentOrders.length === 0 ? (
        <div className="empty-history">完成一次竞猜后，结果会显示在这里</div>
      ) : (
        <div className="history-list">
          <div className="history-head" aria-hidden="true">
            <span>轮次</span><span>方向</span><span>金额</span><span>结果</span><span>盈亏</span><span>操作</span>
          </div>
          {recentOrders.map((order) => {
            const claimableOrder = !order.claimed && (order.status === "WON" || order.status === "VOID");
            return (
              <div className="history-row" key={order.id}>
                <span className="history-round">{roundLabel(order.roundId)}</span>
                <span className={`history-side ${order.side}`}>
                  {order.side === "up" ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />}
                  {order.side === "up" ? "看涨" : "看跌"}
                </span>
                <span className="history-stake">{money.format(order.stake)} USDT</span>
                <span className={`history-result ${order.status === "WON" ? "win" : order.status === "LOST" ? "loss" : "tie"}`}>
                  {STATUS_LABEL[order.status]}
                </span>
                <span className={`history-pnl ${order.profit >= 0 ? "positive" : "negative"}`}>
                  {order.profit > 0 ? "+" : ""}{money.format(order.profit)}
                </span>
                <span className="history-action">
                  {claimableOrder ? (
                    <button type="button" className="claim-button" onClick={() => onClaim(order.id)}>
                      领取
                    </button>
                  ) : order.status === "LOST" ? (
                    <span className="claim-none">—</span>
                  ) : (
                    <span className="claim-done">已领取</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
