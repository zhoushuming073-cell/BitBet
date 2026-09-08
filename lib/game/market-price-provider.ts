import { roundFor } from "@/lib/pulse5/game/RoundEngine";

const BINANCE_MARKET_API = "https://data-api.binance.vision";

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
    const query = async <T>(path: string): Promise<T> => {
      const response = await fetch(`${BINANCE_MARKET_API}${path}`, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error(`Binance 行情请求失败 ${response.status}`);
      return response.json() as Promise<T>;
    };
    const [book, minuteRows, secondRows] = await Promise.all([
      query<{ bidPrice: string; askPrice: string }>("/api/v3/ticker/bookTicker?symbol=BTCUSDT"),
      query<Array<Array<string | number>>>("/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=80"),
      query<Array<Array<string | number>>>("/api/v3/klines?symbol=BTCUSDT&interval=1s&limit=70").catch(() => []),
    ]);
    const bid = Number(book.bidPrice);
    const ask = Number(book.askPrice);
    const midPrice = (bid + ask) / 2;
    const roundOpen = Number(minuteRows.find((row) => Number(row[0]) === round.id)?.[1]);
    if (![bid, ask, midPrice, roundOpen].every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error("Binance 行情字段无效");
    }
    const priceSamples = (secondRows.length ? secondRows : minuteRows.slice(-2)).map((row) => ({
      time: Number(row[0]),
      price: Number(row[4]),
    })).filter((item) => Number.isFinite(item.time) && Number.isFinite(item.price) && item.time <= now);
    if (priceSamples.at(-1)?.time !== now) priceSamples.push({ time: now, price: midPrice });
    return {
      midPrice,
      bid,
      ask,
      observedAt: now,
      roundOpen,
      volatilityCloses: minuteRows.map((row) => Number(row[4])).filter((value) => Number.isFinite(value) && value > 0),
      priceSamples,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getClosedServerCandle(roundId: number) {
  const response = await fetch(
    `${BINANCE_MARKET_API}/api/v3/klines?symbol=BTCUSDT&interval=5m&startTime=${roundId}&limit=1`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error(`Binance 结算行情请求失败 ${response.status}`);
  const rows = await response.json() as Array<Array<string | number>>;
  const row = rows[0];
  if (!row || Number(row[6]) >= Date.now()) return null;
  return { open: Number(row[1]), close: Number(row[4]), closeTime: Number(row[6]) };
}

/** Historical 1s bars used only to replay missed Bot evaluations after downtime. */
export async function getHistoricalRoundMarket(roundId: number) {
  const round = roundFor(roundId);
  const response = await fetch(
    `${BINANCE_MARKET_API}/api/v3/klines?symbol=BTCUSDT&interval=1s&startTime=${round.start}&endTime=${round.end - 1}&limit=300`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error(`Binance 历史行情请求失败 ${response.status}`);
  const rows = await response.json() as Array<Array<string | number>>;
  const samples = rows.map((row) => ({ time: Number(row[0]), price: Number(row[4]) }))
    .filter((item) => Number.isFinite(item.time) && Number.isFinite(item.price) && item.price > 0);
  if (samples.length < 30) return null;
  return {
    round,
    open: Number(rows[0][1]),
    close: Number(rows.at(-1)?.[4]),
    closeTime: Number(rows.at(-1)?.[6]),
    samples,
  };
}
