"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserEngine, type BrowserRuntime } from "@/lib/pulse5/engine/createBrowserEngine";
import type { EngineView } from "@/lib/pulse5/engine/Pulse5Engine";
import type { Order } from "@/lib/pulse5/engine/types";
import { BOT_DEFINITIONS, type BotDecisionContext } from "@/lib/pulse5/bots";

type BotDefinition = (typeof BOT_DEFINITIONS)[number];

export interface TradingBotState {
  definition: BotDefinition;
  engine: BrowserRuntime["engine"];
  view: EngineView;
  lastAction: string;
}

interface BotRuntime {
  definition: BotDefinition;
  runtime: BrowserRuntime;
  actedRounds: Set<number>;
  lastAction: string;
}

function pastResults(orders: Order[], currentRoundId: number) {
  return orders
    .filter((order) => (
      order.roundId < currentRoundId
      && order.status !== "OPEN"
      && order.settledAt != null
    ))
    .sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0))
    .slice(0, 6)
    .map((order) => ({
      roundId: order.roundId,
      profit: order.profit,
      settledAt: order.settledAt!,
    }));
}

function legalContext(bot: BotRuntime, botView: EngineView, marketView: EngineView, now: number): BotDecisionContext | null {
  const market = marketView.market;
  if (!market || botView.bettingState !== "OK") return null;
  const quoteAmount = Math.max(1, Math.min(500, Math.floor(botView.balance * 0.04)));
  const upQuote = bot.runtime.engine.estimateQuote("up", quoteAmount, now);
  const downQuote = bot.runtime.engine.estimateQuote("down", quoteAmount, now);
  return {
    now,
    round: {
      id: marketView.round.id,
      start: marketView.round.start,
      lockTime: marketView.round.lockTime,
      end: marketView.round.end,
    },
    currentPrice: market.midPrice,
    roundOpen: market.roundOpen,
    priceSamples: marketView.points
      .filter((sample) => sample.time <= now)
      .map((sample) => ({ time: sample.time, price: sample.price })),
    executionOdds: {
      up: upQuote?.quotable ? upQuote.executionOdds : null,
      down: downQuote?.quotable ? downQuote.executionOdds : null,
    },
    availableBalance: botView.balance,
    recentResults: pastResults(bot.runtime.engine.ledger.orders, marketView.round.id),
    hasOpenOrder: bot.runtime.engine.ledger.openOrdersForRound(marketView.round.id).length > 0,
  };
}

export function useTradingBots(marketView: EngineView | null): TradingBotState[] {
  const [bots, setBots] = useState<TradingBotState[]>([]);
  const marketViewRef = useRef(marketView);

  useEffect(() => {
    marketViewRef.current = marketView;
  }, [marketView]);

  useEffect(() => {
    const runtimes: BotRuntime[] = BOT_DEFINITIONS.map((definition) => ({
      definition,
      runtime: createBrowserEngine({ storageKey: definition.storageKey, passive: true }),
      actedRounds: new Set<number>(),
      lastAction: "观察中",
    }));

    const update = () => {
      const now = Date.now();
      const shared = marketViewRef.current;
      for (const bot of runtimes) {
        if (shared?.market) {
          const market = shared.market;
          bot.runtime.engine.setConnected(shared.connected);
          if (!market.openPending) bot.runtime.engine.setRoundOpen(shared.round.id, market.roundOpen);
          bot.runtime.engine.onBookTicker(market.bestBid, market.bestAsk, market.marketTimestamp);
          bot.runtime.engine.onTrade(market.lastPrice || market.midPrice, market.marketTimestamp);
          bot.runtime.engine.onTicker24h(shared.ticker);
          bot.runtime.engine.seedChart(shared.points.filter((sample) => sample.time <= now));
          if (!bot.runtime.engine.estimator.warmed && shared.points.length >= 20) {
            bot.runtime.engine.seedVolatility(shared.points.slice(-80).map((sample) => sample.price));
          }
          for (const round of shared.roundSummaries) {
            if (round.status === "SETTLED" && round.closePrice != null && !bot.runtime.engine.ledger.isSettled(round.id)) {
              bot.runtime.engine.settle(round.id, round.openPrice, round.closePrice, round.settledAt ?? now);
            }
          }
          bot.runtime.engine.tick(now);
        }

        const before = bot.runtime.engine.getView(now);
        if (before.claimable > 0) bot.runtime.engine.claimAll();

        const view = bot.runtime.engine.getView(now);
        const roundId = view.round.id;
        if (!bot.actedRounds.has(roundId)) {
          const context = shared ? legalContext(bot, view, shared, now) : null;
          const decision = context ? bot.definition.strategy.decide(context) : null;
          if (decision?.action === "UP" || decision?.action === "DOWN") {
            try {
              bot.runtime.engine.placeOrder(
                decision.action === "UP" ? "up" : "down",
                decision.stake,
                `bot-${bot.definition.id}-${roundId}`,
                now,
              );
              bot.actedRounds.add(roundId);
              bot.lastAction = `持仓 ${decision.action === "UP" ? "看涨" : "看跌"} ${decision.stake} USDT`;
            } catch {
              // The same execution gate as the player is authoritative.
            }
          } else if (decision) {
            bot.lastAction = decision.reason;
            if (now >= view.round.start + (view.round.end - view.round.start) * 0.7) {
              bot.actedRounds.add(roundId);
              bot.lastAction = "本轮跳过，等待下一轮";
            }
          }
        }
      }

      setBots(runtimes.map((bot) => ({
        definition: bot.definition,
        engine: bot.runtime.engine,
        view: bot.runtime.engine.getView(now),
        lastAction: bot.lastAction,
      })));
    };

    update();
    const timer = window.setInterval(update, 1_250);
    return () => {
      window.clearInterval(timer);
      for (const bot of runtimes) bot.runtime.stop();
    };
  }, []);

  return bots;
}
