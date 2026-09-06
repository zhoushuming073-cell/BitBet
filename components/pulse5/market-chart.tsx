"use client";

import { useEffect, useRef } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { Order, PricePoint } from "./types";
import { CHART_CONFIG as C, VISIBLE_WINDOW_MS, clamp01, easeOutCubic } from "./chartConfig";
import { lowerBound, rangeFromExtents, smoothRange } from "./chartScale";
import { drawSmoothPath, type ChartPoint } from "./chartSmoothing";

const money = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const UP = "#37d67a";
const DOWN = "#ff5964";
const GRID = "#28313a";
const AXIS_TEXT = "#7c8792";
const OPEN_COLOR = "#f7931a";
const PAD_L = 6;
const PAD_R = 76;
const PAD_T = 12;
const PAD_B = 20;

function niceStep(value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const fraction = value / power;
  const factor = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return factor * power;
}

interface AnimState {
  startPrice: number;
  targetPrice: number;
  startPerf: number;
  duration: number;
  rendered: number;
  lastTarget: number;
}

export function MarketChart({
  points,
  price,
  roundOpen,
  roundStart,
  connected,
  orders,
}: {
  points: PricePoint[];
  price: number;
  roundOpen: number;
  roundStart: number;
  connected: boolean;
  orders: Order[];
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Latest React props are mirrored into a ref so the 60fps loop never triggers
  // (or waits on) a React re-render.
  const propsRef = useRef({ points, price, roundOpen, roundStart, connected, orders });
  // Keep the last non-empty series so a transient empty update never blanks the
  // chart (UI resilience — the data layer must still be fixed, not just masked).
  const lastValidRef = useRef<PricePoint[]>([]);
  useEffect(() => {
    propsRef.current = { points, price, roundOpen, roundStart, connected, orders };
    if (points.length > 0) lastValidRef.current = points;
  });

  const rising = !roundOpen || price >= roundOpen;
  const delta = roundOpen ? price - roundOpen : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const maybeCtx = canvas.getContext("2d");
    if (!maybeCtx) return;
    const ctx: CanvasRenderingContext2D = maybeCtx;

    let cssW = 0;
    let cssH = 0;
    let raf = 0;
    let disposed = false;

    // Smoothed price-scale state (expand fast / shrink slow with hysteresis).
    let dispMin = 0;
    let dispMax = 0;
    let scaleInited = false;
    let shrinkAllowedAt = 0;

    const anim: AnimState = {
      startPrice: 0,
      targetPrice: 0,
      startPerf: 0,
      duration: C.PRICE_INTERPOLATION_MS,
      rendered: 0,
      lastTarget: 0,
    };

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cssW = Math.max(0, rect.width);
      cssH = Math.max(0, rect.height);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement ?? canvas);
    resize();

    const xOf = (t: number, left: number, plotW: number) =>
      PAD_L + ((t - left) / VISIBLE_WINDOW_MS) * plotW;
    const yOf = (p: number, plotH: number) =>
      PAD_T + ((dispMax - p) / (dispMax - dispMin || 1)) * plotH;

    function frame(perfNow: number) {
      if (disposed) return;
      const p = propsRef.current;

      // ---- 1. retarget / interpolate the live price (performance.now time) ----
      if (Number.isFinite(p.price) && p.price > 0) {
        if (!anim.lastTarget) {
          anim.startPrice = p.price;
          anim.targetPrice = p.price;
          anim.rendered = p.price;
          anim.startPerf = perfNow;
        } else if (p.price !== anim.targetPrice) {
          // Mid-flight retarget: keep tracking from wherever we rendered to.
          anim.startPrice = anim.rendered;
          anim.targetPrice = p.price;
          anim.startPerf = perfNow;
          const rel = Math.abs(p.price - anim.startPrice) / p.price;
          anim.duration = rel > C.JUMP_RELATIVE ? C.JUMP_INTERPOLATION_MS : C.PRICE_INTERPOLATION_MS;
        }
        anim.lastTarget = p.price;
        const t = clamp01((perfNow - anim.startPerf) / anim.duration);
        anim.rendered = anim.startPrice + (anim.targetPrice - anim.startPrice) * easeOutCubic(t);
      }
      const livePrice = anim.rendered || p.price || 0;

      // ---- 2. continuous 1-minute sliding window (wall-clock right edge) ----
      const right = Date.now();
      const left = right - VISIBLE_WINDOW_MS;
      const plotW = Math.max(1, cssW - PAD_L - PAD_R);
      const plotH = Math.max(1, cssH - PAD_T - PAD_B);

      // ---- 3. resolve visible series + target Y range (single pass) ----
      let sourcePoints = p.points;
      if (sourcePoints.length === 0 && lastValidRef.current.length > 0) {
        sourcePoints = lastValidRef.current;
      }
      const startIdx = lowerBound(sourcePoints, left);
      let rawMin = Infinity;
      let rawMax = -Infinity;
      for (let i = startIdx; i < sourcePoints.length; i += 1) {
        const v = sourcePoints[i].price;
        if (v < rawMin) rawMin = v;
        if (v > rawMax) rawMax = v;
      }
      const target = rangeFromExtents({ visibleMin: rawMin, visibleMax: rawMax, roundOpen: p.roundOpen, livePrice });
      if (!target) {
        raf = requestAnimationFrame(frame);
        return;
      }

      // ---- 4. smooth scale: expand fast, shrink slow after a calm delay ----
      if (!scaleInited) {
        dispMin = target.lo;
        dispMax = target.hi;
        scaleInited = true;
      } else {
        const out = smoothRange({ lo: dispMin, hi: dispMax }, target, perfNow, shrinkAllowedAt);
        dispMin = out.range.lo;
        dispMax = out.range.hi;
        shrinkAllowedAt = out.shrinkAllowedAt;
      }
      const effRange = dispMax - dispMin;

      // ---- 5. paint ----
      ctx.clearRect(0, 0, cssW, cssH);

      // horizontal grid + right-side price labels
      const yStep = niceStep(effRange / 5);
      ctx.font = "11px SFMono-Regular, Consolas, monospace";
      ctx.textBaseline = "middle";
      const gridLow = Math.ceil(dispMin / yStep) * yStep;
      ctx.lineWidth = 1;
      for (let gv = gridLow; gv <= dispMax; gv += yStep) {
        const y = yOf(gv, plotH);
        if (y < PAD_T - 1 || y > PAD_T + plotH + 1) continue;
        ctx.strokeStyle = GRID;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(PAD_L, y);
        ctx.lineTo(PAD_L + plotW, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = AXIS_TEXT;
        ctx.textAlign = "left";
        ctx.fillText(money.format(gv), PAD_L + plotW + 8, y);
      }

      // vertical time grid every 30s
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const tStep = 30_000;
      const t0 = Math.ceil(left / tStep) * tStep;
      for (let tv = t0; tv <= right; tv += tStep) {
        const x = xOf(tv, left, plotW);
        ctx.strokeStyle = GRID;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, PAD_T);
        ctx.lineTo(x, PAD_T + plotH);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = AXIS_TEXT;
        const d = new Date(tv);
        ctx.fillText(
          `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`,
          x,
          PAD_T + plotH + 5,
        );
      }

      // round-open horizontal reference (always retained while known)
      if (p.roundOpen > 0) {
        const yo = yOf(p.roundOpen, plotH);
        if (yo >= PAD_T && yo <= PAD_T + plotH) {
          ctx.strokeStyle = OPEN_COLOR;
          ctx.lineWidth = 1.4;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          ctx.moveTo(PAD_L, yo);
          ctx.lineTo(PAD_L + plotW, yo);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = OPEN_COLOR;
          ctx.textAlign = "left";
          ctx.textBaseline = "bottom";
          ctx.fillText(`开盘 ${money.format(p.roundOpen)}`, PAD_L + 6, yo - 3);
        }
      }

      // round-start vertical marker, only while inside the 1-minute window
      if (p.roundStart >= left && p.roundStart <= right) {
        const xs = xOf(p.roundStart, left, plotW);
        ctx.strokeStyle = "#4b5a68";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(xs, PAD_T);
        ctx.lineTo(xs, PAD_T + plotH);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // price line: fixed history samples + one animated live endpoint, drawn as
      // a single monotone-cubic path (no per-segment stroke → no seams, no overshoot).
      const lineColor = livePrice >= (p.roundOpen || livePrice) ? UP : DOWN;
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = cssW < 680 ? 1.3 : 1.7;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      const curvePts: ChartPoint[] = [];
      for (let i = startIdx; i < sourcePoints.length; i += 1) {
        const s = sourcePoints[i];
        curvePts.push({ x: xOf(s.time, left, plotW), y: yOf(s.price, plotH) });
      }
      if (livePrice > 0) curvePts.push({ x: xOf(right, left, plotW), y: yOf(livePrice, plotH) });

      if (curvePts.length > 0) {
        ctx.beginPath();
        drawSmoothPath(ctx, curvePts);
        ctx.stroke();
      }

      // order markers — only those still inside the rolling window.
      // Mobile keeps it minimal (small dots only); desktop adds a compact label.
      const compact = cssW < 680;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      for (let i = 0; i < p.orders.length; i += 1) {
        const o = p.orders[i];
        if (o.createdAt < left || o.createdAt > right) continue;
        const x = xOf(o.createdAt, left, plotW);
        const y = yOf(o.priceAtEntry, plotH);
        if (y < PAD_T || y > PAD_T + plotH) continue;
        const col = o.side === "up" ? UP : DOWN;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(x, y, compact ? 2.6 : 3.4, 0, Math.PI * 2);
        ctx.fill();
        if (!compact) {
          ctx.font = "10px SFMono-Regular, Consolas, monospace";
          ctx.fillText(`${o.side === "up" ? "涨" : "跌"} ${o.stake} @${o.lockedOdds.toFixed(2)}`, x, y - 6);
          ctx.font = "11px SFMono-Regular, Consolas, monospace";
        }
      }

      // live dot + current-price tag pinned to the right edge
      if (livePrice > 0) {
        const lx = xOf(right, left, plotW);
        const ly = yOf(livePrice, plotH);
        const cy = Math.min(Math.max(ly, PAD_T + 8), PAD_T + plotH - 8);
        ctx.fillStyle = lineColor;
        ctx.beginPath();
        ctx.arc(lx, ly, 3.2, 0, Math.PI * 2);
        ctx.fill();
        const label = `$${money.format(livePrice)}`;
        ctx.font = "600 11px SFMono-Regular, Consolas, monospace";
        const tw = ctx.measureText(label).width + 12;
        ctx.fillStyle = lineColor;
        ctx.globalAlpha = 0.18;
        ctx.fillRect(PAD_L + plotW + 2, cy - 9, tw, 18);
        ctx.globalAlpha = 1;
        ctx.fillStyle = lineColor;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(label, PAD_L + plotW + 8, cy);
      }

      raf = requestAnimationFrame(frame);
    }

    const start = () => {
      if (!raf) raf = requestAnimationFrame((t) => { raf = 0; frame(t); });
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        // Back in foreground: snap to the latest real price, resume smoothly.
        const pr = propsRef.current;
        if (pr.price > 0) {
          anim.startPrice = pr.price;
          anim.targetPrice = pr.price;
          anim.rendered = pr.price;
          anim.lastTarget = pr.price;
        }
        start();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    start();

    return () => {
      disposed = true;
      stop();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <section className="chart-panel" aria-label="BTC 实时价格图表">
      <div className="chart-toolbar">
        <div className={`round-change ${rising ? "up" : "down"}`}>
          {rising ? <ArrowUp /> : <ArrowDown />}
          <span>{delta >= 0 ? "+" : ""}{money.format(delta)} ({roundOpen ? ((delta / roundOpen) * 100).toFixed(3) : "0.000"}%)</span>
        </div>
      </div>

      <div className="chart-stage">
        <canvas ref={canvasRef} className="price-canvas" />
      </div>
    </section>
  );
}
