"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "@/components/account/use-account";
import { getLeaderboard, getMyRank, getWinRateMinOrders, type LeaderboardEntry, type MyRank } from "@/services/leaderboard-service";
import type { LeaderboardSortKey } from "@/repository";

const money = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TABS: { key: LeaderboardSortKey; label: string }[] = [
  { key: "netProfit", label: "总收益" },
  { key: "roi", label: "ROI" },
  { key: "winRate", label: "胜率" },
  { key: "currentBalance", label: "总资产" },
];

export default function LeaderboardPage() {
  const { account } = useAccount();
  const [sortBy, setSortBy] = useState<LeaderboardSortKey>("netProfit");
  const [rows, setRows] = useState<LeaderboardEntry[]>([]);
  const [mine, setMine] = useState<MyRank | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const minOrders = sortBy === "winRate" ? getWinRateMinOrders() : 0;
    Promise.all([
      getLeaderboard(sortBy, 50, minOrders),
      account ? getMyRank(account.userId, sortBy) : Promise.resolve(null),
    ]).then(([r, m]) => {
      if (!alive) return;
      setRows(r);
      setMine(m);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [sortBy, account]);

  const changeSort = (key: LeaderboardSortKey) => {
    setLoading(true);
    setSortBy(key);
  };

  return (
    <main className="account-page">
      <div className="account-card">
        <h1 className="auth-title">排行榜</h1>
        <div className="lb-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={sortBy === t.key ? "lb-tab active" : "lb-tab"}
              onClick={() => changeSort(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="account-card">
        {loading ? (
          <p className="auth-sub">加载中…</p>
        ) : rows.length === 0 ? (
          <p className="auth-sub">暂无数据</p>
        ) : (
          <div className="lb-list">
            <div className="lb-head">
              <span>排名</span><span>玩家</span><span>净收益</span><span>ROI</span><span>余额</span>
            </div>
            {rows.map((r) => (
              <div className="lb-row" key={r.userId}>
                <span className="lb-rank">{r.rank}</span>
                <span className="lb-name">{r.username}</span>
                <span className={r.netProfit >= 0 ? "up" : "down"}>{r.netProfit > 0 ? "+" : ""}{money.format(r.netProfit)}</span>
                <span>{money.format(r.roi)}%</span>
                <span>{money.format(r.currentBalance)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {mine ? (
        <div className="account-card lb-mine">
          <span>你的排名</span>
          <strong>#{mine.rank}</strong>
          <span>{mine.username}</span>
          <span className={mine.netProfit >= 0 ? "up" : "down"}>{mine.netProfit > 0 ? "+" : ""}{money.format(mine.netProfit)} USDT</span>
          <span>ROI {money.format(mine.roi)}%</span>
        </div>
      ) : account ? null : (
        <span className="auth-link"><Link href="/register">注册后参与排行榜</Link></span>
      )}
    </main>
  );
}
