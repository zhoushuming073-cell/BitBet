"use client";

import { useEffect, useState } from "react";
import { Bitcoin, RotateCcw, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import { createBrowserEngine, type BrowserRuntime } from "@/lib/pulse5/engine/createBrowserEngine";
import type { EngineView } from "@/lib/pulse5/engine/Pulse5Engine";
import { TradePanel } from "./trade-panel";
import { HistoryTable } from "./history-table";
import { MarketChart } from "./market-chart";
import { RoundResultToast } from "./round-result-toast";

const money = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function roundClock(roundId: number) {
  return new Date(roundId).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function CurrentPrediction({ view }: { view: EngineView }) {
  const position = view.position;
  const hasPrediction = position.totalInvested > 0;

  return (
    <section className="current-prediction" aria-labelledby="current-prediction-title">
      <div>
        <h2 id="current-prediction-title">本轮竞猜</h2>
        <p>{hasPrediction ? `等待 ${roundClock(view.round.id + 300_000)} 结算` : "选择方向并提交本轮竞猜"}</p>
      </div>
      {hasPrediction ? (
        <div className="prediction-summary">
          {position.up.stake > 0 ? (
            <span><b className="up">看涨</b>{money.format(position.up.stake)} USDT</span>
          ) : null}
          {position.down.stake > 0 ? (
            <span><b className="down">看跌</b>{money.format(position.down.stake)} USDT</span>
          ) : null}
          <span><b>合计</b>{money.format(position.totalInvested)} USDT</span>
        </div>
      ) : (
        <span className="prediction-empty">暂无竞猜</span>
      )}
    </section>
  );
}

export function MarketGame() {
  const [runtime, setRuntime] = useState<BrowserRuntime | null>(null);
  const [view, setView] = useState<EngineView | null>(null);

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

  const resetGame = () => {
    if (!runtime) return;
    if (window.confirm("确定重置虚拟余额和竞猜记录吗？")) runtime.engine.reset();
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

  return (
    <main className="app-shell">
      <RoundResultToast notice={view.lastSettlement} />

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
          <div className="balance">
            <span>虚拟余额</span>
            <strong>{money.format(view.balance)} <small>USDT</small></strong>
          </div>
          <button className="reset-button" type="button" onClick={resetGame} aria-label="重置虚拟余额和竞猜记录">
            <RotateCcw aria-hidden="true" />
            <span>重置</span>
          </button>
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
              </div>
            </div>
            <MarketChart
              points={view.points}
              price={view.market?.midPrice ?? 0}
              roundOpen={openPrice}
              roundStart={view.round.id}
              connected={view.connected}
              orders={[]}
            />
          </section>

          <TradePanel engine={runtime.engine} view={view} />
        </div>

        <CurrentPrediction view={view} />
        <HistoryTable orders={view.settledOrders} />
      </div>

      <footer>
        <ShieldCheck aria-hidden="true" />
        <span>虚拟竞猜，不涉及真实交易</span>
      </footer>
    </main>
  );
}
