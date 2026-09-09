import { GAME_CONFIG } from "../game/gameConfig";
import { roundFor } from "../game/RoundEngine";
import { BinanceFeedManager } from "../market/BinanceFeedManager";
import { KrakenFeedManager } from "../market/KrakenFeedManager";
import { BUFFER_WINDOW_MS, bucketAggTrades } from "../market/priceBuffer";
import { Pulse5Engine } from "./Pulse5Engine";
import type { LedgerPersister } from "../orders/LedgerStore";
import type { LedgerSnapshot } from "./types";

function localStoragePersister(storageKey: string): LedgerPersister {
  return {
    load() {
      try {
        const raw = localStorage.getItem(storageKey);
        return raw ? (JSON.parse(raw) as LedgerSnapshot) : null;
      } catch {
        return null;
      }
    },
    save(snapshot) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(snapshot));
      } catch {
        /* storage full / disabled — ledger still holds in memory */
      }
    },
  };
}

export interface BrowserRuntime {
  engine: Pulse5Engine;
  stop: () => void;
}

export interface BrowserEngineOptions {
  storageKey?: string;
  /** Disable localStorage when the server owns the account ledger. */
  persist?: boolean;
  /** Create only the ledger/engine; another trusted runtime mirrors market data. */
  passive?: boolean;
  /** Keep settlement server-only while retaining the live display/quote feed. */
  settlement?: boolean;
}

/**
 * Wires the display engine to Binance's public BTC/USDT stream. The server-published
 * market view can also be merged by the page when this browser stream is unavailable.
 * round-open discovery, chart/volatility sampling and restart catch-up
 * settlement. Everything is virtual; no order is ever sent to an exchange.
 */
export function createBrowserEngine(options: BrowserEngineOptions = {}): BrowserRuntime {
  const storageKey = options.storageKey ?? GAME_CONFIG.STORAGE_KEY;
  const persister = options.persist !== false && typeof localStorage !== "undefined"
    ? localStoragePersister(storageKey)
    : null;
  const engine = new Pulse5Engine(persister);

  if (options.passive) {
    return { engine, stop() {} };
  }

  let lastRoundId = -1;
  let lastChartTs = 0;
  let lastFeedTs = 0; // last time any live feed frame arrived (local ms)
  // Chart history is committed at ~5/s; the 60fps interpolation lives in the
  // chart view. Volatility sampling keeps its own 1s cadence in the engine.
  const CHART_SAMPLE_MS = 200;
  const settling = new Set<number>();
  let disposed = false;

  // Feed events arrive many times per second. Coalesce them into a steady,
  // near-live UI cadence (instead of only refreshing on the slower clock) so
  // prices/odds track the public feed tightly without re-rendering every socket frame.
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFlush = 0;
  const requestFlush = () => {
    if (disposed || flushTimer !== null) return;
    const wait = Math.max(0, GAME_CONFIG.MARKET_UI_FLUSH_MS - (Date.now() - lastFlush));
    flushTimer = setTimeout(() => {
      flushTimer = null;
      lastFlush = Date.now();
      if (!disposed) engine.tick(Date.now());
    }, wait);
  };

  const feed = new BinanceFeedManager({
    onBook: (bid, ask, ts) => {
      lastFeedTs = Date.now();
      engine.onBookTicker(bid, ask, ts);
      requestFlush();
    },
    onTrade: (price, ts) => {
      lastFeedTs = Date.now();
      engine.onTrade(price, ts);
      requestFlush();
    },
    onKline: (openTime, open, _close, closed) => {
      lastFeedTs = Date.now();
      // The WS 5m candle gives the official open the instant a round starts,
      // so the new round never has to wait on a REST round-trip to render.
      engine.setRoundOpen(openTime, open);
      // A just-closed candle kicks authoritative settlement immediately.
      if (closed && options.settlement !== false) void settleRoundOnce(openTime);
      requestFlush();
    },
    onTicker: (ticker, ts) => {
      lastFeedTs = Date.now();
      engine.onTicker24h(ticker);
      engine.onTrade(ticker.price, ts);
      requestFlush();
    },
    onStatus: (connected) => {
      engine.setConnected(connected);
      // Reconnected after a gap → backfill the missing history so the curve has
      // no hole. The merge dedups against points already in the buffer.
      if (connected && lastFeedTs > 0 && Date.now() - lastFeedTs > 3000) {
        void backfillGap();
      }
    },
  });

  async function ensureRoundOpen(roundId: number): Promise<void> {
    try {
      const rows = await BinanceFeedManager.fetchKlines("5m", 1, roundId)
        .catch(() => KrakenFeedManager.fetchKlines("5m", 1, roundId));
      if (!disposed && rows[0] && rows[0][0] === roundId) {
        engine.setRoundOpen(roundId, Number(rows[0][1]));
      }
    } catch {
      /* retry on next tick */
    }
  }

  /** Settle one round from the official (REST) closed candle; idempotent. */
  async function settleRoundOnce(roundId: number): Promise<void> {
    if (settling.has(roundId) || engine.ledger.isSettled(roundId)) return;
    settling.add(roundId);
    try {
      const waitedSince = Date.now();
      let candle = await BinanceFeedManager.fetchClosedCandle(roundId, Date.now());
      while (candle && !candle.closed && Date.now() - waitedSince < GAME_CONFIG.SETTLE_MAX_WAIT_MS) {
        await new Promise((resolve) => setTimeout(resolve, GAME_CONFIG.SETTLE_RETRY_MS));
        candle = await BinanceFeedManager.fetchClosedCandle(roundId, Date.now());
      }
      if (candle && candle.closed) {
        engine.settle(roundId, candle.open, candle.close, Date.now());
      }
    } catch {
      /* will retry on a later tick */
    } finally {
      settling.delete(roundId);
    }
  }

  async function settleDue(now: number): Promise<void> {
    for (const roundId of engine.roundsNeedingSettlement(now)) {
      void settleRoundOnce(roundId);
    }
  }

  /** Backfill the chart gap after a reconnect using recent aggTrades. */
  async function backfillGap(): Promise<void> {
    const now = Date.now();
    try {
      const trades = await BinanceFeedManager.fetchAggTrades(now - BUFFER_WINDOW_MS, now)
        .catch(() => KrakenFeedManager.fetchAggTrades(now - BUFFER_WINDOW_MS, now));
      if (!disposed) engine.mergeChart(bucketAggTrades(trades));
    } catch {
      /* ignore — live feed keeps appending */
    }
  }

  const clock = window.setInterval(() => {
    const now = Date.now();
    const round = roundFor(now);
    if (round.id !== lastRoundId) {
      lastRoundId = round.id;
      ensureRoundOpen(round.id);
    }
    engine.tick(now);
    const snapshot = engine.getView(now).market;
    if (snapshot && now - lastChartTs >= CHART_SAMPLE_MS) {
      lastChartTs = now;
      engine.appendPoint({ time: now, price: snapshot.midPrice });
    }
    if (options.settlement !== false) void settleDue(now);
  }, 250);

  // Initial data bootstrap.
  void (async () => {
    const now = Date.now();

    // 1) Chart history: dense aggTrades bucketed to ~250ms. Falls back to sparse
    //    1m klines only if aggTrades fails — and never clears existing points.
    try {
      const trades = await BinanceFeedManager.fetchAggTrades(now - 70_000, now)
        .catch(() => KrakenFeedManager.fetchAggTrades(now - 70_000, now));
      if (!disposed) {
        const points = bucketAggTrades(trades);
        engine.seedChart(points);
        console.log(`[chart] history loaded: ${points.length} points`);
      }
    } catch {
      try {
        const rows = await BinanceFeedManager.fetchKlines("1m", 3)
          .catch(() => KrakenFeedManager.fetchKlines("1m", 3));
        if (!disposed) {
          engine.seedChart(rows.map((row) => ({ time: Number(row[0]), price: Number(row[4]) })));
        }
      } catch {
        /* live feed will still populate the chart */
      }
    }

    // 2) Volatility warm-up: 1m klines (separate from the chart series).
    try {
      const rows = await BinanceFeedManager.fetchKlines("1m", 80)
        .catch(() => KrakenFeedManager.fetchKlines("1m", 80));
      if (!disposed) engine.seedVolatility(rows.map((row) => Number(row[4])));
    } catch {
      /* live feed will still warm the estimator over time */
    }

    ensureRoundOpen(roundFor(now).id);
  })();

  feed.start();

  return {
    engine,
    stop() {
      disposed = true;
      window.clearInterval(clock);
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      feed.stop();
    },
  };
}
