import { GAME_CONFIG } from "../game/gameConfig";
import type { Ticker24h } from "../engine/types";

type RawKline = [number, string, string, string, string, string, number];

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

const REST_ENDPOINTS = [
  "https://data-api.binance.vision/api/v3/klines",
  "https://api.binance.com/api/v3/klines",
];
const AGG_TRADES_ENDPOINTS = [
  "https://data-api.binance.vision/api/v3/aggTrades",
  "https://api.binance.com/api/v3/aggTrades",
];
const WS_ENDPOINTS = [
  "wss://data-stream.binance.vision/stream?streams=btcusdt@bookTicker/btcusdt@ticker/btcusdt@aggTrade/btcusdt@kline_5m",
  "wss://stream.binance.com:9443/stream?streams=btcusdt@bookTicker/btcusdt@ticker/btcusdt@aggTrade/btcusdt@kline_5m",
];
const RECONNECT_BASE_MS = 400;
const RECONNECT_MAX_MS = 8_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;

export interface FeedHandlers {
  onBook: (bid: number, ask: number, ts: number) => void;
  onTrade: (price: number, ts: number) => void;
  onKline: (openTime: number, open: number, close: number, closed: boolean, ts: number) => void;
  onTicker: (ticker: Ticker24h, ts: number) => void;
  onStatus: (connected: boolean) => void;
}

/** Browser-facing Binance public feed. It exposes only values already visible to players. */
export class BinanceFeedManager {
  private socket: WebSocket | null = null;
  private endpointIndex = 0;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;

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
    try { this.socket?.close(); } catch { /* no-op */ }
    this.socket = null;
    this.handlers.onStatus(false);
    this.scheduleReconnect(0);
  }

  private connect(): void {
    if (this.stopped || typeof WebSocket === "undefined") return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(WS_ENDPOINTS[this.endpointIndex % WS_ENDPOINTS.length]);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.armHeartbeat();
    socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.handlers.onStatus(true);
      this.armHeartbeat();
    };
    socket.onmessage = (event) => {
      this.armHeartbeat();
      this.handleMessage(String(event.data));
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      this.handlers.onStatus(false);
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(delayMs?: number): void {
    if (this.stopped || this.reconnectTimer) return;
    this.endpointIndex += 1;
    const delay = delayMs ?? Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private handleMessage(raw: string): void {
    let message: { data?: Record<string, unknown> } & Record<string, unknown>;
    try { message = JSON.parse(raw); } catch { return; }
    const data = (message.data ?? message) as Record<string, unknown>;
    const eventType = data.e;
    const ts = Number(data.E) || Date.now();
    if (eventType === "aggTrade" && typeof data.p === "string") {
      this.handlers.onTrade(Number(data.p), ts);
    }
    if (eventType === "kline" && data.k && typeof data.k === "object") {
      const k = data.k as Record<string, unknown>;
      this.handlers.onKline(Number(k.t), Number(k.o), Number(k.c), Boolean(k.x), Number(k.T) || ts);
    }
    if (eventType === "bookTicker" || (typeof data.b === "string" && typeof data.a === "string")) {
      this.handlers.onBook(Number(data.b), Number(data.a), ts);
    }
    if (eventType === "24hrTicker" || typeof data.P === "string") {
      this.handlers.onTicker({
        price: Number(data.c),
        change: Number(data.P),
        high: Number(data.h),
        low: Number(data.l),
        volume: Number(data.v),
        quoteVolume: Number(data.q),
      }, ts);
    }
  }

  static async fetchKlines(interval: "1m" | "5m", limit: number, startTime?: number): Promise<RawKline[]> {
    const params = new URLSearchParams({ symbol: "BTCUSDT", interval, limit: String(limit) });
    if (startTime !== undefined) params.set("startTime", String(startTime));
    let lastError: unknown = null;
    for (const base of REST_ENDPOINTS) {
      try {
        const response = await fetch(`${base}?${params}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Binance kline ${response.status}`);
        return await response.json() as RawKline[];
      } catch (error) { lastError = error; }
    }
    throw lastError instanceof Error ? lastError : new Error("Binance kline fetch failed");
  }

  static async fetchAggTrades(startTime: number, endTime: number, limit = 1000): Promise<AggTrade[]> {
    const params = new URLSearchParams({
      symbol: "BTCUSDT",
      startTime: String(startTime),
      endTime: String(endTime),
      limit: String(Math.min(Math.max(limit, 1), 1000)),
    });
    let lastError: unknown = null;
    for (const base of AGG_TRADES_ENDPOINTS) {
      try {
        const response = await fetch(`${base}?${params}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Binance aggTrades ${response.status}`);
        return await response.json() as AggTrade[];
      } catch (error) { lastError = error; }
    }
    throw lastError instanceof Error ? lastError : new Error("Binance aggTrades fetch failed");
  }

  static async fetchClosedCandle(roundId: number, now: number): Promise<ClosedCandle | null> {
    const row = (await this.fetchKlines("5m", 1, roundId))[0];
    if (!row || row[0] !== roundId) return null;
    return {
      openTime: roundId,
      open: Number(row[1]),
      close: Number(row[4]),
      closed: now >= roundId + GAME_CONFIG.ROUND_DURATION_MS,
    };
  }
}
