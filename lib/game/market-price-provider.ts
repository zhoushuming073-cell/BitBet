import { roundFor } from "@/lib/pulse5/game/RoundEngine";

const OKX_MARKET_API = "https://www.okx.com/api/v5/market";
const INSTRUMENT = "BTC-USDT";

type OkxCandle = [string, string, string, string, string, string, string, string, string];
type OkxTrade = { px: string; ts: string };

export interface ServerMarketSnapshot {
  midPrice: number;
  bid: number;
  ask: number;
  observedAt: number;
  roundOpen: number;
  volatilityCloses: number[];
  priceSamples: Array<{ time: number; price: number }>;
}

export interface MarketPriceProvider {
  getSnapshot(now: number): Promise<ServerMarketSnapshot>;
}

let provider: MarketPriceProvider | null = null;

export function configureMarketPriceProvider(next: MarketPriceProvider): void {
  provider = next;
}

async function okxQuery<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${OKX_MARKET_API}${path}`, {
    signal,
    cache: "no-store",
    headers: { Accept: "application/json", "User-Agent": "BitBet-Market/1.0" },
  });
  if (!response.ok) throw new Error(`BTC 行情请求失败 ${response.status}`);
  const payload = await response.json() as { code?: string; msg?: string; data?: T };
  if (payload.code !== "0" || !payload.data) throw new Error(payload.msg || "BTC 行情返回无效");
  return payload.data;
}

function ascendingCandles(rows: OkxCandle[]) {
  return [...rows].sort((a, b) => Number(a[0]) - Number(b[0]));
}

export async function getServerMarketSnapshot(now: number, devClientPrice?: number): Promise<ServerMarketSnapshot> {
  if (provider) return provider.getSnapshot(now);
  const allowDevPrice = Number.isFinite(devClientPrice) || (process.env.NODE_ENV !== "production"
    && process.env.ALLOW_CLIENT_MARKET_PRICE_DEV === "true");
  const explicitDevPrice = devClientPrice ?? Number(process.env.BITBET_DEV_MARKET_PRICE);
  if (allowDevPrice && Number.isFinite(explicitDevPrice) && explicitDevPrice > 0) {
    const midPrice = explicitDevPrice;
    return {
      midPrice,
      bid: midPrice - 0.5,
      ask: midPrice + 0.5,
      observedAt: now,
      roundOpen: midPrice,
      volatilityCloses: Array.from({ length: 25 }, (_, index) => midPrice + index * 0.5),
      priceSamples: Array.from({ length: 60 }, (_, index) => ({ time: now - (59 - index) * 1000, price: midPrice + index * 0.05 })),
    };
  }

  const round = roundFor(now);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const [tickers, rawMinutes, rawTrades] = await Promise.all([
      okxQuery<Array<{ bidPx: string; askPx: string; last: string; ts: string }>>(`/ticker?instId=${INSTRUMENT}`, controller.signal),
      okxQuery<OkxCandle[]>(`/candles?instId=${INSTRUMENT}&bar=1m&limit=80`, controller.signal),
      okxQuery<OkxTrade[]>(`/trades?instId=${INSTRUMENT}&limit=500`, controller.signal).catch(() => []),
    ]);
    const ticker = tickers[0];
    const minuteRows = ascendingCandles(rawMinutes);
    const bid = Number(ticker?.bidPx);
    const ask = Number(ticker?.askPx);
    const lastPrice = Number(ticker?.last);
    const midPrice = bid > 0 && ask > 0 ? (bid + ask) / 2 : lastPrice;
    const roundRow = minuteRows.find((row) => Number(row[0]) === round.id);
    const roundOpen = Number(roundRow?.[1] ?? midPrice);
    if (![bid, ask, midPrice, roundOpen].every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error("BTC 行情字段无效");
    }
    const priceSamples = rawTrades
      .map((row) => ({ time: Number(row.ts), price: Number(row.px) }))
      .filter((item) => Number.isFinite(item.time) && Number.isFinite(item.price) && item.price > 0 && item.time <= now)
      .sort((a, b) => a.time - b.time);
    if (priceSamples.at(-1)?.time !== now) priceSamples.push({ time: now, price: midPrice });
    return {
      midPrice,
      bid,
      ask,
      observedAt: Math.min(now, Number(ticker.ts) || now),
      roundOpen,
      volatilityCloses: minuteRows.map((row) => Number(row[4])).filter((value) => Number.isFinite(value) && value > 0),
      priceSamples,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getClosedServerCandle(roundId: number) {
  const rows = await okxQuery<OkxCandle[]>(
    `/history-candles?instId=${INSTRUMENT}&bar=5m&after=${roundId + 5 * 60 * 1000}&before=${Math.max(0, roundId - 1)}&limit=2`,
  );
  const row = rows.find((item) => Number(item[0]) === roundId);
  if (!row || roundId + 5 * 60 * 1000 > Date.now()) return null;
  return { open: Number(row[1]), close: Number(row[4]), closeTime: roundId + 5 * 60 * 1000 - 1 };
}

/** Historical replay uses only candle values that were visible at each minute close. */
export async function getHistoricalRoundMarket(roundId: number) {
  const round = roundFor(roundId);
  const rows = ascendingCandles(await okxQuery<OkxCandle[]>(
    `/history-candles?instId=${INSTRUMENT}&bar=1m&after=${round.end}&before=${Math.max(0, round.start - 1)}&limit=6`,
  )).filter((row) => Number(row[0]) >= round.start && Number(row[0]) < round.end);
  if (!rows.length) return null;

  // A minute candle is not exposed before it closes. Repeating its close after
  // that timestamp creates a step series without inventing intraminute prices.
  const samples: Array<{ time: number; price: number }> = [];
  for (const row of rows) {
    const visibleAt = Number(row[0]) + 60_000;
    const price = Number(row[4]);
    for (let time = visibleAt; time < Math.min(visibleAt + 60_000, round.end); time += 5_000) {
      samples.push({ time, price });
    }
  }
  const first = rows[0];
  const last = rows.at(-1)!;
  return {
    round,
    open: Number(first[1]),
    close: Number(last[4]),
    closeTime: round.end - 1,
    samples,
  };
}
