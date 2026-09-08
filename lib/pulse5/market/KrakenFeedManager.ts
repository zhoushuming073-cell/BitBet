import { GAME_CONFIG } from "../game/gameConfig";
import { roundFor } from "../game/RoundEngine";
import type { Ticker24h } from "../engine/types";

type KrakenOhlcRow = [number, string, string, string, string, string, string, number];
type KrakenTradeRow = [string, string, number, string, string, string, number?];

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

const REST_BASE = "https://api.kraken.com/0/public";
const WS_ENDPOINT = "wss://ws.kraken.com/v2";
const REST_PAIR = "XBTUSDT";
const WS_SYMBOL = "BTC/USDT";
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8_000;
const HEARTBEAT_TIMEOUT_MS = 35_000;

export interface FeedHandlers {
  onBook: (bid: number, ask: number, ts: number) => void;
  onTrade: (price: number, ts: number) => void;
  onKline: (openTime: number, open: number, close: number, closed: boolean, ts: number) => void;
  onTicker: (ticker: Ticker24h, ts: number) => void;
  onStatus: (connected: boolean) => void;
}

function pairValue<T>(result: object): T {
  const record = result as Record<string, unknown>;
  const key = Object.keys(record).find((name) => name !== "last");
  if (!key) throw new Error("Kraken 行情返回无交易对");
  return record[key] as T;
}

function parseRows(rows: KrakenOhlcRow[], intervalMs: number): RawKline[] {
  return rows
    .map((row) => [row[0] * 1000, row[1], row[2], row[3], row[4], row[6], row[0] * 1000 + intervalMs - 1] as RawKline)
    .filter((row) => Number.isFinite(row[0]) && row[0] > 0)
    .sort((a, b) => a[0] - b[0]);
}

async function krakenJson<T>(path: string): Promise<T> {
  const response = await fetch(`${REST_BASE}${path}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`BTC 行情请求失败 ${response.status}`);
  const payload = await response.json() as { error?: string[]; result?: T };
  if (payload.error?.length || !payload.result) throw new Error(payload.error?.join(", ") || "BTC 行情返回无效");
  return payload.result;
}

/** Browser-only public BTC/USDT feed. Orders and settlement remain server-owned. */
export class KrakenFeedManager {
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
      for (const channel of ["ticker", "trade"] as const) {
        socket.send(JSON.stringify({ method: "subscribe", params: { channel, symbol: [WS_SYMBOL], snapshot: true } }));
      }
      socket.send(JSON.stringify({ method: "subscribe", params: { channel: "ohlc", symbol: [WS_SYMBOL], interval: 5, snapshot: true } }));
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
    const delay = delayMs ?? Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private handleMessage(raw: string): void {
    let message: { channel?: string; data?: Array<Record<string, unknown>> };
    try { message = JSON.parse(raw); } catch { return; }
    const rows = message.data ?? [];
    for (const value of rows) {
      if (message.channel === "trade") {
        const price = Number(value.price);
        const ts = Date.parse(String(value.timestamp));
        if (price > 0 && Number.isFinite(ts)) this.handlers.onTrade(price, ts);
      }
      if (message.channel === "ticker") {
        const price = Number(value.last);
        const bid = Number(value.bid);
        const ask = Number(value.ask);
        const ts = Date.now();
        if (bid > 0 && ask > 0) this.handlers.onBook(bid, ask, ts);
        if (price > 0) {
          this.handlers.onTrade(price, ts);
          this.handlers.onTicker({
            price,
            change: Number(value.change_pct) || 0,
            high: Number(value.high) || price,
            low: Number(value.low) || price,
            volume: Number(value.volume) || 0,
            quoteVolume: (Number(value.vwap) || price) * (Number(value.volume) || 0),
          }, ts);
          const roundId = roundFor(ts).id;
          if (roundId !== this.lastRoundId) {
            this.lastRoundId = roundId;
            this.handlers.onKline(roundId, price, price, false, ts);
          }
        }
      }
      if (message.channel === "ohlc") {
        const openTime = Date.parse(String(value.interval_begin));
        if (!Number.isFinite(openTime)) continue;
        this.lastRoundId = openTime;
        this.handlers.onKline(openTime, Number(value.open), Number(value.close), openTime + GAME_CONFIG.ROUND_DURATION_MS <= Date.now(), Date.now());
      }
    }
  }

  static async fetchKlines(interval: "1m" | "5m", limit: number, startTime?: number): Promise<RawKline[]> {
    const intervalMinutes = interval === "1m" ? 1 : 5;
    const intervalMs = intervalMinutes * 60_000;
    const bounded = Math.min(Math.max(limit, 1), 720);
    const since = Math.floor((startTime ?? Date.now() - (bounded + 2) * intervalMs) / 1000);
    const result = await krakenJson<Record<string, KrakenOhlcRow[]> & { last?: string }>(`/OHLC?pair=${REST_PAIR}&interval=${intervalMinutes}&since=${since}`);
    const parsed = parseRows(pairValue<KrakenOhlcRow[]>(result), intervalMs);
    return startTime === undefined ? parsed.slice(-bounded) : parsed.filter((row) => row[0] >= startTime).slice(0, bounded);
  }

  static async fetchAggTrades(startTime: number, endTime: number, limit = 500): Promise<AggTrade[]> {
    const result = await krakenJson<Record<string, KrakenTradeRow[]> & { last?: string }>(`/Trades?pair=${REST_PAIR}`);
    return pairValue<KrakenTradeRow[]>(result)
      .map((row) => ({ p: row[0], T: Math.round(row[2] * 1000) }))
      .filter((row) => row.T >= startTime && row.T <= endTime && Number(row.p) > 0)
      .slice(-Math.min(Math.max(limit, 1), 1000))
      .sort((a, b) => a.T - b.T);
  }

  static async fetchClosedCandle(roundId: number, now: number): Promise<ClosedCandle | null> {
    const rows = await this.fetchKlines("5m", 2, roundId);
    const row = rows.find((item) => item[0] === roundId);
    if (!row) return null;
    const closedAt = roundId + GAME_CONFIG.ROUND_DURATION_MS;
    return { openTime: roundId, open: Number(row[1]), close: Number(row[4]), closed: now >= closedAt };
  }
}
