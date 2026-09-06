import { GAME_CONFIG } from "../game/gameConfig";
import { roundFor } from "../game/RoundEngine";
import { BinanceFeedManager } from "../market/BinanceFeedManager";
import { Pulse5Engine } from "./Pulse5Engine";
import type { LedgerPersister } from "../orders/LedgerStore";
import type { LedgerSnapshot } from "./types";

function localStoragePersister(): LedgerPersister {
  return {
    load() {
      try {
        const raw = localStorage.getItem(GAME_CONFIG.STORAGE_KEY);
        return raw ? (JSON.parse(raw) as LedgerSnapshot) : null;
      } catch {
        return null;
      }
    },
    save(snapshot) {
      try {
        localStorage.setItem(GAME_CONFIG.STORAGE_KEY, JSON.stringify(snapshot));
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

/**
 * Wires the authoritative engine to the live Binance feed, the clock,
 * round-open discovery, chart/volatility sampling and restart catch-up
 * settlement. Everything virtual; no order is ever sent to Binance.
 */
export function createBrowserEngine(): BrowserRuntime {
  const persister = typeof localStorage !== "undefined" ? localStoragePersister() : null;
  const engine = new Pulse5Engine(persister);

  let lastRoundId = -1;
  let lastChartTs = 0;
  // Chart history is committed at ~5/s; the 60fps interpolation lives in the
  // chart view. Volatility sampling keeps its own 1s cadence in the engine.
  const CHART_SAMPLE_MS = 200;
  const settling = new Set<number>();
  let disposed = false;

  // Feed events arrive many times per second. Coalesce them into a steady,
  // near-live UI cadence (instead of only refreshing on the slower clock) so
  // prices/odds track Binance tightly without re-rendering every socket frame.
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
      engine.onBookTicker(bid, ask, ts);
      requestFlush();
    },
    onTrade: (price, ts) => {
      engine.onTrade(price, ts);
      requestFlush();
    },
    onKline: (openTime, open, _close, closed) => {
      // The WS 5m candle gives the official open the instant a round starts,
      // so the new round never has to wait on a REST round-trip to render.
      engine.setRoundOpen(openTime, open);
      // A just-closed candle kicks authoritative settlement immediately.
      if (closed) void settleRoundOnce(openTime);
      requestFlush();
    },
    onTicker: (ticker, ts) => {
      engine.onTicker24h(ticker);
      engine.onTrade(ticker.price, ts);
      requestFlush();
    },
    onStatus: (connected) => engine.setConnected(connected),
  });

  async function ensureRoundOpen(roundId: number): Promise<void> {
    try {
      const rows = await BinanceFeedManager.fetchKlines("5m", 1, roundId);
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
    void settleDue(now);
  }, 250);

  // Initial data bootstrap.
  void (async () => {
    try {
      const rows = await BinanceFeedManager.fetchKlines("1m", 80);
      if (disposed) return;
      const points = rows.map((row) => ({ time: row[0], price: Number(row[4]) }));
      engine.seedChart(points);
      engine.seedVolatility(rows.map((row) => Number(row[4])));
    } catch {
      /* live feed will still warm the estimator over time */
    }
    ensureRoundOpen(roundFor(Date.now()).id);
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
