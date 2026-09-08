import { roundFor } from "@/lib/pulse5/game/RoundEngine";

const KRAKEN_MARKET_API = "https://api.kraken.com/0/public";
const PAIR = "XBTUSDT";

type KrakenOhlcRow = [number, string, string, string, string, string, string, number];
type KrakenTradeRow = [string, string, number, string, string, string, number?];
type KrakenTicker = {
  a: [string, string, string];
  b: [string, string, string];
  c: [string, string];
};

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

function pairValue<T>(result: object): T {
  const record = result as Record<string, unknown>;
  const key = Object.keys(record).find((name) => name !== "last");
  if (!key) throw new Error("BTC 行情返回无交易对");
  return record[key] as T;
}

async function krakenQuery<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${KRAKEN_MARKET_API}${path}`, {
    signal,
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`BTC 行情请求失败 ${response.status}`);
  const payload = await response.json() as { error?: string[]; result?: T };
  if (payload.error?.length || !payload.result) throw new Error(payload.error?.join(", ") || "BTC 行情返回无效");
  return payload.result;
}

function ascendingCandles(rows: KrakenOhlcRow[]) {
  return [...rows].sort((a, b) => a[0] - b[0]);
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
  const since = Math.floor((now - 82 * 60_000) / 1000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const [tickerResult, minuteResult, tradeResult] = await Promise.all([
      krakenQuery<Record<string, KrakenTicker>>(`/Ticker?pair=${PAIR}`, controller.signal),
      krakenQuery<Record<string, KrakenOhlcRow[]> & { last?: string }>(`/OHLC?pair=${PAIR}&interval=1&since=${since}`, controller.signal),
      krakenQuery<Record<string, KrakenTradeRow[]> & { last?: string }>(`/Trades?pair=${PAIR}`, controller.signal).catch(() => null),
    ]);
    const ticker = pairValue<KrakenTicker>(tickerResult);
    const minuteRows = ascendingCandles(pairValue<KrakenOhlcRow[]>(minuteResult));
    const bid = Number(ticker?.b?.[0]);
    const ask = Number(ticker?.a?.[0]);
    const lastPrice = Number(ticker?.c?.[0]);
    const midPrice = bid > 0 && ask > 0 ? (bid + ask) / 2 : lastPrice;
    const roundRow = minuteRows.find((row) => row[0] * 1000 === round.id);
    const roundOpen = Number(roundRow?.[1] ?? midPrice);
    if (![bid, ask, midPrice, roundOpen].every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error("BTC 行情字段无效");
    }
    const priceSamples = tradeResult
      ? pairValue<KrakenTradeRow[]>(tradeResult)
        .map((row) => ({ time: Math.round(row[2] * 1000), price: Number(row[0]) }))
        .filter((item) => Number.isFinite(item.time) && Number.isFinite(item.price) && item.price > 0 && item.time <= now)
        .sort((a, b) => a.time - b.time)
      : [];
    const latestTradeAt = priceSamples.at(-1)?.time;
    if (latestTradeAt !== now) priceSamples.push({ time: now, price: midPrice });
    return {
      midPrice,
      bid,
      ask,
      observedAt: latestTradeAt ? Math.min(now, latestTradeAt) : now,
      roundOpen,
      volatilityCloses: minuteRows.map((row) => Number(row[4])).filter((value) => Number.isFinite(value) && value > 0),
      priceSamples,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getClosedServerCandle(roundId: number) {
  const result = await krakenQuery<Record<string, KrakenOhlcRow[]> & { last?: string }>(
    `/OHLC?pair=${PAIR}&interval=5&since=${Math.floor(roundId / 1000)}`,
  );
  const row = pairValue<KrakenOhlcRow[]>(result).find((item) => item[0] * 1000 === roundId);
  if (!row || roundId + 5 * 60 * 1000 > Date.now()) return null;
  return { open: Number(row[1]), close: Number(row[4]), closeTime: roundId + 5 * 60 * 1000 - 1 };
}

/** Historical replay uses only candle values that were visible at each minute close. */
export async function getHistoricalRoundMarket(roundId: number) {
  const round = roundFor(roundId);
  const result = await krakenQuery<Record<string, KrakenOhlcRow[]> & { last?: string }>(
    `/OHLC?pair=${PAIR}&interval=1&since=${Math.floor(round.start / 1000)}`,
  );
  const rows = ascendingCandles(pairValue<KrakenOhlcRow[]>(result))
    .filter((row) => row[0] * 1000 >= round.start && row[0] * 1000 < round.end);
  if (!rows.length) return null;

  const samples: Array<{ time: number; price: number }> = [];
  for (const row of rows) {
    const visibleAt = row[0] * 1000 + 60_000;
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
