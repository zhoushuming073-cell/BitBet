"use client";

import { ArrowDown, ArrowUp, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActiveBet, Side } from "./types";

const money = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function BetPanel({
  side,
  setSide,
  stake,
  setStake,
  balance,
  seconds,
  activeBet,
  connected,
  onSubmit,
}: {
  side: Side;
  setSide: (side: Side) => void;
  stake: string;
  setStake: (stake: string) => void;
  balance: number;
  seconds: number;
  activeBet: ActiveBet | null;
  connected: boolean;
  onSubmit: () => void;
}) {
  const n = Number(stake) || 0;
  const locked = Boolean(activeBet);
  const closing = seconds <= 10;
  const invalid = n <= 0 || n > balance || !connected || closing;

  return (
    <aside className="bet-panel" aria-label="本轮虚拟预测">
      <div className="panel-heading">
        <div>
          <p>选择方向</p>
          <span>本轮只能提交一次</span>
        </div>
        {(locked || closing) && <span className="locked"><LockKeyhole /> {locked ? "已锁定" : "已封盘"}</span>}
      </div>

      <div className="side-choice">
        <button type="button" className={side === "up" ? "up selected" : "up"} onClick={() => setSide("up")} disabled={locked} aria-pressed={side === "up"}>
          <ArrowUp />
          <span><strong>看涨</strong><small>Up</small></span>
        </button>
        <button type="button" className={side === "down" ? "down selected" : "down"} onClick={() => setSide("down")} disabled={locked} aria-pressed={side === "down"}>
          <ArrowDown />
          <span><strong>看跌</strong><small>Down</small></span>
        </button>
      </div>

      <label className="stake-label" htmlFor="stake">投入金额（USDT）</label>
      <div className="stake-input">
        <Input id="stake" type="number" min="1" step="1" value={stake} onChange={(e) => setStake(e.target.value)} disabled={locked} aria-describedby="balance-hint" />
        <span>USDT</span>
      </div>
      <div className="amount-grid">
        {[100, 500, 1000].map((amount) => (
          <Button key={amount} type="button" variant="outline" onClick={() => setStake(String(Math.min(amount, balance)))} disabled={locked || balance <= 0}>{amount}</Button>
        ))}
        <Button type="button" variant="outline" onClick={() => setStake(String(Math.floor(balance * 100) / 100))} disabled={locked || balance <= 0}>全部</Button>
      </div>

      <div className="balance-row" id="balance-hint">
        <span>可用虚拟余额</span>
        <strong>{money.format(balance)} <small>USDT</small></strong>
      </div>

      <div className="payout-preview">
        <div>
          <span>预测正确</span>
          <strong className="profit">+{money.format(n * 0.85)} USDT</strong>
          <small>返还本金并获得 85% 收益</small>
        </div>
        <div>
          <span>预测错误</span>
          <strong className="loss">−{money.format(n)} USDT</strong>
          <small>平局将退回本金</small>
        </div>
      </div>

      <Button
        type="button"
        className={`submit-bet ${side}`}
        onClick={onSubmit}
        disabled={locked || invalid}
      >
        {locked ? `等待结算 · ${seconds} 秒` : closing ? `本轮已封盘 · ${seconds} 秒` : connected ? `确认${side === "up" ? "看涨" : "看跌"} · ${seconds} 秒` : "正在连接行情"}
      </Button>
      <p className="bet-note">提交后不可撤销；这里的撤销只影响虚拟游戏，不涉及任何真实资产。</p>
    </aside>
  );
}
