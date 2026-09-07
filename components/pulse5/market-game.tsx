"use client";

import { useEffect, useState } from "react";
import { Bitcoin, Bot, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import { createBrowserEngine, type BrowserRuntime } from "@/lib/pulse5/engine/createBrowserEngine";
import type { EngineView } from "@/lib/pulse5/engine/Pulse5Engine";
import type { Side } from "@/lib/pulse5/engine/types";
import { TradePanel } from "./trade-panel";
import { HistoryTable } from "./history-table";
import { OpenOrders } from "./open-orders";
import { MarketChart } from "./market-chart";
import { RoundResultToast } from "./round-result-toast";
import { useTradingBots } from "./use-trading-bots";
import { WeeklyLeaderboard } from "./weekly-leaderboard";

const money = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatCountdown(seconds: number) {
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

export function MarketGame() {
  const [runtime, setRuntime] = useState<BrowserRuntime | null>(null);
  const [view, setView] = useState<EngineView | null>(null);
  const bots = useTradingBots(view);

  useEffect(() => {
    const nextRuntime = createBrowserEngine();
    const update = () => setView(nextRuntime.engine.getView(Date.now()));
    const unsubscribe = nextRuntime.engine.subscribe(update);
    const frame = requestAnimationFrame(() => {
      setRuntime(nextRuntime);
      update();
    });

    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
      nextRuntime.stop();
    };
  }, []);

  const handleSubmit = async (side: Side, stake: number) => {
    const now = Date.now();
    const idempotencyKey = `${now.toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    if (!runtime) throw new Error("游戏尚未就绪");
    runtime.engine.placeOrder(side, stake, idempotencyKey, now);
  };

  const claimOrder = async (orderId: string) => {
    if (!runtime) return;
    runtime.engine.claimOrder(orderId);
  };

  const claimAll = async () => {
    if (!runtime) return;
    runtime.engine.claimAll();
  };

  if (!view || !runtime) {
    return (
      <main className="app-shell loading-shell">
        <div className="boot-loading" role="status">
          <Bitcoin aria-hidden="true" />
          <span className="loading-line" />
          <p>正在连接 BTC 行情</p>
        </div>
      </main>
    );
  }

  const currentPrice = view.market?.lastPrice ?? 0;
  const openPrice = view.market?.roundOpen ?? 0;
  const difference = currentPrice && openPrice ? currentPrice - openPrice : 0;
  const differencePercent = openPrice ? (difference / openPrice) * 100 : 0;
  const rising = difference >= 0;

  const balance = view.balance;
  const openOrders = view.openOrders;
  const settledOrders = view.settledOrders;
  const claimable = view.claimable;

  return (
    <main className="app-shell">
      <RoundResultToast notice={view.lastSettlement} onClaim={claimAll} />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><Bitcoin aria-hidden="true" /></span>
          <span><b>BTC</b> 5分钟涨跌</span>
        </div>
        <div className="topbar-actions">
          <div className="connection" title={view.connected ? "实时行情已连接" : "正在重新连接行情"}>
            {view.connected ? <Wifi aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
            <span>{view.connected ? "实时行情" : "重连中"}</span>
          </div>
          <div className="bot-presence" title="两个机器人正在使用各自的虚拟账户交易">
            <Bot aria-hidden="true" />
            <span>2 个对手在线</span>
          </div>
          <div className="balance">
            <span>可用余额</span>
            <strong>{money.format(balance)} <small>USDT</small></strong>
            {claimable > 0 ? <small>待领取 {money.format(claimable)}</small> : null}
          </div>
        </div>
      </header>

      <div className="page-content">
        <div className="play-grid">
          <section className="market-panel" aria-labelledby="market-title">
            <div className="market-heading">
              <div>
                <p id="market-title">BTC / USDT</p>
                <div className="live-price">
                  <strong>{currentPrice ? `$${money.format(currentPrice)}` : "等待行情"}</strong>
                  {currentPrice ? (
                    <span className={rising ? "up" : "down"}>
                      {difference >= 0 ? "+" : ""}{money.format(difference)} ({differencePercent >= 0 ? "+" : ""}{differencePercent.toFixed(3)}%)
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="market-facts">
                <div><span>本轮开盘价</span><strong>{openPrice ? `$${money.format(openPrice)}` : "等待确认"}</strong></div>
                <div><span>本轮方向</span><strong className={rising ? "up" : "down"}>{currentPrice ? (rising ? "上涨" : "下跌") : "等待行情"}</strong></div>
                <div className="heading-countdown"><span>剩余</span><strong>{formatCountdown(view.round.secondsRemaining)}</strong></div>
              </div>
            </div>
            <MarketChart
              points={view.points}
              price={view.market?.midPrice ?? 0}
              roundOpen={openPrice}
              roundStart={view.round.id}
              connected={view.connected}
              orders={openOrders}
            />
          </section>

          <TradePanel engine={runtime.engine} view={view} balance={balance} onSubmit={handleSubmit} />
        </div>

        <WeeklyLeaderboard playerEngine={runtime.engine} bots={bots} />

        <OpenOrders orders={openOrders} />
        <HistoryTable
          orders={settledOrders}
          claimable={claimable}
          onClaim={claimOrder}
          onClaimAll={claimAll}
        />
      </div>

      <footer>
        <ShieldCheck aria-hidden="true" />
        <span>虚拟竞猜 · 你和两位机器人 · 不涉及真实交易</span>
      </footer>
    </main>
  );
}
