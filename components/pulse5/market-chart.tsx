"use client";

import { ArrowDown, ArrowUp, Maximize2 } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PricePoint } from "./types";

const money = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function ChartTip({ active, payload }: { active?: boolean; payload?: Array<{ payload: PricePoint }> }) {
  if (!active || !payload?.[0]) return null;
  const point = payload[0].payload;
  return (
    <div className="chart-tip">
      <span>{new Date(point.time).toLocaleTimeString("zh-CN", { hour12: false })}</span>
      <strong>${money.format(point.price)}</strong>
    </div>
  );
}

export function MarketChart({
  points,
  price,
  openPrice,
}: {
  points: PricePoint[];
  price: number;
  openPrice: number;
}) {
  const rising = !openPrice || price >= openPrice;
  const delta = openPrice ? price - openPrice : 0;

  return (
    <section className="chart-panel" aria-label="BTC 实时价格图表">
      <div className="chart-toolbar">
        <div className="timeframes" aria-label="图表时间范围">
          <button type="button">1m</button>
          <button type="button" className="active">5m</button>
          <button type="button">15m</button>
          <button type="button">1H</button>
        </div>
        <div className={`round-change ${rising ? "up" : "down"}`}>
          {rising ? <ArrowUp /> : <ArrowDown />}
          <span>{delta >= 0 ? "+" : ""}{money.format(delta)} ({openPrice ? ((delta / openPrice) * 100).toFixed(3) : "0.000"}%)</span>
        </div>
        <Maximize2 className="maximize" aria-hidden="true" />
      </div>

      <div className="chart-stage">
        {points.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 18, right: 18, left: 0, bottom: 4 }}>
              <CartesianGrid stroke="#1d2731" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="time"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(v) => new Date(v).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}
                stroke="#66717e"
                tickLine={false}
                axisLine={false}
                minTickGap={48}
              />
              <YAxis
                dataKey="price"
                domain={["auto", "auto"]}
                orientation="right"
                tickFormatter={(v) => money.format(v)}
                width={86}
                stroke="#66717e"
                tickLine={false}
                axisLine={false}
              />
              {openPrice > 0 && (
                <ReferenceLine y={openPrice} stroke="#9a6b15" strokeDasharray="4 4" label={{ value: "开盘", fill: "#b88728", fontSize: 11, position: "insideTopLeft" }} />
              )}
              <Tooltip content={<ChartTip />} isAnimationActive={false} />
              <Line
                type="monotone"
                dataKey="price"
                stroke={rising ? "#37d67a" : "#ff5964"}
                strokeWidth={2.2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="chart-loading">
            <span className="loading-line" />
            <p>正在连接 Binance 行情…</p>
          </div>
        )}
      </div>
    </section>
  );
}
