"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Gift, Minus } from "lucide-react";
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
 * instead of orders simply vanishing. When the round paid out, a one-tap
 * "立即领取" collects the winnings right here for a satisfying claim moment.
 */
export function RoundResultToast({
  notice,
  onClaim,
}: {
  notice: SettlementNotice | null;
  onClaim?: () => void | boolean | Promise<void | boolean>;
}) {
  // Only the auto-hide marker lives in state; the notice itself is rendered
  // straight from props, so no synchronous setState happens inside the effect.
  const [hiddenRound, setHiddenRound] = useState<number | null>(null);
  const [claimStatus, setClaimStatus] = useState<{
    roundId: number | null;
    state: "idle" | "claiming" | "failed";
  }>({ roundId: null, state: "idle" });
  const timer = useRef<number | undefined>(undefined);
  const roundId = notice?.roundId ?? null;
  const claimState = claimStatus.roundId === roundId ? claimStatus.state : "idle";

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
  const claimable = notice.grossPayout > 0;

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
            <span>可领取 {money.format(notice.grossPayout)}</span>
            <span className={notice.roundPnL >= 0 ? "up" : "down"}>
              盈亏 {signed(notice.roundPnL)}
            </span>
          </div>
        ) : (
          <div className="rt-body"><span>新一轮已开始</span></div>
        )}
        {claimable && onClaim ? (
          <button
            type="button"
            className="rt-claim"
            disabled={claimState === "claiming"}
            onClick={async () => {
              setClaimStatus({ roundId: notice.roundId, state: "claiming" });
              try {
                const claimed = await onClaim();
                if (claimed === false) {
                  setClaimStatus({ roundId: notice.roundId, state: "failed" });
                  return;
                }
                setHiddenRound(notice.roundId);
              } catch {
                setClaimStatus({ roundId: notice.roundId, state: "failed" });
              }
            }}
          >
            <Gift aria-hidden="true" />
            {claimState === "claiming" ? "领取中…" : claimState === "failed" ? "领取失败，请重试" : "立即领取"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
