"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserEngine, type BrowserRuntime } from "@/lib/pulse5/engine/createBrowserEngine";
import type { EngineView } from "@/lib/pulse5/engine/Pulse5Engine";
import { BOT_DEFINITIONS } from "@/lib/pulse5/bots";
import type { BotDisplayState } from "@/lib/pulse5/bots/BotDisplayState";
import type { AuthorityBotPayload } from "@/lib/game/authority-client";

type BotDefinition = (typeof BOT_DEFINITIONS)[number];

export interface TradingBotState {
  definition: BotDefinition;
  engine: BrowserRuntime["engine"];
  view: EngineView;
  lastAction: string;
  status: BotDisplayState;
  skippedRoundIds: number[];
}

/** Passive UI mirrors. Bot decisions and orders are server-only. */
export function useTradingBots(marketView: EngineView | null, authorityBots: AuthorityBotPayload[]): TradingBotState[] {
  const runtimes = useRef<Map<string, BrowserRuntime>>(new Map());
  const [bots, setBots] = useState<TradingBotState[]>([]);

  useEffect(() => {
    const activeRuntimes = runtimes.current;
    for (const definition of BOT_DEFINITIONS) {
      if (!activeRuntimes.has(definition.id)) {
        activeRuntimes.set(definition.id, createBrowserEngine({ passive: true, persist: false }));
      }
    }
    return () => {
      for (const runtime of activeRuntimes.values()) runtime.stop();
      activeRuntimes.clear();
    };
  }, []);

  useEffect(() => {
    if (!marketView?.market || authorityBots.length === 0) return;
    const now = Date.now();
    const next: TradingBotState[] = [];
    for (const payload of authorityBots) {
      const definition = BOT_DEFINITIONS.find((item) => item.id === payload.id);
      const runtime = runtimes.current.get(payload.id);
      if (!definition || !runtime) continue;
      const engine = runtime.engine;
      engine.restoreLedger(payload.snapshot);
      engine.setConnected(marketView.connected);
      engine.setRoundOpen(marketView.round.id, marketView.market.roundOpen);
      engine.onBookTicker(marketView.market.bestBid, marketView.market.bestAsk, marketView.market.marketTimestamp);
      engine.onTrade(marketView.market.lastPrice || marketView.market.midPrice, marketView.market.marketTimestamp);
      engine.onTicker24h(marketView.ticker);
      engine.seedChart(marketView.points.filter((point) => point.time <= now));
      engine.tick(now);
      next.push({
        definition,
        engine,
        view: engine.getView(now),
        lastAction: payload.lastAction,
        status: payload.status,
        skippedRoundIds: payload.skippedRoundIds,
      });
    }
    const commit = window.setTimeout(() => setBots(next), 0);
    return () => window.clearTimeout(commit);
  }, [authorityBots, marketView]);

  return bots;
}
