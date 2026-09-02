"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { GameRecord } from "./types";

const money = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function HistoryTable({ records }: { records: GameRecord[] }) {
  return (
    <section className="history-panel">
      <div className="history-heading">
        <h2>最近记录</h2>
        <span>仅保存在当前浏览器</span>
      </div>
      {records.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>轮次</TableHead>
              <TableHead>方向</TableHead>
              <TableHead>投入</TableHead>
              <TableHead>基准价</TableHead>
              <TableHead>结算价</TableHead>
              <TableHead>结果</TableHead>
              <TableHead className="text-right">盈亏（USDT）</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.slice(0, 8).map((record) => (
              <TableRow key={record.id}>
                <TableCell className="round-id">{new Date(record.start).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</TableCell>
                <TableCell><span className={`direction ${record.side}`}>{record.side === "up" ? <ArrowUp /> : <ArrowDown />}{record.side === "up" ? "看涨" : "看跌"}</span></TableCell>
                <TableCell>{money.format(record.stake)}</TableCell>
                <TableCell>{money.format(record.open)}</TableCell>
                <TableCell>{money.format(record.close)}</TableCell>
                <TableCell><span className={`result ${record.result}`}>{record.result === "win" ? "正确" : record.result === "loss" ? "错误" : "平局"}</span></TableCell>
                <TableCell className={`pnl text-right ${record.pnl >= 0 ? "positive" : "negative"}`}>{record.pnl > 0 ? "+" : ""}{money.format(record.pnl)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <div className="empty-history"><p>还没有记录</p><span>完成第一局后，结果会出现在这里。</span></div>
      )}
    </section>
  );
}
