"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "@/components/account/use-account";
import { logout } from "@/services/account-service";
import type { LeaderboardStats, OrderRecord, Profile, Wallet } from "@/lib/domain/types";
import { authenticatedFetch } from "@/lib/api/authenticated-fetch";

const money = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function ProfilePage() {
  const { account, loading, refresh } = useAccount();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [stats, setStats] = useState<LeaderboardStats | null>(null);
  const [rank, setRank] = useState<number>(-1);

  const loadProfile = async () => authenticatedFetch<{
    profile: Profile | null;
    wallet: Wallet | null;
    orders: OrderRecord[];
    stats: LeaderboardStats | null;
    rank: number;
  }>("/api/account/profile");

  useEffect(() => {
    if (!account) return;
    let alive = true;
    loadProfile().then((data) => {
      if (!alive) return;
      setWallet(data.wallet);
      setOrders(data.orders);
      setStats(data.stats);
      setRank(data.rank);
    });
    return () => {
      alive = false;
    };
  }, [account]);

  const reload = async () => {
    if (!account) return;
    const data = await loadProfile();
    setWallet(data.wallet);
    setOrders(data.orders);
    setStats(data.stats);
    setRank(data.rank);
  };

  const onClaimAll = async () => {
    if (!account) return;
    await authenticatedFetch("/api/game/claim-all", { method: "POST" });
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
            <p className="auth-sub" style={{ marginBottom: 0 }}>排名 {rank > 0 ? `#${rank}` : "—"}</p>
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
          <div className="stat"><span>累计收益</span><strong className={stats && stats.netProfit >= 0 ? "up" : "down"}>{stats && stats.netProfit > 0 ? "+" : ""}{money.format(stats?.netProfit ?? 0)}</strong></div>
          <div className="stat"><span>ROI</span><strong>{stats ? `${money.format(stats.roi)}%` : "—"}</strong></div>
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
