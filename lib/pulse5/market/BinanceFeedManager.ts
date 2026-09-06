import { GAME_CONFIG } from "../game/gameConfig";
import type { Ticker24h } from "../engine/types";

type RawKline = [number, string, string, string, string, string, number];

export interface ClosedCandle {
  openTime: number;
  open: number;
  close: number;
  closed: boolean;
}

const REST_ENDPOINTS = [
  "https://data-api.binance.vision/api/v3/klines",
  "https://api.binance.com/api/v3/klines",
];

const WS_ENDPOINTS = [
  "wss://data-stream.binance.vision/stream?streams=btcusdt@bookTicker/btcusdt@ticker/btcusdt@aggTrade/btcusdt@kline_5m",
  "wss://stream.binance.com:9443/stream?streams=btcusdt@bookTicker/btcusdt@ticker/btcusdt@aggTrade/btcusdt@kline_5m",
];

const RECONNECT_BASE_MS = 400;
const RECONNECT_MAX_MS = 8000;
// BTC bookTicker/aggTrade normally arrive many times per second. An open socket
// that delivers nothing for this long is treated as silently stalled and is
// forcibly rotated to the next endpoint — prevents a frozen/stale price.
const HEARTBEAT_TIMEOUT_MS = 5000;

export interface FeedHandlers {
  onBook: (bid: number, ask: number, ts: number) => void;
  /** Every executed trade — the most precise "last price" source. */
  onTrade: (price: number, ts: number) => void;
  /** Rolling 5m candle: open is known the instant a new round starts. */
  onKline: (openTime: number, open: number, close: number, closed: boolean, ts: number) => void;
  onTicker: (ticker: Ticker24h, ts: number) => void;
  onStatus: (connected: boolean) => void;
}

/**
 * BinanceFeedManager — public Spot market data only (no account API / key).
 * Odds use the bookTicker mid price; the last trade price is still displayed.
 */
export class BinanceFeedManager {
  private socket: WebSocket | null = null;
  private endpointIndex = 0;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private readonly handlers: FeedHandlers;

  constructor(handlers: FeedHandlers) {
    this.handlers = handlers;
  }

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

  /** Re-arm the silence watchdog; any inbound frame proves the feed is alive. */
  private armHeartbeat(): void {
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => {
      // Socket open but no data for too long: rotate endpoint and reconnect now.
      this.forceReconnect();
    }, HEARTBEAT_TIMEOUT_MS);
  }

  private forceReconnect(): void {
    if (this.stopped) return;
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    try {
      this.socket?.close();
    } catch {
      /* ignore */
    }
    this.socket = null;
    this.handlers.onStatus(false);
    this.scheduleReconnect(0);
  }

  private connect(): void {
    if (this.stopped || typeof WebSocket === "undefined") return;
    const url = WS_ENDPOINTS[this.endpointIndex % WS_ENDPOINTS.length];
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.armHeartbeat();

    socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.armHeartbeat();
      this.handlers.onStatus(true);
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
    this.endpointIndex += 1;
    const delay =
      delayMs ??
      Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private handleMessage(raw: string): void {
    let msg: { stream?: string; data?: Record<string, unknown> };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const data = (msg.data ?? (msg as unknown as Record<string, unknown>)) as Record<string, unknown>;
    const eventType = data.e;
    const ts = Number(data.E) || Date.now();

    // @aggTrade: p = executed trade price (per-trade precision for "last price").
    if (eventType === "aggTrade" && typeof data.p === "string") {
      this.handlers.onTrade(Number(data.p), ts);
    }

    // @kline_5m: k.t = candle open time (= round id), k.o open, k.c close, k.x closed.
    if (eventType === "kline" && data.k && typeof data.k === "object") {
      const k = data.k as Record<string, unknown>;
      this.handlers.onKline(
        Number(k.t),
        Number(k.o),
        Number(k.c),
        Boolean(k.x),
        Number(k.T) || ts,
      );
    }

    // @bookTicker: b = best bid, a = best ask.
    if (eventType === "bookTicker" || (typeof data.b === "string" && typeof data.a === "string")) {
      this.handlers.onBook(Number(data.b), Number(data.a), ts);
    }
    // @ticker: full 24h ticker.
    if (eventType === "24hrTicker" || typeof data.P === "string") {
      const ticker: Ticker24h = {
        price: Number(data.c),
        change: Number(data.P),
        high: Number(data.h),
        low: Number(data.l),
        volume: Number(data.v),
        quoteVolume: Number(data.q),
      };
      this.handlers.onTicker(ticker, ts);
    }
  }

  static async fetchKlines(
    interval: "1m" | "5m",
    limit: number,
    startTime?: number,
  ): Promise<RawKline[]> {
    const params = new URLSearchParams({ symbol: "BTCUSDT", interval, limit: String(limit) });
    if (startTime !== undefined) params.set("startTime", String(startTime));
    let lastError: unknown = null;
    for (const base of REST_ENDPOINTS) {
      try {
        const res = await fetch(`${base}?${params}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`kline ${res.status}`);
        return (await res.json()) as RawKline[];
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("kline fetch failed");
  }

  /** Official open/close of one 5m candle once it has closed. */
  static async fetchClosedCandle(roundId: number, now: number): Promise<ClosedCandle | null> {
    const rows = await this.fetchKlines("5m", 1, roundId);
    const row = rows[0];
    if (!row) return null;
    const openTime = row[0];
    if (openTime !== roundId) return null;
    const closedAt = openTime + GAME_CONFIG.ROUND_DURATION_MS;
    if (now < closedAt) return { openTime, open: Number(row[1]), close: Number(row[4]), closed: false };
    return { openTime, open: Number(row[1]), close: Number(row[4]), closed: true };
  }
}
