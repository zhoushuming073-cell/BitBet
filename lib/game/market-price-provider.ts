import { roundFor } from "@/lib/pulse5/game/RoundEngine";

const KRAKEN_MARKET_API = "https://api.kraken.com/0/public";
const PAIR = "XBTUSDT";

type KrakenOhlcRow = [number, string, string, string, string, string, string, number];
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
const SNAPSHOT_FRESH_MS = 4_000;
const SNAPSHOT_STALE_FALLBACK_MS = 5 * 60_000;
let cachedSnapshot: { value: ServerMarketSnapshot; fetchedAt: number } | null = null;
let snapshotInFlight: Promise<ServerMarketSnapshot> | null = null;
let snapshotRetryAfter = 0;
const ohlcCaches = new Map<number, { sinceMs: number; fetchedAt: number; rows: KrakenOhlcRow[] }>();
const ohlcInFlight = new Map<number, { sinceMs: number; request: Promise<KrakenOhlcRow[]> }>();
let livePriceSamples: Array<{ time: number; price: number }> = [];

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

async function getCachedOhlc(interval: 1 | 5, sinceMs: number): Promise<KrakenOhlcRow[]> {
  const cached = ohlcCaches.get(interval);
  if (cached && cached.sinceMs <= sinceMs && Date.now() - cached.fetchedAt <= 60_000) return cached.rows;
  const pending = ohlcInFlight.get(interval);
  if (pending && pending.sinceMs <= sinceMs) return pending.request;

  const request = krakenQuery<Record<string, KrakenOhlcRow[]> & { last?: string }>(
    `/OHLC?pair=${PAIR}&interval=${interval}&since=${Math.floor(sinceMs / 1000)}`,
  ).then((result) => ascendingCandles(pairValue<KrakenOhlcRow[]>(result)));
  ohlcInFlight.set(interval, { sinceMs, request });
  try {
    const rows = await request;
    ohlcCaches.set(interval, { sinceMs, fetchedAt: Date.now(), rows });
    return rows;
  } catch (error) {
    if (cached && cached.sinceMs <= sinceMs) return cached.rows;
    throw error;
  } finally {
    if (ohlcInFlight.get(interval)?.request === request) ohlcInFlight.delete(interval);
  }
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

  const wallNow = Date.now();
  if (cachedSnapshot && wallNow - cachedSnapshot.fetchedAt <= SNAPSHOT_FRESH_MS) return cachedSnapshot.value;
  if (wallNow < snapshotRetryAfter) {
    if (cachedSnapshot && wallNow - cachedSnapshot.fetchedAt <= SNAPSHOT_STALE_FALLBACK_MS) return cachedSnapshot.value;
    throw new Error("BTC 行情暂时限流，等待重试");
  }
  if (snapshotInFlight) {
    try { return await snapshotInFlight; }
    catch (error) {
      if (cachedSnapshot && wallNow - cachedSnapshot.fetchedAt <= SNAPSHOT_STALE_FALLBACK_MS) return cachedSnapshot.value;
      throw error;
    }
  }

  const request = (async () => {
    const round = roundFor(now);
    const since = Math.floor((now - 82 * 60_000) / 1000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const [tickerResult, minuteRows] = await Promise.all([
        krakenQuery<Record<string, KrakenTicker>>(`/Ticker?pair=${PAIR}`, controller.signal),
        getCachedOhlc(1, since * 1000),
      ]);
      const ticker = pairValue<KrakenTicker>(tickerResult);
      const bid = Number(ticker?.b?.[0]);
      const ask = Number(ticker?.a?.[0]);
      const lastPrice = Number(ticker?.c?.[0]);
      const midPrice = bid > 0 && ask > 0 ? (bid + ask) / 2 : lastPrice;
      const roundRow = minuteRows.find((row) => row[0] * 1000 === round.id);
      const roundOpen = Number(roundRow?.[1] ?? midPrice);
      if (![bid, ask, midPrice, roundOpen].every((value) => Number.isFinite(value) && value > 0)) {
        throw new Error("BTC 行情字段无效");
      }
      livePriceSamples.push({ time: now, price: midPrice });
      livePriceSamples = livePriceSamples.filter((sample) => sample.time >= now - 90_000 && sample.time <= now);
      const minuteSamples = minuteRows
        .map((row) => ({ time: row[0] * 1000 + 60_000, price: Number(row[4]) }))
        .filter((sample) => sample.time >= now - 90_000 && sample.time <= now && Number.isFinite(sample.price) && sample.price > 0);
      const priceSamples = [...minuteSamples, ...livePriceSamples]
        .sort((a, b) => a.time - b.time)
        .filter((sample, index, all) => index === 0 || sample.time !== all[index - 1].time);
      return {
        midPrice,
        bid,
        ask,
        observedAt: now,
        roundOpen,
        volatilityCloses: minuteRows.map((row) => Number(row[4])).filter((value) => Number.isFinite(value) && value > 0),
        priceSamples,
      } satisfies ServerMarketSnapshot;
    } finally {
      clearTimeout(timeout);
    }
  })();
  snapshotInFlight = request;
  try {
    const value = await request;
    cachedSnapshot = { value, fetchedAt: Date.now() };
    snapshotRetryAfter = 0;
    return value;
  } catch (error) {
    snapshotRetryAfter = Date.now() + 15_000;
    if (cachedSnapshot && Date.now() - cachedSnapshot.fetchedAt <= SNAPSHOT_STALE_FALLBACK_MS) return cachedSnapshot.value;
    throw error;
  } finally {
    if (snapshotInFlight === request) snapshotInFlight = null;
  }
}

export async function getClosedServerCandle(roundId: number) {
  const rows = await getCachedOhlc(5, roundId);
  const row = rows.find((item) => item[0] * 1000 === roundId);
  if (!row || roundId + 5 * 60 * 1000 > Date.now()) return null;
  return { open: Number(row[1]), close: Number(row[4]), closeTime: roundId + 5 * 60 * 1000 - 1 };
}

/** Historical replay uses only candle values that were visible at each minute close. */
export async function getHistoricalRoundMarket(roundId: number) {
  const round = roundFor(roundId);
  const rows = (await getCachedOhlc(1, round.start))
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
