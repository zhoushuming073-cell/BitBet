"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, CircleCheck, LockKeyhole, TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { GAME_CONFIG } from "@/lib/pulse5/game/gameConfig";
import type { Pulse5Engine, EngineView } from "@/lib/pulse5/engine/Pulse5Engine";
import { EngineError } from "@/lib/pulse5/engine/errors";
import type { Side } from "@/lib/pulse5/engine/types";

const money = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const quickMoney = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

const STATE_LABEL: Record<EngineView["bettingState"], string> = {
  OK: "",
  VOLATILITY_WARMING_UP: "行情正在准备，很快可以竞猜",
  ROUND_LOCKED: "本轮已停止竞猜",
  MARKET_ONE_SIDED: "当前方向暂不可选",
  NO_ROUND_OPEN: "正在确认本轮开盘价",
};

function formatCountdown(seconds: number) {
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function roundAmount(value: number) {
  return Math.floor(value * 100) / 100;
}

export function TradePanel({ engine, view }: { engine: Pulse5Engine; view: EngineView }) {
  const [side, setSide] = useState<Side>("up");
  const [stake, setStake] = useState("100");
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);

  const amount = Math.round((Number(stake) || 0) * 100) / 100;
  const estimate = useMemo(
    () => (amount > 0 ? engine.estimateQuote(side, amount, view.now) : null),
    [engine, side, amount, view.now],
  );

  const locked = view.phase === "LOCKED" || view.phase === "ENDED";
  const sideBlocked = side === "up" ? !view.upQuotable : !view.downQuotable;
  const canPredict = view.bettingState === "OK" && !sideBlocked && Boolean(estimate?.quotable) && amount <= view.balance + 1e-9;
  const roundLabel = new Date(view.round.id).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  // Current balance plus this round's committed amount reconstructs the balance
  // at the start of the round, so quick amounts stay stable after a prediction.
  const roundStartingBalance = view.balance + view.position.totalInvested;
  const quickAmounts = [0.1, 0.25, 0.5].map((ratio) => ({
    ratio,
    value: roundAmount(roundStartingBalance * ratio),
  }));

  const chooseSide = (nextSide: Side) => {
    setSide(nextSide);
    setMessage("");
    setSuccess(false);
  };

  const setQuickAmount = (value: number) => {
    setStake(String(Math.min(value, roundAmount(view.balance))));
    setMessage("");
    setSuccess(false);
  };

  const submit = () => {
    const now = Date.now();
    if (!(amount >= GAME_CONFIG.MIN_BET)) {
      setSuccess(false);
      setMessage(`竞猜金额最低为 ${GAME_CONFIG.MIN_BET} USDT`);
      return;
    }
    if (amount > view.balance + 1e-9) {
      setSuccess(false);
      setMessage("虚拟余额不足");
      return;
    }

    try {
      const idempotencyKey = `${now.toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
      engine.placeOrder(side, amount, idempotencyKey, now);
      setSuccess(true);
      setMessage(`已提交${side === "up" ? "看涨" : "看跌"}竞猜，本轮结束后自动结算`);
    } catch (error) {
      setSuccess(false);
      setMessage(error instanceof EngineError ? error.message : "提交失败，请重试");
    }
  };

  const unavailableMessage = STATE_LABEL[view.bettingState];

  return (
    <aside className="prediction-panel" aria-labelledby="prediction-title">
      <div className="round-meta">
        <div>
          <p>第 {roundLabel} 轮</p>
          <span id="prediction-title">预测 5 分钟后 BTC 价格方向</span>
        </div>
        <span className={locked ? "round-status locked" : "round-status"}>
          {locked ? <LockKeyhole aria-hidden="true" /> : null}
          {locked ? "已停止" : "竞猜中"}
        </span>
      </div>

      <div className="countdown" aria-label={`本轮剩余 ${formatCountdown(view.round.secondsRemaining)}`}>
        <strong>{formatCountdown(view.round.secondsRemaining)}</strong>
        <span>本轮剩余时间</span>
      </div>

      <div className="side-choice" aria-label="选择竞猜方向">
        <button
          type="button"
          className={side === "up" ? "up selected" : "up"}
          onClick={() => chooseSide("up")}
          aria-pressed={side === "up"}
          data-testid="side-up"
        >
          <ArrowUp aria-hidden="true" />
          <span>看涨</span>
        </button>
        <button
          type="button"
          className={side === "down" ? "down selected" : "down"}
          onClick={() => chooseSide("down")}
          aria-pressed={side === "down"}
          data-testid="side-down"
        >
          <ArrowDown aria-hidden="true" />
          <span>看跌</span>
        </button>
      </div>

      <label className="stake-label" htmlFor="prediction-stake">竞猜金额</label>
      <div className="stake-input">
        <Input
          id="prediction-stake"
          type="number"
          min={GAME_CONFIG.MIN_BET}
          step="1"
          value={stake}
          onChange={(event) => {
            setStake(event.target.value);
            setMessage("");
            setSuccess(false);
          }}
          inputMode="decimal"
        />
        <span>USDT</span>
      </div>

      <div className="amount-grid" aria-label="快捷金额">
        {quickAmounts.map(({ ratio, value }) => (
          <button key={ratio} type="button" onClick={() => setQuickAmount(value)}>
            {quickMoney.format(value)}
          </button>
        ))}
        <button type="button" onClick={() => setQuickAmount(view.balance)}>全仓</button>
      </div>

      <div className="prediction-detail">
        <span>预计可得</span>
        <strong>{money.format(estimate?.potentialPayout ?? 0)} USDT</strong>
      </div>

      <button
        type="button"
        className="submit-prediction"
        onClick={submit}
        disabled={!canPredict}
        data-testid="submit-order"
      >
        {locked ? "本轮已停止" : `确认${side === "up" ? "看涨" : "看跌"}`}
      </button>

      {(message || unavailableMessage) ? (
        <div className={success ? "form-message success" : "form-message"} role="status">
          {success ? <CircleCheck aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
          <span>{message || unavailableMessage}</span>
        </div>
      ) : null}
    </aside>
  );
}
