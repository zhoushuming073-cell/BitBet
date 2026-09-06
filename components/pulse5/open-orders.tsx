"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import type { Order } from "@/lib/pulse5/engine/types";

const money = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function timeLabel(ts: number) {
  return new Date(ts).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * Current-round open orders, listed per-order (not aggregated into a single
 * position summary) so every locked odds / payout is visible. Newest-first in
 * the engine, so we reverse to show them in chronological order.
 */
export function OpenOrders({ orders }: { orders: Order[] }) {
  const list = orders.slice().reverse();
  const total = orders.reduce((sum, o) => sum + o.stake, 0);

  return (
    <section className="open-orders" aria-labelledby="open-orders-title">
      <div className="section-heading">
        <div>
          <h2 id="open-orders-title">当前挂单</h2>
          <p>{orders.length > 0 ? `${orders.length} 笔 · 总投入 ${money.format(total)} USDT` : "本轮暂无挂单"}</p>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="empty-orders">本轮尚未下单</div>
      ) : (
        <div className="open-orders-list">
          <div className="oo-head" aria-hidden="true">
            <span>方向</span><span>金额</span><span>赔率</span><span>预计返还</span><span>时间</span>
          </div>
          {list.map((order) => (
            <div className="oo-row" key={order.id}>
              <span className={`oo-side ${order.side}`}>
                {order.side === "up" ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />}
                {order.side === "up" ? "看涨" : "看跌"}
              </span>
              <span className="oo-stake">{money.format(order.stake)}</span>
              <span className="oo-odds">{order.lockedOdds.toFixed(2)}x</span>
              <span className="oo-payout">{money.format(order.potentialPayout)}</span>
              <span className="oo-time">{timeLabel(order.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
