"use client";

import { useEffect, useState } from "react";
import { Bitcoin, RotateCcw, ShieldCheck, Wifi, WifiOff } from "lucide-react";
import { createBrowserEngine, type BrowserRuntime } from "@/lib/pulse5/engine/createBrowserEngine";
import type { EngineView } from "@/lib/pulse5/engine/Pulse5Engine";
import type { Side } from "@/lib/pulse5/engine/types";
import { TradePanel } from "./trade-panel";
import { HistoryTable } from "./history-table";
import { OpenOrders } from "./open-orders";
import { MarketChart } from "./market-chart";
import { RoundResultToast } from "./round-result-toast";
import { AccountEntry } from "@/components/account/account-entry";
import { useAccount } from "@/components/account/use-account";
import { GameCoordinator } from "@/services/game-coordinator";
import {
  fetchState,
  placeOrder,
  claim as claimApi,
  claimAll as claimAllApi,
  settle as settleApi,
  type AuthorityState,
} from "@/lib/game/client";

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
  const { account } = useAccount();

  // Authoritative state lives on the GameServer (balance / orders / claim). The
  // browser engine only supplies live market data + indicative odds preview.
  const [authority, setAuthority] = useState<AuthorityState | null>(null);

  useEffect(() => {
    let alive = true;
    fetchState()
      .then((state) => {
        if (alive) setAuthority(state);
      })
      .catch(() => {
        /* server not ready — UI falls back to the browser engine view */
      });
    return () => {
      alive = false;
    };
  }, []);

  const reloadAuthority = async () => {
    const state = await fetchState().catch(() => null);
    if (state) setAuthority(state);
  };

  const [coordinator] = useState<GameCoordinator>(() => new GameCoordinator());

  useEffect(() => {
    coordinator.setUserId(account?.userId ?? null);
  }, [account, coordinator]);

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

  // On a settled round: mirror to the account layer AND the authoritative server.
  useEffect(() => {
    const roundId = view?.lastSettlement?.roundId;
    if (roundId == null) return;
    const engineRound = view?.roundSummaries.find((r) => r.id === roundId);
    if (!engineRound) return;
    const settledOrders = (view?.settledOrders ?? []).filter((o) => o.roundId === roundId);
    coordinator?.onRoundSettled(engineRound, settledOrders);
    if (engineRound.openPrice > 0 && engineRound.closePrice != null && engineRound.closePrice > 0) {
      void settleApi(roundId, engineRound.openPrice, engineRound.closePrice).then(() => reloadAuthority());
    }
  }, [view?.lastSettlement, view?.roundSummaries, view?.settledOrders, coordinator]);

  const handleSubmit = async (side: Side, stake: number) => {
    const now = Date.now();
    const idempotencyKey = `${now.toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    const { order } = await placeOrder(side, stake, view?.market?.midPrice ?? 0, idempotencyKey);
    coordinator.onOrderPlaced(order);
    await reloadAuthority();
  };

  const resetGame = () => {
    if (!runtime) return;
    if (window.confirm("确定重置虚拟余额和竞猜记录吗？")) runtime.engine.reset();
  };

  const claimOrder = async (orderId: string) => {
    await claimApi(orderId);
    await reloadAuthority();
  };

  const claimAll = async () => {
    await claimAllApi();
    await reloadAuthority();
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

  // Authoritative data wins when the server is reachable; otherwise fall back to
  // the browser engine view (dev / offline).
  const balance = authority?.balance ?? view.balance;
  const openOrders = authority?.openOrders ?? view.openOrders;
  const settledOrders = authority?.settledOrders ?? view.settledOrders;
  const claimable = authority?.claimable ?? view.claimable;

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
          <div className="balance">
            <span>虚拟余额</span>
            <strong>{money.format(balance)} <small>USDT</small></strong>
          </div>
          <AccountEntry />
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
        <span>虚拟竞猜，不涉及真实交易</span>
      </footer>
    </main>
  );
}
