"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bitcoin, Bot, Settings2, ShieldCheck, Wifi, WifiOff } from "lucide-react";
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
import { MobileCompetitionTabs } from "./mobile-competition-tabs";
import { CompetitionNotice } from "./competition-notice";
import { LambdaConfigPanel } from "./lambda-config-panel";
import { DEFAULT_LAMBDA_CONFIG, type LambdaConfig } from "@/lib/pulse5/bots/lambda/LambdaConfig";
import {
  claimAuthority,
  claimAuthorityAll,
  fetchAuthorityState,
  tickAuthorityState,
  saveLambdaConfig,
  submitAuthorityOrder,
  type AuthorityBotPayload,
  type AuthorityCompetitionPayload,
} from "@/lib/game/authority-client";

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
  const [authorityBots, setAuthorityBots] = useState<AuthorityBotPayload[]>([]);
  const [lambdaConfig, setLambdaConfig] = useState<LambdaConfig>(DEFAULT_LAMBDA_CONFIG);
  const [lambdaLearning, setLambdaLearning] = useState<AuthorityCompetitionPayload["lambdaLearning"] | null>(null);
  const [lambdaOpen, setLambdaOpen] = useState(false);
  const [authorityReady, setAuthorityReady] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [syncError, setSyncError] = useState("");
  const hasAuthoritySnapshot = useRef(false);
  const lastAuthorityMarketAt = useRef(0);
  const bots = useTradingBots(view, authorityBots);

  useEffect(() => {
    hasAuthoritySnapshot.current = false;
    const nextRuntime = createBrowserEngine({ persist: false, settlement: false });
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

  const refreshAuthority = useCallback(async (signal?: AbortSignal, advance = false) => {
    if (!runtime) return false;
    try {
      const state = advance ? await tickAuthorityState(signal) : await fetchAuthorityState(signal);
      if (state.market) {
        const now = Date.now();
        const localMarket = runtime.engine.getView(now).market;
        const localFeedIsStale = !localMarket || now - localMarket.marketTimestamp > 2_500;
        if (localFeedIsStale && state.market.observedAt > lastAuthorityMarketAt.current) {
          // This is the same public snapshot supplied to Bot strategies. It is
          // a display/feed fallback, never a client-supplied execution price.
          runtime.engine.seedVolatility(state.market.volatilityCloses);
          runtime.engine.setRoundOpen(state.round.id, state.market.roundOpen);
          runtime.engine.mergeChart(state.market.priceSamples);
          runtime.engine.onBookTicker(state.market.bid, state.market.ask, state.market.observedAt);
          runtime.engine.onTrade(state.market.midPrice, state.market.observedAt);
          runtime.engine.appendPoint({ time: state.market.observedAt, price: state.market.midPrice });
          runtime.engine.setConnected(true);
          runtime.engine.tick(now);
          lastAuthorityMarketAt.current = state.market.observedAt;
        }
      }
      runtime.engine.restoreLedger(state.player, { announceNewSettlement: hasAuthoritySnapshot.current });
      hasAuthoritySnapshot.current = true;
      setAuthorityBots(state.bots);
      setLambdaConfig(state.lambdaConfig);
      setLambdaLearning(state.lambdaLearning);
      setAuthorityReady(true);
      setAuthRequired(false);
      setSyncError("");
      return true;
    } catch (error) {
      if (signal?.aborted) return false;
      const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 0;
      if (status === 401) setAuthRequired(true);
      else setSyncError(error instanceof Error ? error.message : "账户同步失败");
      return status !== 401;
    }
  }, [runtime]);

  useEffect(() => {
    if (!runtime) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      const shouldContinue = await refreshAuthority(controller.signal, true);
      if (shouldContinue && !controller.signal.aborted) timer = setTimeout(poll, 1_500);
    };
    void poll();
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [refreshAuthority, runtime]);

  const handleSubmit = async (side: Side, stake: number) => {
    const now = Date.now();
    const idempotencyKey = `${now.toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    if (!runtime || !authorityReady) throw new Error("账户尚未同步");
    const result = await submitAuthorityOrder(side, stake, idempotencyKey);
    runtime.engine.restoreLedger(result.snapshot);
    void refreshAuthority();
  };

  const claimOrder = async (orderId: string) => {
    if (!runtime) return;
    const result = await claimAuthority(orderId);
    runtime.engine.restoreLedger(result.snapshot);
  };

  const claimAll = async () => {
    if (!runtime) return false;
    const result = await claimAuthorityAll();
    runtime.engine.restoreLedger(result.snapshot);
    return true;
  };

  const handleLambdaSave = async (config: LambdaConfig) => {
    const result = await saveLambdaConfig(config);
    setLambdaConfig(result.config);
    void refreshAuthority();
  };

  if (!view || !runtime || (!authorityReady && !authRequired)) {
    return (
      <main className="app-shell loading-shell">
        <div className="boot-loading" role="status">
          <Bitcoin aria-hidden="true" />
          <span className="loading-line" />
          <p>{syncError || "正在连接 BTC 行情与账户"}</p>
        </div>
      </main>
    );
  }

  if (authRequired) {
    return (
      <main className="app-shell auth-shell">
        <section className="authority-login">
          <span className="brand-mark"><Bitcoin aria-hidden="true" /></span>
          <h1>BTC 5分钟涨跌</h1>
          <p>登录后，你与三位机器人的订单、余额和本周战绩会由服务端统一保存。</p>
          <a href="/signin-with-chatgpt?return_to=%2F">使用 ChatGPT 登录</a>
          {syncError ? <small>{syncError}</small> : null}
        </section>
      </main>
    );
  }

  const currentPrice = view.market?.lastPrice ?? 0;
  const openPrice = view.market?.roundOpen ?? 0;
  const difference = currentPrice && openPrice ? currentPrice - openPrice : 0;
  const differencePercent = openPrice ? (difference / openPrice) * 100 : 0;
  const rising = difference >= 0;
  const roundLabel = new Date(view.round.id).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const locked = view.phase !== "OPEN";

  const balance = view.balance;
  const openOrders = view.openOrders;
  const settledOrders = view.settledOrders;
  const claimable = view.claimable;

  return (
    <main className="app-shell">
      <RoundResultToast notice={view.lastSettlement} onClaim={claimAll} />
      <CompetitionNotice playerEngine={runtime.engine} bots={bots} />
      {lambdaOpen ? <LambdaConfigPanel open config={lambdaConfig} learning={lambdaLearning} onClose={() => setLambdaOpen(false)} onSave={handleLambdaSave} /> : null}

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
          <button className="lambda-config-trigger" type="button" onClick={() => setLambdaOpen(true)} title="配置 Bot Lambda">
            <Settings2 aria-hidden="true" /><span>Lambda{lambdaLearning ? ` · Lv.${lambdaLearning.level}` : ""}</span>
          </button>
          <div className="bot-presence" title="三个机器人由服务端使用各自的虚拟账户交易">
            <Bot aria-hidden="true" />
            <span>3 个对手在线</span>
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
              <div className="market-left">
                <div className="market-summary">
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
              <div className="mobile-round-summary">
                <div className="mobile-round-head">
                  <strong>第 {roundLabel} 轮</strong>
                  <span className={locked ? "locked" : ""}>{locked ? "已停止" : "竞猜中"}</span>
                </div>
                <small>预测 5 分钟后 BTC 价格方向</small>
                <b>{formatCountdown(view.round.secondsRemaining)}</b>
                <em className={rising ? "up" : "down"}>{currentPrice ? (rising ? "当前上涨" : "当前下跌") : "等待行情"}</em>
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

        <MobileCompetitionTabs
          playerEngine={runtime.engine}
          playerOrders={openOrders}
          settledOrders={settledOrders}
          claimable={claimable}
          bots={bots}
          onClaim={claimOrder}
          onClaimAll={claimAll}
        />

        <div className="desktop-competition">
          <WeeklyLeaderboard playerEngine={runtime.engine} bots={bots} />
          <OpenOrders orders={openOrders} />
          <HistoryTable
            orders={settledOrders}
            claimable={claimable}
            onClaim={claimOrder}
            onClaimAll={claimAll}
          />
        </div>
      </div>

      <footer>
        <ShieldCheck aria-hidden="true" />
        <span>服务端虚拟竞猜 · 你和三位机器人 · 不涉及真实交易</span>
      </footer>
    </main>
  );
}
