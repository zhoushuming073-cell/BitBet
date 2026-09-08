"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserEngine, type BrowserRuntime } from "@/lib/pulse5/engine/createBrowserEngine";
import type { EngineView } from "@/lib/pulse5/engine/Pulse5Engine";
import type { Order } from "@/lib/pulse5/engine/types";
import { BOT_DEFINITIONS, type BotDecisionContext } from "@/lib/pulse5/bots";
import { deriveBotDisplayState, type BotDisplayState } from "@/lib/pulse5/bots/BotDisplayState";
import { BinanceFeedManager } from "@/lib/pulse5/market/BinanceFeedManager";

type BotDefinition = (typeof BOT_DEFINITIONS)[number];

export interface TradingBotState {
  definition: BotDefinition;
  engine: BrowserRuntime["engine"];
  view: EngineView;
  lastAction: string;
  status: BotDisplayState;
  skippedRoundIds: number[];
}

interface BotActivity {
  observedRoundId: number | null;
  skippedRoundIds: Set<number>;
}

interface BotRuntime {
  definition: BotDefinition;
  runtime: BrowserRuntime;
  orderSequence: number;
  lastOrderAtByRound: Map<number, number>;
  lastAction: string;
  coolingDown: boolean;
  activity: BotActivity;
}

const ACTIVITY_SUFFIX = "-activity-v1";

function loadActivity(storageKey: string): BotActivity {
  try {
    const raw = window.localStorage.getItem(`${storageKey}${ACTIVITY_SUFFIX}`);
    const parsed = raw ? JSON.parse(raw) as { observedRoundId?: unknown; skippedRoundIds?: unknown } : null;
    return {
      observedRoundId: typeof parsed?.observedRoundId === "number" ? parsed.observedRoundId : null,
      skippedRoundIds: new Set(
        Array.isArray(parsed?.skippedRoundIds)
          ? parsed.skippedRoundIds.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
          : [],
      ),
    };
  } catch {
    return { observedRoundId: null, skippedRoundIds: new Set<number>() };
  }
}

function persistActivity(bot: BotRuntime) {
  try {
    const cutoff = Date.now() - 8 * 7 * 24 * 60 * 60 * 1000;
    const skippedRoundIds = [...bot.activity.skippedRoundIds].filter((roundId) => roundId >= cutoff);
    bot.activity.skippedRoundIds = new Set(skippedRoundIds);
    window.localStorage.setItem(`${bot.definition.storageKey}${ACTIVITY_SUFFIX}`, JSON.stringify({
      observedRoundId: bot.activity.observedRoundId,
      skippedRoundIds,
    }));
  } catch {
    // Bot status metadata must never interrupt trading.
  }
}

function pastResults(orders: Order[], currentRoundId: number) {
  const byRound = new Map<number, { roundId: number; profit: number; settledAt: number }>();
  for (const order of orders
    .filter((order) => (
      order.roundId < currentRoundId
      && order.status !== "OPEN"
      && order.settledAt != null
    ))
    .sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0))) {
    const existing = byRound.get(order.roundId);
    if (existing) {
      existing.profit += order.profit;
      existing.settledAt = Math.max(existing.settledAt, order.settledAt!);
    } else {
      byRound.set(order.roundId, { roundId: order.roundId, profit: order.profit, settledAt: order.settledAt! });
    }
  }
  return [...byRound.values()].sort((a, b) => b.settledAt - a.settledAt).slice(0, 6);
}

function legalContext(bot: BotRuntime, botView: EngineView, marketView: EngineView, now: number): BotDecisionContext | null {
  const market = marketView.market;
  if (!market || botView.bettingState !== "OK") return null;
  const quoteAmount = Math.max(1, Math.min(500, Math.floor(botView.balance * 0.04)));
  const upQuote = bot.runtime.engine.estimateQuote("up", quoteAmount, now);
  const downQuote = bot.runtime.engine.estimateQuote("down", quoteAmount, now);
  const openOrders = bot.runtime.engine.ledger.openOrdersForRound(marketView.round.id);
  const lastOrder = openOrders[0] ?? null;
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
    openOrderCount: openOrders.length,
    lastOrderAt: lastOrder?.createdAt ?? null,
    lastOrderSide: lastOrder?.side ?? null,
  };
}

export function useTradingBots(marketView: EngineView | null): TradingBotState[] {
  const [bots, setBots] = useState<TradingBotState[]>([]);
  const marketViewRef = useRef(marketView);

  useEffect(() => {
    marketViewRef.current = marketView;
  }, [marketView]);

  useEffect(() => {
    const runtimes: BotRuntime[] = BOT_DEFINITIONS.map((definition) => {
      const activity = loadActivity(definition.storageKey);
      return {
        definition,
        runtime: createBrowserEngine({ storageKey: definition.storageKey, passive: true }),
        orderSequence: 0,
        lastOrderAtByRound: new Map<number, number>(),
        lastAction: "观察中",
        coolingDown: false,
        activity,
      };
    });
    const settlingRounds = new Set<number>();

    const settleBotRound = async (roundId: number) => {
      if (settlingRounds.has(roundId)) return;
      settlingRounds.add(roundId);
      try {
        const candle = await BinanceFeedManager.fetchClosedCandle(roundId, Date.now());
        if (!candle?.closed) return;
        const settledAt = Date.now();
        for (const bot of runtimes) {
          if (
            bot.runtime.engine.ledger.openOrdersForRound(roundId).length > 0
            && !bot.runtime.engine.ledger.isSettled(roundId)
          ) {
            bot.runtime.engine.settle(roundId, candle.open, candle.close, settledAt);
            bot.runtime.engine.claimAll();
            bot.lastAction = "上一轮已结算，观察新机会";
          }
        }
      } catch {
        // Retry on the next update. Settlement only uses an officially closed candle.
      } finally {
        settlingRounds.delete(roundId);
      }
    };

    const update = () => {
      const now = Date.now();
      const shared = marketViewRef.current;
      for (const bot of runtimes) {
        if (shared?.market) {
          const market = shared.market;
          if (bot.activity.observedRoundId !== shared.round.id) {
            const previous = bot.activity.observedRoundId;
            if (
              previous != null
              && previous < shared.round.id
              && !bot.runtime.engine.ledger.orders.some((order) => order.roundId === previous)
            ) {
              bot.activity.skippedRoundIds.add(previous);
            }
            bot.activity.observedRoundId = shared.round.id;
            persistActivity(bot);
          }
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
          for (const dueRoundId of bot.runtime.engine.roundsNeedingSettlement(now)) {
            void settleBotRound(dueRoundId);
          }
        }

        const before = bot.runtime.engine.getView(now);
        if (before.claimable > 0) bot.runtime.engine.claimAll();

        const view = bot.runtime.engine.getView(now);
        const roundId = view.round.id;
        for (const storedRound of bot.lastOrderAtByRound.keys()) {
          if (storedRound < roundId - 5 * 60 * 1000) bot.lastOrderAtByRound.delete(storedRound);
        }
        const latestPersistedOrder = bot.runtime.engine.ledger.openOrdersForRound(roundId)[0];
        const lastOrderAt = Math.max(
          bot.lastOrderAtByRound.get(roundId) ?? -Infinity,
          latestPersistedOrder?.createdAt ?? -Infinity,
        );
        const coolingDown = now - lastOrderAt < bot.definition.orderCooldownMs;
        bot.coolingDown = coolingDown;
        if (!coolingDown) {
          const context = shared ? legalContext(bot, view, shared, now) : null;
          const decision = context ? bot.definition.strategy.decide(context) : null;
          if (decision?.action === "UP" || decision?.action === "DOWN") {
            try {
              bot.orderSequence += 1;
              bot.runtime.engine.placeOrder(
                decision.action === "UP" ? "up" : "down",
                decision.stake,
                `bot-${bot.definition.id}-${roundId}-${now}-${bot.orderSequence}`,
                now,
                decision.reason,
              );
              bot.lastOrderAtByRound.set(roundId, now);
              const count = bot.runtime.engine.ledger.openOrdersForRound(roundId).length;
              bot.lastAction = `${decision.reason} · 第${count}单`;
            } catch {
              // The same execution gate as the player is authoritative. Keep
              // retrying during the legal window, but make the state visible.
              bot.lastAction = "信号已出现，等待成交条件";
            }
          } else if (decision) {
            bot.lastAction = decision.reason;
          }
        }
      }

      setBots(runtimes.map((bot) => {
        const view = bot.runtime.engine.getView(now);
        const recentResults = pastResults(bot.runtime.engine.ledger.orders, view.round.id);
        return {
          definition: bot.definition,
          engine: bot.runtime.engine,
          view,
          lastAction: bot.lastAction,
          status: deriveBotDisplayState(bot.definition.id, recentResults, bot.lastAction, bot.coolingDown),
          skippedRoundIds: [...bot.activity.skippedRoundIds],
        };
      }));
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
