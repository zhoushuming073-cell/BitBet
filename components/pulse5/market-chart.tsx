"use client";

import { useMemo } from "react";
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

function niceStep(value: number) {
  const power = 10 ** Math.floor(Math.log10(value));
  const fraction = value / power;
  const factor = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return factor * power;
}

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
  baselinePrice,
}: {
  points: PricePoint[];
  price: number;
  baselinePrice: number;
}) {
  const rising = !baselinePrice || price >= baselinePrice;
  const delta = baselinePrice ? price - baselinePrice : 0;
  const scale = useMemo(() => {
    const values = points.map((point) => point.price).filter(Number.isFinite);
    if (baselinePrice > 0) values.push(baselinePrice);
    if (price > 0) values.push(price);
    if (!values.length) return { domain: ["auto", "auto"] as const, ticks: undefined, step: 0 };

    let min = values[0];
    let max = values[0];
    for (let index = 1; index < values.length; index += 1) {
      min = Math.min(min, values[index]);
      max = Math.max(max, values[index]);
    }
    const anchor = baselinePrice || price;
    const visibleSpan = Math.max((max - min) * 1.3, anchor * 0.00008, 8);
    const step = niceStep(visibleSpan / 5);
    const center = (min + max) / 2;
    const halfSpan = Math.max((max - min) * 0.65, step * 2.5);
    const lower = Math.floor((center - halfSpan) / step) * step;
    const upper = Math.ceil((center + halfSpan) / step) * step;
    const ticks: number[] = [];
    for (let tick = lower; tick <= upper + step / 2; tick += step) ticks.push(tick);

    return { domain: [lower, upper] as [number, number], ticks, step };
  }, [baselinePrice, points, price]);

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
          <span>{delta >= 0 ? "+" : ""}{money.format(delta)} ({baselinePrice ? ((delta / baselinePrice) * 100).toFixed(3) : "0.000"}%)</span>
        </div>
        {scale.step > 0 && <span className="scale-unit">纵轴 {money.format(scale.step)} USDT / 格</span>}
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
                domain={scale.domain}
                ticks={scale.ticks}
                allowDataOverflow
                orientation="right"
                tickFormatter={(v) => money.format(v)}
                width={86}
                stroke="#66717e"
                tickLine={false}
                axisLine={false}
              />
              {baselinePrice > 0 && (
                <ReferenceLine
                  y={baselinePrice}
                  stroke="#f0b90b"
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                  label={{ value: "上一轮收盘基线", fill: "#f0b90b", fontSize: 11, position: "insideTopLeft" }}
                />
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
