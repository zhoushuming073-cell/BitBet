"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, CircleDollarSign, ShieldCheck, WalletCards, Waves } from "lucide-react";
import { BetPanel } from "./bet-panel";
import { HistoryTable } from "./history-table";
import { MarketChart } from "./market-chart";
import type { ActiveBet, GameRecord, PricePoint, Side, Ticker } from "./types";

const ROUND_MS = 5 * 60 * 1000;
const START_BALANCE = 10_000;
const KEY = "pulse5-game-v1";
const money = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 2 });

type StoredGame = { balance: number; activeBet: ActiveBet | null; records: GameRecord[] };

const roundFor = (time: number) => {
  const start = Math.floor(time / ROUND_MS) * ROUND_MS;
  return { start, end: start + ROUND_MS };
};

async function getKlines(start?: number, limit = 80) {
  const base = "https://data-api.binance.vision/api/v3/klines";
  const params = new URLSearchParams({ symbol: "BTCUSDT", interval: "1m", limit: String(limit) });
  if (start) params.set("startTime", String(start));
  const response = await fetch(`${base}?${params}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Binance kline request failed");
  return (await response.json()) as Array<[number, string, string, string, string, string]>;
}

export function MarketGame() {
  const [now, setNow] = useState(Date.now());
  const [ticker, setTicker] = useState<Ticker>({ price: 0, change: 0, high: 0, low: 0, volume: 0, quoteVolume: 0 });
  const [points, setPoints] = useState<PricePoint[]>([]);
  const [openPrice, setOpenPrice] = useState(0);
  const [connected, setConnected] = useState(false);
  const [balance, setBalance] = useState(START_BALANCE);
  const [activeBet, setActiveBet] = useState<ActiveBet | null>(null);
  const [records, setRecords] = useState<GameRecord[]>([]);
  const [side, setSide] = useState<Side>("up");
  const [stake, setStake] = useState("100");
  const [ready, setReady] = useState(false);
  const settling = useRef(false);
  const round = useMemo(() => roundFor(now), [now]);
  const seconds = Math.max(0, Math.ceil((round.end - now) / 1000));
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  const progress = ((ROUND_MS - (round.end - now)) / ROUND_MS) * 100;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) {
        const game = JSON.parse(saved) as StoredGame;
        setBalance(Number.isFinite(game.balance) ? game.balance : START_BALANCE);
        setActiveBet(game.activeBet ?? null);
        setRecords(Array.isArray(game.records) ? game.records : []);
      }
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    const game: StoredGame = { balance, activeBet, records };
    localStorage.setItem(KEY, JSON.stringify(game));
  }, [ready, balance, activeBet, records]);

  useEffect(() => {
    let cancelled = false;
    getKlines(undefined, 80)
      .then((rows) => {
        if (cancelled) return;
        setPoints(rows.map((row) => ({ time: row[0], price: Number(row[4]) })));
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getKlines(round.start, 1)
      .then((rows) => {
        if (!cancelled && rows[0]) setOpenPrice(Number(rows[0][1]));
      })
      .catch(() => {
        if (!cancelled) setOpenPrice(0);
      });
    return () => { cancelled = true; };
  }, [round.start]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnect = 0;
    let endpoint = 0;
    let stopped = false;
    const endpoints = [
      "wss://data-stream.binance.vision/ws/btcusdt@ticker",
      "wss://stream.binance.com:9443/ws/btcusdt@ticker",
    ];

    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(endpoints[endpoint]);
      socket.onopen = () => setConnected(true);
      socket.onmessage = (event) => {
        const data = JSON.parse(event.data) as { c: string; P: string; h: string; l: string; v: string; q: string; E: number };
        const price = Number(data.c);
        setTicker({ price, change: Number(data.P), high: Number(data.h), low: Number(data.l), volume: Number(data.v), quoteVolume: Number(data.q) });
        setPoints((current) => [...current.slice(-159), { time: data.E || Date.now(), price }]);
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        setConnected(false);
        if (stopped) return;
        endpoint = (endpoint + 1) % endpoints.length;
        reconnect = window.setTimeout(connect, 2500);
      };
    };
    connect();
    return () => {
      stopped = true;
      window.clearTimeout(reconnect);
      socket?.close();
    };
  }, []);

  const settle = useCallback(async (bet: ActiveBet) => {
    if (settling.current) return;
    settling.current = true;
    let close = ticker.price;
    try {
      const rows = await getKlines(bet.end, 1);
      if (rows[0]) close = Number(rows[0][1]);
    } catch {
      // The first live tick after expiry remains a useful fallback.
    }
    if (!close) {
      settling.current = false;
      return;
    }
    const move = close === bet.open ? "tie" : (close > bet.open) === (bet.side === "up") ? "win" : "loss";
    const pnl = move === "win" ? bet.stake * 0.85 : move === "loss" ? -bet.stake : 0;
    const credit = move === "win" ? bet.stake * 1.85 : move === "tie" ? bet.stake : 0;
    setBalance((value) => value + credit);
    setRecords((value) => [{ ...bet, close, result: move, pnl }, ...value].slice(0, 50));
    setActiveBet(null);
    settling.current = false;
  }, [ticker.price]);

  useEffect(() => {
    if (activeBet && now >= activeBet.end) settle(activeBet);
  }, [activeBet, now, settle]);

  const submitBet = () => {
    const amount = Math.round((Number(stake) || 0) * 100) / 100;
    if (!connected || activeBet || seconds <= 10 || amount <= 0 || amount > balance || !openPrice) return;
    const bet: ActiveBet = { id: round.start, start: round.start, end: round.end, side, stake: amount, open: openPrice };
    setBalance((value) => value - amount);
    setActiveBet(bet);
  };

  const resetGame = () => {
    if (!window.confirm("确定重置虚拟余额和全部战绩吗？")) return;
    setBalance(START_BALANCE);
    setActiveBet(null);
    setRecords([]);
    setStake("100");
  };

  const priceUp = !openPrice || ticker.price >= openPrice;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><Waves aria-hidden="true" /><span>Pulse5</span></div>
        <div className="pair"><strong>BTC/USDT</strong><span>5分钟</span></div>
        <div className="top-spacer" />
        <div className={`live-status ${connected ? "online" : "offline"}`}><span />{connected ? "Binance 实时行情" : "行情重连中"}</div>
        <div className="wallet"><WalletCards /><span>虚拟余额</span><strong>{money.format(balance)} USDT</strong></div>
        <button className="reset" type="button" onClick={resetGame}>重置</button>
      </header>

      <section className="market-strip" aria-label="BTC 24小时市场数据">
        <div className="primary-price"><span>最新价</span><strong className={priceUp ? "up" : "down"}>${ticker.price ? money.format(ticker.price) : "—"}</strong></div>
        <div><span>24h 涨跌</span><strong className={ticker.change >= 0 ? "up" : "down"}>{ticker.price ? `${ticker.change >= 0 ? "+" : ""}${ticker.change.toFixed(2)}%` : "—"}</strong></div>
        <div><span>24h 最高</span><strong>{ticker.high ? `$${money.format(ticker.high)}` : "—"}</strong></div>
        <div><span>24h 最低</span><strong>{ticker.low ? `$${money.format(ticker.low)}` : "—"}</strong></div>
        <div><span>24h 成交量（BTC）</span><strong>{ticker.volume ? compact.format(ticker.volume) : "—"}</strong></div>
        <div><span>24h 成交额（USDT）</span><strong>{ticker.quoteVolume ? compact.format(ticker.quoteVolume) : "—"}</strong></div>
      </section>

      <div className="workspace">
        <section className="market-panel">
          <div className="round-header">
            <div className="round-title"><CircleDollarSign /><div><h1>BTC 5分钟涨跌</h1><span>第 {new Date(round.start).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })} 轮</span></div></div>
            <div className="timer-wrap">
              <div className="timer-ring" style={{ "--progress": `${progress * 3.6}deg` } as React.CSSProperties}><strong>{mm}:{ss}</strong></div>
              <span>本轮倒计时</span>
            </div>
            <div className="round-price"><span>开盘价</span><strong>{openPrice ? money.format(openPrice) : "—"}</strong></div>
            <div className="round-price"><span>当前价</span><strong className={priceUp ? "up" : "down"}>{ticker.price ? money.format(ticker.price) : "—"}</strong></div>
          </div>
          <MarketChart points={points} price={ticker.price} openPrice={openPrice} />
        </section>

        <BetPanel side={side} setSide={setSide} stake={stake} setStake={setStake} balance={balance} seconds={seconds} activeBet={activeBet} connected={connected} onSubmit={submitBet} />
      </div>

      <HistoryTable records={records} />

      <footer>
        <ShieldCheck />
        <span>纯模拟 · 不连接钱包 · 不产生真实订单</span>
        <span className="footer-dot">·</span>
        <span>行情来自 Binance 公共数据流</span>
        <Activity className="footer-activity" />
      </footer>
    </main>
  );
}
