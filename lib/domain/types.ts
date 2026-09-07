/**
 * BitBet domain types — the single source of truth for persisted entities.
 *
 * These are decoupled from the storage backend. Timestamps are epoch
 * milliseconds. Runtime values are numbers for engine compatibility; MySQL
 * persists all money as DECIMAL and adapters convert only at the boundary.
 */

export type Side = "up" | "down";
export type RoundResult = "UP" | "DOWN" | "DRAW";
export type OrderStatus = "OPEN" | "SETTLED" | "VOID";
export type ClaimStatus = "pending" | "claimed";
export type RoundStatus = "OPEN" | "SETTLED";

/** CloudBase Auth identity + minimal business record (no password is stored). */
export interface User {
  _id: string; // = authUid
  authUid: string;
  email?: string;
  username: string;
  status: "active" | "disabled";
  createdAt: number;
  lastLoginAt: number;
}

export interface Profile {
  _id: string; // = userId
  userId: string;
  username: string; // unique
  avatarUrl: string;
  bio: string;
  createdAt: number;
  updatedAt: number;
}

/** Authoritative wallet state. availableBalance + pendingClaim = total assets. */
export interface Wallet {
  _id: string; // = userId
  userId: string;
  availableBalance: number;
  pendingClaim: number;
  initialBalance: number;
  totalStaked: number;
  totalClaimed: number;
  netProfit: number;
  createdAt: number;
  updatedAt: number;
  version: number;
}

export type WalletLedgerType =
  | "INITIAL_BALANCE"
  | "BET"
  | "CLAIM"
  | "REFUND"
  | "ADJUSTMENT";

export interface WalletLedgerEntry {
  _id: string; // = ledgerId
  ledgerId: string;
  userId: string;
  type: WalletLedgerType;
  amount: number;
  balanceAfter: number;
  roundId?: string;
  orderId?: string;
  settlementId?: string;
  createdAt: number;
}

export interface RoundRecord {
  _id: string; // = roundId
  roundId: string; // globally unique, e.g. "BTCUSDT-20260906-180500"
  symbol: "BTCUSDT";
  startTime: number;
  endTime: number;
  openPrice: number;
  closePrice: number | null;
  result: RoundResult | null;
  status: RoundStatus;
  settledAt: number | null;
  createdAt: number;
}

/** One bet = one order. Never aggregated (multiple bets / both sides per round). */
export interface OrderRecord {
  _id: string; // = orderId (unique)
  orderId: string;
  userId: string;
  roundId: string;
  /** Unique per user. Required by the authoritative persistence write path. */
  idempotencyKey: string;
  side: Side;
  stake: number;
  lockedOdds: number;
  potentialPayout: number;
  entryPrice: number;
  placedAt: number;
  status: OrderStatus;
  payout: number;
  profit: number;
  settlementId?: string;
  createdAt: number;
}

export interface SettlementRecord {
  _id: string; // = settlementId (unique)
  settlementId: string;
  userId: string;
  roundId: string;
  orderId: string;
  result: RoundResult;
  stake: number;
  lockedOdds: number;
  payout: number;
  profit: number;
  claimStatus: ClaimStatus;
  settledAt: number;
  claimedAt: number | null;
  createdAt: number;
}

export interface LeaderboardStats {
  _id: string; // = userId
  userId: string;
  totalOrders: number;
  totalRounds: number;
  totalStaked: number;
  totalPayout: number;
  netProfit: number;
  roi: number; // netProfit / initialBalance
  wins: number;
  losses: number;
  winRate: number; // wins / settled outcomes (0 when no sample)
  currentBalance: number;
  updatedAt: number;
}

export type SyncBatchStatus = "pending" | "syncing" | "synced" | "failed";

export interface SyncBatch {
  _id: string; // = batchId
  batchId: string;
  roundId: string;
  status: SyncBatchStatus;
  attemptCount: number;
  lastError?: string;
  nextAttemptAt?: number | null;
  leaseOwner?: string | null;
  leaseExpiresAt?: number | null;
  createdAt: number;
  updatedAt?: number;
  syncedAt: number | null;
}

/** Rounded to 2 decimals, matching the engine's money() convention. */
export function money(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
