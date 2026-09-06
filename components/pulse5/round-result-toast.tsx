"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import type { SettlementNotice } from "@/lib/pulse5/engine/types";

const money = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function roundClock(roundId: number) {
  return new Date(roundId).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function signed(v: number) {
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${money.format(Math.abs(v))}`;
}

const RESULT_TEXT: Record<string, string> = { UP: "收涨", DOWN: "收跌", DRAW: "平局" };

/**
 * Non-blocking round-result card. Appears the moment a round settles and fades
 * out automatically, so the hand-off to the next round reads as intentional
 * instead of orders simply vanishing.
 */
export function RoundResultToast({ notice }: { notice: SettlementNotice | null }) {
  // Only the auto-hide marker lives in state; the notice itself is rendered
  // straight from props, so no synchronous setState happens inside the effect.
  const [hiddenRound, setHiddenRound] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const roundId = notice?.roundId ?? null;

  useEffect(() => {
    if (roundId == null) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setHiddenRound(roundId), 5200);
    return () => window.clearTimeout(timer.current);
  }, [roundId]);

  if (!notice || !notice.winningSide || notice.roundId === hiddenRound) return null;

  const side = notice.winningSide;
  const tone = side === "UP" ? "is-up" : side === "DOWN" ? "is-down" : "is-draw";
  const Icon = side === "UP" ? ArrowUp : side === "DOWN" ? ArrowDown : Minus;

  return (
    <div className="round-toast-layer" aria-live="polite">
      <div className={`round-toast ${tone}`} key={notice.roundId}>
        <div className="rt-head">
          <span className="rt-icon"><Icon /></span>
          <strong>第 {roundClock(notice.roundId)} 轮 {RESULT_TEXT[side]}</strong>
        </div>
        {notice.orderCount > 0 ? (
          <div className="rt-body">
            <span>竞猜 {money.format(notice.totalInvested)}</span>
            <span>到账 {money.format(notice.grossPayout)}</span>
            <span className={notice.roundPnL >= 0 ? "up" : "down"}>
              盈亏 {signed(notice.roundPnL)}
            </span>
          </div>
        ) : (
          <div className="rt-body"><span>新一轮已开始</span></div>
        )}
      </div>
    </div>
  );
}
