export type Side = "up" | "down";

export interface PricePointLike {
  time: number;
  price: number;
}
export type OrderStatus = "OPEN" | "WON" | "LOST" | "VOID";
export type RoundStatus = "OPEN" | "LOCKED" | "SETTLING" | "SETTLED";
export type RoundResult = "UP" | "DOWN" | "DRAW" | null;
export type BettingState =
  | "OK"
  | "VOLATILITY_WARMING_UP"
  | "ROUND_LOCKED"
  | "MARKET_ONE_SIDED"
  | "NO_ROUND_OPEN";

// ---- Market snapshot produced by the feed/estimator at a moment in time ----
export interface MarketSnapshot {
  /** Public exchange trade/last price (for display). */
  lastPrice: number;
  /** Mid = (bestBid + bestAsk) / 2 — the odds engine uses this. */
  midPrice: number;
  bestBid: number;
  bestAsk: number;
  /** Official round OPEN = current 5m kline open (S0). */
  roundOpen: number;
  /**
   * True only in the brief moment after a round starts before its official 5m
   * open arrives: roundOpen is a neutral provisional (= current mid) and betting
   * stays disabled. Keeps the UI populated instead of flashing "—".
   */
  openPending?: boolean;
  roundId: number;
  now: number;
  marketTimestamp: number;
  connected: boolean;
  // Volatility (per-second log-return sigma).
  fastSigma: number;
  slowSigma: number;
  sigma: number;
  volatilityWarmed: boolean;
  volSamples: number;
}

export interface Ticker24h {
  price: number;
  change: number;
  high: number;
  low: number;
  volume: number;
  quoteVolume: number;
}

// ---- Fair / adjusted probability breakdown ----
export interface ProbabilityBreakdown {
  z: number;
  x: number; // ln(St / S0)
  tau: number; // seconds remaining
  pFairUp: number;
  pFairDown: number;
  liabilityUp: number;
  liabilityDown: number;
  inventory: number;
  inventorySkewLogit: number;
  pMarketUp: number;
  pMarketDown: number;
  baseUpOdds: number;
  baseDownOdds: number;
}

// ---- Quote (req 31/57) ----
export interface Quote {
  quoteId: string;
  roundId: number;
  side: Side;
  stake: number;
  spotPrice: number;
  roundOpen: number;
  pFairUp: number;
  pMarketUp: number;
  displayedBaseOdds: number;
  averageExecutionOdds: number;
  priceImpactPercent: number; // negative, e.g. -0.026
  potentialPayout: number;
  potentialProfit: number;
  volatilityAtEntry: number;
  inventoryAtEntry: number;
  marketTimestamp: number;
  createdAt: number;
  expiresAt: number;
}

// ---- Order (req 54) ----
export interface Order {
  id: string;
  userId: string;
  roundId: number;
  side: Side;
  stake: number;
  lockedOdds: number;
  potentialPayout: number;
  priceAtEntry: number;
  pFairUpAtEntry: number;
  pMarketUpAtEntry: number;
  volatilityAtEntry: number;
  inventoryAtEntry: number;
  priceImpactPercent: number;
  quoteId: string;
  idempotencyKey: string;
  /** Short strategy explanation for bot orders; absent for manual orders. */
  reason?: string;
  /** Explainable decision facts captured at entry; never recomputed later. */
  strategyMeta?: {
    modelProbability?: number;
    executionOdds?: number;
    edge?: number;
    signalScore?: number;
    adaptiveHedge?: boolean;
  };
  status: OrderStatus;
  payout: number;
  profit: number;
  /**
   * Whether the settlement payout (WON) or refund (VOID) has been claimed into
   * the spendable balance. Winnings stay "claimable" until the player collects
   * them, giving each settled round a tangible claim interaction.
   */
  claimed: boolean;
  createdAt: number;
  settledAt: number | null;
}

// ---- Round (req 56) ----
export interface RoundRecord {
  id: number;
  startTime: number;
  lockTime: number;
  endTime: number;
  openPrice: number;
  closePrice: number | null;
  result: RoundResult;
  status: RoundStatus;
  createdAt: number;
  settledAt: number | null;
}

export interface RoundPortfolioSummary {
  roundId: number;
  totalInvested: number;
  upStake: number;
  downStake: number;
  winningSide: RoundResult;
  grossPayout: number;
  roundPnL: number;
  orderCount: number;
}

/** Latest settled round, surfaced to the UI for a smooth result hand-off. */
export interface SettlementNotice extends RoundPortfolioSummary {
  settledAt: number;
}

// ---- Position aggregation (req 34-39) ----
export interface SidePosition {
  stake: number;
  avgOdds: number;
  payout: number;
  count: number;
}

export interface CurrentPosition {
  roundId: number;
  up: SidePosition;
  down: SidePosition;
  totalInvested: number;
  pnlIfUp: number;
  pnlIfDown: number;
  exposure: number; // risk gap = |pnlIfUp - pnlIfDown|
  availableBalance: number;
}

// ---- Ledger persistence ----
export interface LedgerSnapshot {
  balance: number;
  orders: Order[];
  rounds: Record<string, RoundRecord>;
  idempotency: Record<string, string>; // idempotencyKey -> orderId
  settledRounds: string[];
  version: number;
}
