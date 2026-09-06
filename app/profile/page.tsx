"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "@/components/account/use-account";
import { getOrderHistory, getWalletSummary, type WalletSummary } from "@/services/history-service";
import { getMyRank } from "@/services/leaderboard-service";
import { claimAll } from "@/services/wallet-service";
import { logout } from "@/services/account-service";
import type { OrderRecord } from "@/lib/domain/types";

const money = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ProfilePage() {
  const { account, loading, refresh } = useAccount();
  const [wallet, setWallet] = useState<WalletSummary | null>(null);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [rank, setRank] = useState<{ rank: number; roi: number; netProfit: number } | null>(null);

  useEffect(() => {
    if (!account) return;
    let alive = true;
    Promise.all([
      getWalletSummary(account.userId),
      getOrderHistory(account.userId, 20),
      getMyRank(account.userId, "netProfit"),
    ]).then(([w, o, r]) => {
      if (!alive) return;
      setWallet(w);
      setOrders(o);
      setRank(r);
    });
    return () => {
      alive = false;
    };
  }, [account]);

  const reload = async () => {
    if (!account) return;
    const [w, o, r] = await Promise.all([
      getWalletSummary(account.userId),
      getOrderHistory(account.userId, 20),
      getMyRank(account.userId, "netProfit"),
    ]);
    setWallet(w);
    setOrders(o);
    setRank(r);
  };

  const onClaimAll = async () => {
    if (!account) return;
    await claimAll(account.userId);
    await Promise.all([reload(), refresh()]);
  };

  const onLogout = async () => {
    await logout();
    await refresh();
  };

  if (loading) {
    return <main className="account-page"><div className="account-card"><p className="auth-sub">加载中…</p></div></main>;
  }

  if (!account) {
    return (
      <main className="account-page">
        <div className="account-card">
          <h1 className="auth-title">个人中心</h1>
          <p className="auth-sub">登录后可保存资产、历史战绩并参与排行榜</p>
          <Link href="/register" className="auth-button" style={{ display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>注册</Link>
          <Link href="/login" className="auth-button auth-button-ghost" style={{ display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>登录</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="account-page">
      <div className="account-card">
        <div className="profile-head">
          <div>
            <h1 className="auth-title" style={{ marginBottom: 0 }}>{account.username}</h1>
            <p className="auth-sub" style={{ marginBottom: 0 }}>排名 #{rank?.rank ?? "—"}</p>
          </div>
          <button className="auth-link-btn" type="button" onClick={onLogout}>退出登录</button>
        </div>
      </div>

      <div className="account-card profile-stats">
        <div className="stat-row">
          <div className="stat"><span>可用余额</span><strong>{money.format(wallet?.availableBalance ?? 0)} USDT</strong></div>
          <div className="stat"><span>待领取</span><strong className="up">{money.format(wallet?.pendingClaim ?? 0)} USDT</strong></div>
        </div>
        <div className="stat-row">
          <div className="stat"><span>累计收益</span><strong className={rank && rank.netProfit >= 0 ? "up" : "down"}>{rank && rank.netProfit > 0 ? "+" : ""}{money.format(rank?.netProfit ?? 0)}</strong></div>
          <div className="stat"><span>ROI</span><strong>{rank ? `${money.format(rank.roi)}%` : "—"}</strong></div>
        </div>
        {(wallet?.pendingClaim ?? 0) > 0 ? (
          <button className="auth-button" type="button" onClick={onClaimAll} style={{ marginTop: 16 }}>
            一键领取 +{money.format(wallet?.pendingClaim ?? 0)} USDT
          </button>
        ) : null}
      </div>

      <div className="account-card">
        <h2 className="section-title">历史竞猜</h2>
        {orders.length === 0 ? (
          <p className="auth-sub">还没有竞猜记录</p>
        ) : (
          <div className="history-list">
            {orders.slice(0, 10).map((o) => (
              <div className="profile-row" key={o.orderId}>
                <span className={o.side === "up" ? "up" : "down"}>{o.side === "up" ? "看涨" : "看跌"}</span>
                <span>{money.format(o.stake)} USDT</span>
                <span className="auth-sub" style={{ margin: 0 }}>{o.lockedOdds.toFixed(2)}x</span>
                <span className={o.profit >= 0 ? "up" : "down"}>{o.profit > 0 ? "+" : ""}{money.format(o.profit)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
