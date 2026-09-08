import { GAME_CONFIG } from "../game/gameConfig";
import { roundFor } from "../game/RoundEngine";
import type { Ticker24h } from "../engine/types";

type RawOkxCandle = [string, string, string, string, string, string, string, string, string];

export type RawKline = [number, string, string, string, string, string, number];

export interface ClosedCandle {
  openTime: number;
  open: number;
  close: number;
  closed: boolean;
}

export interface AggTrade {
  p: string;
  T: number;
}

const REST_BASE = "https://www.okx.com/api/v5/market";
const WS_ENDPOINT = "wss://ws.okx.com:8443/ws/v5/public";
const INSTRUMENT = "BTC-USDT";
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;

export interface FeedHandlers {
  onBook: (bid: number, ask: number, ts: number) => void;
  onTrade: (price: number, ts: number) => void;
  onKline: (openTime: number, open: number, close: number, closed: boolean, ts: number) => void;
  onTicker: (ticker: Ticker24h, ts: number) => void;
  onStatus: (connected: boolean) => void;
}

function parseRows(rows: RawOkxCandle[], intervalMs: number): RawKline[] {
  return rows
    .map((row) => [Number(row[0]), row[1], row[2], row[3], row[4], row[5], Number(row[0]) + intervalMs - 1] as RawKline)
    .filter((row) => Number.isFinite(row[0]) && Number(row[0]) > 0)
    .sort((a, b) => a[0] - b[0]);
}

async function okxJson<T>(path: string): Promise<T> {
  const response = await fetch(`${REST_BASE}${path}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`OKX 行情请求失败 ${response.status}`);
  const payload = await response.json() as { code?: string; msg?: string; data?: T };
  if (payload.code !== "0" || !payload.data) throw new Error(payload.msg || "OKX 行情返回无效");
  return payload.data;
}

/** Browser-only public BTC/USDT feed. Orders and settlement remain server-owned. */
export class OkxFeedManager {
  private socket: WebSocket | null = null;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private lastRoundId = -1;

  constructor(private readonly handlers: FeedHandlers) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.socket?.close();
    this.socket = null;
  }

  private armHeartbeat(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => this.forceReconnect(), HEARTBEAT_TIMEOUT_MS);
  }

  private forceReconnect(): void {
    if (this.stopped) return;
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.socket?.close();
    this.socket = null;
    this.handlers.onStatus(false);
    this.scheduleReconnect(0);
  }

  private connect(): void {
    if (this.stopped || typeof WebSocket === "undefined") return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(WS_ENDPOINT);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.armHeartbeat();
    socket.onopen = () => {
      this.reconnectAttempts = 0;
      socket.send(JSON.stringify({
        op: "subscribe",
        args: [
          { channel: "tickers", instId: INSTRUMENT },
          { channel: "trades", instId: INSTRUMENT },
          { channel: "candle5m", instId: INSTRUMENT },
        ],
      }));
      this.handlers.onStatus(true);
      this.armHeartbeat();
    };
    socket.onmessage = (event) => {
      this.armHeartbeat();
      this.handleMessage(event.data);
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      this.handlers.onStatus(false);
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(delayMs?: number): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = delayMs ?? Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private handleMessage(raw: string): void {
    let message: { arg?: { channel?: string }; data?: Array<Record<string, unknown> | string[]> };
    try { message = JSON.parse(raw); } catch { return; }
    const channel = message.arg?.channel;
    const rows = message.data ?? [];
    for (const value of rows) {
      if (channel === "trades" && !Array.isArray(value)) {
        const price = Number(value.px);
        const ts = Number(value.ts) || Date.now();
        if (price > 0) this.handlers.onTrade(price, ts);
      }
      if (channel === "tickers" && !Array.isArray(value)) {
        const price = Number(value.last);
        const bid = Number(value.bidPx);
        const ask = Number(value.askPx);
        const open = Number(value.open24h);
        const ts = Number(value.ts) || Date.now();
        if (bid > 0 && ask > 0) this.handlers.onBook(bid, ask, ts);
        if (price > 0) {
          this.handlers.onTrade(price, ts);
          this.handlers.onTicker({
            price,
            change: open > 0 ? ((price - open) / open) * 100 : 0,
            high: Number(value.high24h) || price,
            low: Number(value.low24h) || price,
            volume: Number(value.vol24h) || 0,
            quoteVolume: Number(value.volCcy24h) || 0,
          }, ts);
          const roundId = roundFor(ts).id;
          if (roundId !== this.lastRoundId) {
            this.lastRoundId = roundId;
            this.handlers.onKline(roundId, price, price, false, ts);
          }
        }
      }
      if (channel === "candle5m" && Array.isArray(value)) {
        const row = value as string[];
        const openTime = Number(row[0]);
        this.lastRoundId = openTime;
        this.handlers.onKline(openTime, Number(row[1]), Number(row[4]), row[8] === "1", Number(row[0]));
      }
    }
  }

  static async fetchKlines(interval: "1m" | "5m", limit: number, startTime?: number): Promise<RawKline[]> {
    const bar = interval;
    const intervalMs = interval === "1m" ? 60_000 : 300_000;
    const bounded = Math.min(Math.max(limit, 1), 300);
    const path = startTime === undefined
      ? `/candles?instId=${INSTRUMENT}&bar=${bar}&limit=${bounded}`
      : `/history-candles?instId=${INSTRUMENT}&bar=${bar}&after=${startTime + bounded * intervalMs}&before=${Math.max(0, startTime - 1)}&limit=${bounded}`;
    const rows = await okxJson<RawOkxCandle[]>(path);
    const parsed = parseRows(rows, intervalMs);
    return startTime === undefined ? parsed.slice(-bounded) : parsed.filter((row) => row[0] >= startTime).slice(0, bounded);
  }

  static async fetchAggTrades(startTime: number, endTime: number, limit = 500): Promise<AggTrade[]> {
    const rows = await okxJson<Array<{ px: string; ts: string }>>(`/trades?instId=${INSTRUMENT}&limit=${Math.min(Math.max(limit, 1), 500)}`);
    return rows
      .map((row) => ({ p: row.px, T: Number(row.ts) }))
      .filter((row) => row.T >= startTime && row.T <= endTime && Number(row.p) > 0)
      .sort((a, b) => a.T - b.T);
  }

  static async fetchClosedCandle(roundId: number, now: number): Promise<ClosedCandle | null> {
    const rows = await this.fetchKlines("5m", 1, roundId);
    const row = rows.find((item) => item[0] === roundId);
    if (!row) return null;
    const closedAt = roundId + GAME_CONFIG.ROUND_DURATION_MS;
    return { openTime: roundId, open: Number(row[1]), close: Number(row[4]), closed: now >= closedAt };
  }
}
