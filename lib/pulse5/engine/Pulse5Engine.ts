import { GAME_CONFIG } from "../game/gameConfig";
import { roundFor, roundPhase, type RoundWindow } from "../game/RoundEngine";
import { VolatilityEstimator } from "../market/VolatilityEstimator";
import { evaluateMarket, executeVirtualBook, isSideQuotable } from "../market/MarketMaker";
import { QuoteService } from "../market/QuoteService";
import { syntheticLiquidity } from "../market/InventoryModel";
import { BUFFER_WINDOW_MS, mergePricePoints, normalizeTimestamp } from "../market/priceBuffer";
import { OrderService } from "../orders/OrderService";
import { LedgerStore, money, type LedgerPersister } from "../orders/LedgerStore";
import type { GameStateStore } from "../orders/GameStateStore";
import { buildPosition } from "../orders/PositionService";
import { settleRound, type SettleOutcome } from "../settlement/SettlementService";
import { EngineError, ErrorCode, type ErrorCodeType } from "./errors";
import type {
  BettingState,
  CurrentPosition,
  MarketSnapshot,
  Order,
  PricePointLike,
  ProbabilityBreakdown,
  Quote,
  RoundRecord,
  RoundResult,
  SettlementNotice,
  Side,
  Ticker24h,
} from "./types";

type Listener = () => void;

/** Immutable UI view emitted by the engine. */
export interface EngineView {
  now: number;
  round: RoundWindow;
  phase: "OPEN" | "LOCKED" | "ENDED";
  bettingState: BettingState;
  connected: boolean;
  market: MarketSnapshot | null;
  ticker: Ticker24h;
  breakdown: ProbabilityBreakdown | null;
  position: CurrentPosition;
  balance: number;
  /** Unclaimed winnings/refunds waiting to be collected via claimOrder/claimAll. */
  claimable: number;
  openOrders: Order[];
  settledOrders: Order[];
  roundSummaries: RoundRecord[];
  /** Most recently settled round (drives the smooth result hand-off), if any. */
  lastSettlement: SettlementNotice | null;
  points: PricePointLike[];
  upQuotable: boolean;
  downQuotable: boolean;
  syntheticUpLiquidity: number;
  syntheticDownLiquidity: number;
}

const EMPTY_TICKER: Ticker24h = { price: 0, change: 0, high: 0, low: 0, volume: 0, quoteVolume: 0 };

export class Pulse5Engine {
  readonly ledger: GameStateStore;
  readonly estimator = new VolatilityEstimator();
  private readonly quoteService = new QuoteService();
  private readonly orderService = new OrderService();

  // Feed state.
  private connected = false;
  private lastPrice = 0;
  private midPrice = 0;
  private bestBid = 0;
  private bestAsk = 0;
  private marketTimestamp = 0;
  private ticker: Ticker24h = { ...EMPTY_TICKER };
  private roundOpenById = new Map<number, number>();
  private points: PricePointLike[] = [];
  private lastVolSampleTs = 0;

  private currentRoundId = 0;
  private lastSettlement: SettlementNotice | null = null;
  private view: EngineView | null = null;
  private listeners = new Set<Listener>();

  constructor(storeOrPersister: GameStateStore | LedgerPersister | null = null) {
    this.ledger = isGameStateStore(storeOrPersister) ? storeOrPersister : new LedgerStore(storeOrPersister);
  }

  // ---------------- feed ingestion ----------------
  setConnected(connected: boolean): void {
    this.connected = connected;
  }

  // Chart price buffer — a single unified rolling series. It is NEVER cleared on
  // round boundaries, resets or reconnects: history + live trades merge into one
  // time-ascending buffer (~90s) that persists across 5m rounds.
  seedChart(points: PricePointLike[]): void {
    this.points = mergePricePoints([], points);
  }

  /** Merge REST backfill (aggTrades) into the existing buffer without clearing it. */
  mergeChart(points: PricePointLike[]): void {
    const before = this.points.length;
    this.points = mergePricePoints(this.points, points);
    if (before > 0 && this.points.length === 0) {
      console.warn("[chart] price buffer unexpectedly became empty");
    }
  }

  appendPoint(point: PricePointLike): void {
    const time = normalizeTimestamp(point.time);
    const price = point.price;
    if (!Number.isFinite(price) || price <= 0 || time <= 0) return;

    const last = this.points[this.points.length - 1];
    // Live trades are monotonic; ignore out-of-order or duplicate timestamps.
    if (last && time <= last.time) return;

    this.points.push({ time, price });
    this.trimBuffer(time);
  }

  private trimBuffer(now: number): void {
    const cutoff = now - BUFFER_WINDOW_MS;
    if (!this.points.length || this.points[0].time >= cutoff) return;
    let i = 0;
    while (i < this.points.length && this.points[i].time < cutoff) i += 1;
    if (i > 0) this.points = this.points.slice(i);
  }

  seedVolatility(closes: number[]): void {
    this.estimator.seedFromOneMinuteKlines(closes);
  }

  /** Official 5m open (S0) for a round, supplied by the data layer. */
  setRoundOpen(roundId: number, openPrice: number): void {
    if (openPrice > 0 && Number.isFinite(openPrice)) this.roundOpenById.set(roundId, openPrice);
  }

  onBookTicker(bid: number, ask: number, ts: number): void {
    if (Number.isFinite(bid) && bid > 0) this.bestBid = bid;
    if (Number.isFinite(ask) && ask > 0) this.bestAsk = ask;
    if (this.bestBid > 0 && this.bestAsk > 0) {
      this.midPrice = (this.bestBid + this.bestAsk) / 2;
    }
    this.marketTimestamp = ts || Date.now();
  }

  onTrade(lastPrice: number, ts: number): void {
    if (Number.isFinite(lastPrice) && lastPrice > 0) this.lastPrice = lastPrice;
    this.marketTimestamp = ts || this.marketTimestamp;
  }

  onTicker24h(ticker: Ticker24h): void {
    this.ticker = ticker;
    if (ticker.price > 0 && this.lastPrice === 0) this.lastPrice = ticker.price;
  }

  // ---------------- round / snapshot ----------------
  private sampleVolatility(now: number): void {
    if (this.midPrice <= 0) return;
    if (now - this.lastVolSampleTs >= GAME_CONFIG.VOL_SAMPLE_INTERVAL_MS) {
      this.estimator.sample(this.midPrice, now);
      this.lastVolSampleTs = now;
    }
  }

  /** Rounds that have open orders and have ended but are not yet settled. */
  roundsNeedingSettlement(now: number): number[] {
    const ids = new Set<number>();
    for (const order of this.ledger.allOpenOrders()) {
      if (!this.ledger.isSettled(order.roundId) && now >= order.roundId + GAME_CONFIG.ROUND_DURATION_MS) {
        ids.add(order.roundId);
      }
    }
    return [...ids].sort((a, b) => a - b);
  }

  private buildMarketSnapshot(now: number): MarketSnapshot | null {
    const round = roundFor(now);
    const knownOpen = this.roundOpenById.get(round.id) ?? 0;
    const referencePrice = this.midPrice || this.lastPrice;
    if (!(referencePrice > 0)) return null;
    // The official 5m open is fetched over REST/WS right at the boundary. In the
    // brief gap before it arrives, keep the UI live with a neutral provisional
    // open (= current mid → fair 50/50) and flag it so betting stays locked.
    const openPending = !(knownOpen > 0);
    const openPrice = openPending ? referencePrice : knownOpen;
    return {
      lastPrice: this.lastPrice || referencePrice,
      midPrice: referencePrice,
      bestBid: this.bestBid,
      bestAsk: this.bestAsk,
      roundOpen: openPrice,
      openPending,
      roundId: round.id,
      now,
      marketTimestamp: this.marketTimestamp || now,
      connected: this.connected,
      fastSigma: this.estimator.fastSigma,
      slowSigma: this.estimator.slowSigma,
      sigma: this.estimator.sigma,
      volatilityWarmed: this.estimator.warmed,
      volSamples: this.estimator.samples,
    };
  }

  private gate(snapshot: MarketSnapshot | null, now: number): { canBet: boolean; reason?: ErrorCodeType; state: BettingState } {
    const round = roundFor(now);
    // A valid last-known snapshot is enough: transient feed latency or a brief
    // reconnect never blocks trading — orders simply fill at the latest known
    // market. We only block when there is genuinely no price/open yet.
    if (!snapshot) return { canBet: false, reason: ErrorCode.MARKET_OFFLINE, state: "NO_ROUND_OPEN" };
    // Wait for the official round open before allowing the first orders of a round.
    if (snapshot.openPending) return { canBet: false, reason: ErrorCode.NO_ROUND_OPEN, state: "NO_ROUND_OPEN" };
    if (!snapshot.volatilityWarmed) {
      return { canBet: false, reason: ErrorCode.VOLATILITY_WARMING_UP, state: "VOLATILITY_WARMING_UP" };
    }
    if (now >= round.lockTime) {
      return { canBet: false, reason: ErrorCode.ROUND_LOCKED, state: "ROUND_LOCKED" };
    }
    if (snapshot.roundId !== round.id) {
      return { canBet: false, reason: ErrorCode.NO_ROUND_OPEN, state: "NO_ROUND_OPEN" };
    }
    return { canBet: true, state: "OK" };
  }

  private ensureRoundRecord(roundId: number, now: number, openPrice: number): void {
    if (this.ledger.getRound(roundId)) return;
    const record: RoundRecord = {
      id: roundId,
      startTime: roundId,
      lockTime: roundId + GAME_CONFIG.ROUND_DURATION_MS - GAME_CONFIG.BET_LOCK_MS,
      endTime: roundId + GAME_CONFIG.ROUND_DURATION_MS,
      openPrice,
      closePrice: null,
      result: null,
      status: "OPEN",
      createdAt: now,
      settledAt: null,
    };
    this.ledger.upsertRound(record);
  }

  // ---------------- public clock ----------------
  tick(now: number): void {
    const round = roundFor(now);
    this.currentRoundId = round.id;
    this.sampleVolatility(now);
    this.emit();
  }

  // ---------------- API: quote / order / position / hedge ----------------
  /** POST /api/quote equivalent. */
  requestQuote(side: Side, stakeRaw: number, now: number): Quote {
    const snapshot = this.buildMarketSnapshot(now);
    const gateResult = this.gate(snapshot, now);
    if (!gateResult.canBet) throw new EngineError(gateResult.reason ?? ErrorCode.NO_ROUND_OPEN);
    const market = snapshot as MarketSnapshot;
    const round = roundFor(now);
    const tauSeconds = Math.max(0, (round.end - now) / 1000);
    const openOrders = this.ledger.openOrdersForRound(round.id);
    const breakdown = evaluateMarket({
      openPrice: market.roundOpen,
      midPrice: market.midPrice,
      tauSeconds,
      sigma: market.sigma,
      openOrders,
    });
    return this.quoteService.createQuote({
      side,
      stake: stakeRaw,
      roundId: round.id,
      breakdown,
      spotPrice: market.midPrice,
      roundOpen: market.roundOpen,
      sigma: market.sigma,
      marketTimestamp: market.marketTimestamp,
      now,
    });
  }

  /**
   * Non-storing indicative estimate for the trade panel (req 62). Keeps showing
   * indicative odds even while LOCKED; the executable quote is created only at
   * click time via requestQuote().
   */
  estimateQuote(side: Side, stake: number, now: number) {
    const snapshot = this.buildMarketSnapshot(now);
    const round = roundFor(now);
    if (!snapshot) return null;
    const tauSeconds = Math.max(0, (round.end - now) / 1000);
    const breakdown = evaluateMarket({
      openPrice: snapshot.roundOpen,
      midPrice: snapshot.midPrice,
      tauSeconds,
      sigma: snapshot.sigma,
      openOrders: this.ledger.openOrdersForRound(round.id),
    });
    const impact = executeVirtualBook(breakdown, side, Math.max(0, stake));
    const sideProbability = side === "up" ? breakdown.pMarketUp : breakdown.pMarketDown;
    const validStake = Number.isFinite(stake) && stake >= GAME_CONFIG.MIN_BET;
    return {
      breakdown,
      sideProbability,
      baseOdds: impact.baseOdds,
      executionOdds: impact.averageOdds,
      priceImpactPercent: impact.priceImpactPercent,
      potentialPayout: validStake ? money(stake * impact.averageOdds) : 0,
      potentialProfit: validStake ? money(stake * impact.averageOdds - stake) : 0,
      quotable: validStake && isSideQuotable(breakdown, side),
    };
  }

  /**
   * POST /api/orders equivalent. The player submits an amount; the executable
   * odds are always (re)computed from the LATEST market at order time, so feed
   * latency / an outdated preview quote can never block or mis-fill the order.
   * The resulting order is a pending ("挂单"/OPEN) position until settlement.
   */
  placeOrder(side: Side, stakeRaw: number, idempotencyKey: string, now: number): Order {
    const snapshot = this.buildMarketSnapshot(now);
    const gateResult = this.gate(snapshot, now);
    const round = roundFor(now);
    if (!snapshot) throw new EngineError(gateResult.reason ?? ErrorCode.NO_ROUND_OPEN);

    const tauSeconds = Math.max(0, (round.end - now) / 1000);
    const openOrders = this.ledger.openOrdersForRound(round.id);
    const breakdown = evaluateMarket({
      openPrice: snapshot.roundOpen,
      midPrice: snapshot.midPrice,
      tauSeconds,
      sigma: snapshot.sigma,
      openOrders,
    });
    // Fresh executable quote at the latest known market (no TTL dependency).
    const quote = this.quoteService.createQuote({
      side,
      stake: stakeRaw,
      roundId: round.id,
      breakdown,
      spotPrice: snapshot.midPrice,
      roundOpen: snapshot.roundOpen,
      sigma: snapshot.sigma,
      marketTimestamp: snapshot.marketTimestamp,
      now,
    });

    const order = this.orderService.placeOrder({
      ledger: this.ledger,
      quote,
      idempotencyKey,
      currentRoundId: round.id,
      now,
      gate: { canBet: gateResult.canBet, reason: gateResult.reason },
    });
    this.ensureRoundRecord(
      round.id,
      now,
      this.roundOpenById.get(round.id) ?? order.priceAtEntry,
    );
    this.emit();
    return order;
  }

  /** GET /api/current-position equivalent. */
  getPosition(now: number): CurrentPosition {
    const round = roundFor(now);
    return buildPosition(round.id, this.ledger.orders, this.ledger.balance);
  }

  settle(roundId: number, openPrice: number, closePrice: number, now: number): SettleOutcome {
    const outcome = settleRound({ ledger: this.ledger, roundId, openPrice, closePrice, now });
    if (!outcome.alreadySettled) {
      this.lastSettlement = { ...outcome.summary, settledAt: now };
    }
    this.emit();
    return outcome;
  }

  /** Collect a single settled order's winnings/refund into the balance. */
  claimOrder(orderId: string): number {
    const amount = this.ledger.claimOrder(orderId);
    if (amount > 0) this.emit();
    return amount;
  }

  /** Collect all outstanding winnings/refunds at once. */
  claimAll(): number {
    const amount = this.ledger.claimAll();
    if (amount > 0) this.emit();
    return amount;
  }

  reset(): void {
    this.ledger.reset();
    this.quoteService.clear();
    this.orderService.resetRateLimit();
    this.lastSettlement = null;
    this.emit();
  }

  // ---------------- subscription ----------------
  getView(now: number): EngineView {
    const round = roundFor(now);
    const snapshot = this.buildMarketSnapshot(now);
    const tauSeconds = Math.max(0, (round.end - now) / 1000);
    const openOrders = this.ledger.openOrdersForRound(round.id);
    let breakdown: ProbabilityBreakdown | null = null;
    if (snapshot) {
      breakdown = evaluateMarket({
        openPrice: snapshot.roundOpen,
        midPrice: snapshot.midPrice,
        tauSeconds,
        sigma: snapshot.sigma,
        openOrders,
      });
    }
    const gateResult = this.gate(snapshot, now);
    const position = buildPosition(round.id, this.ledger.orders, this.ledger.balance);
    const settledOrders = this.ledger.orders
      .filter((o) => o.status !== "OPEN")
      .slice(0, 60)
      .map((o) => ({ ...o }));
    const fairUp = breakdown?.pFairUp ?? 0.5;
    const liquidity = syntheticLiquidity(fairUp);

    return {
      now,
      round,
      phase: roundPhase(now),
      bettingState: gateResult.state,
      connected: this.connected,
      market: snapshot,
      ticker: { ...this.ticker },
      breakdown,
      position,
      balance: this.ledger.balance,
      claimable: this.ledger.claimableBalance(),
      // Hand React fresh copies so framework-side freezing of state can never
      // reach the engine's live, mutable arrays/objects (appendPoint, settle…).
      openOrders: openOrders.map((o) => ({ ...o })),
      settledOrders,
      lastSettlement: this.lastSettlement ? { ...this.lastSettlement } : null,
      roundSummaries: [...this.ledger.rounds.values()]
        .sort((a, b) => b.id - a.id)
        .slice(0, 20)
        .map((r) => ({ ...r })),
      points: this.points.map((p) => ({ ...p })),
      upQuotable: breakdown ? isSideQuotable(breakdown, "up") : false,
      downQuotable: breakdown ? isSideQuotable(breakdown, "down") : false,
      syntheticUpLiquidity: liquidity.up,
      syntheticDownLiquidity: liquidity.down,
    };
  }

  private emit(): void {
    this.view = null;
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Snapshot for useSyncExternalStore — stable until the next emit. */
  getSnapshot = (now: number): EngineView => {
    if (!this.view || this.view.now !== now) {
      this.view = this.getView(now);
    }
    return this.view;
  };

  roundResultOf(roundId: number): RoundResult {
    return this.ledger.getRound(roundId)?.result ?? null;
  }
}

// Re-export for convenience.
export type { PricePointLike } from "./types";

function isGameStateStore(x: GameStateStore | LedgerPersister | null): x is GameStateStore {
  return x !== null && typeof (x as GameStateStore).balance === "number" && Array.isArray((x as GameStateStore).orders);
}
