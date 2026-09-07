/**
 * Repository interfaces — the persistence contract for account, wallet, orders,
 * settlements and leaderboard. UI talks to services; services talk to these;
 * repositories talk to CloudBase (or a memory mock in development).
 */
import type {
  LeaderboardStats,
  OrderRecord,
  Profile,
  RoundRecord,
  SettlementRecord,
  User,
  Wallet,
} from "@/lib/domain/types";

export type LeaderboardSortKey = "netProfit" | "roi" | "winRate" | "currentBalance";

export interface UserRepository {
  createUser(input: { authUid: string; email?: string; username: string; now: number }): Promise<User>;
  getUserByAuthUid(authUid: string): Promise<User | null>;
  getUserByUsername(username: string): Promise<User | null>;
  touchLogin(userId: string, at: number): Promise<void>;
}

export interface ProfileRepository {
  createProfile(profile: Profile): Promise<Profile>;
  getProfile(userId: string): Promise<Profile | null>;
  updateProfile(
    userId: string,
    patch: Partial<Pick<Profile, "username" | "avatarUrl" | "bio">>,
    now: number,
  ): Promise<Profile | null>;
}

export interface WalletRepository {
  createWallet(input: { userId: string; initialBalance: number; now: number }): Promise<Wallet>;
  getWallet(userId: string): Promise<Wallet | null>;
  /** Atomic debit for a bet (balance decreases; totalStaked increases). */
  debit(userId: string, input: { orderId: string; roundId: string; stake: number; now: number }): Promise<Wallet>;
  /** Atomic credit for a claim (pendingClaim decreases; balance increases). */
  claimCredit(userId: string, input: { settlementId: string; amount: number; now: number }): Promise<Wallet>;
  /** Add settlement payout to pendingClaim (funds not yet spendable). */
  addPendingClaim(userId: string, amount: number, now: number): Promise<Wallet>;
}

export interface OrderRepository {
  /** Idempotent create (upsert by orderId). */
  createOrder(order: OrderRecord): Promise<void>;
  listByUser(userId: string, limit?: number): Promise<OrderRecord[]>;
}

export interface RoundRepository {
  /** Idempotent create (upsert by roundId). */
  createRound(round: RoundRecord): Promise<void>;
}

export interface SettlementRepository {
  /** Idempotent create (upsert by settlementId). */
  createSettlement(settlement: SettlementRecord): Promise<void>;
  getSettlement(settlementId: string): Promise<SettlementRecord | null>;
  listPending(userId: string): Promise<SettlementRecord[]>;
}

export interface ClaimResult {
  alreadyClaimed: boolean;
  amount: number;
}

export interface LeaderboardRepository {
  upsertStats(stats: LeaderboardStats): Promise<void>;
  listTop(sortBy: LeaderboardSortKey, limit: number, minOrders?: number): Promise<LeaderboardStats[]>;
  getStats(userId: string): Promise<LeaderboardStats | null>;
  getRank(userId: string, sortBy: LeaderboardSortKey): Promise<number>;
}

/** Aggregate of every repository, injected into services. */
export interface Repositories {
  users: UserRepository;
  profiles: ProfileRepository;
  wallets: WalletRepository;
  orders: OrderRepository;
  rounds: RoundRepository;
  settlements: SettlementRepository;
  leaderboard: LeaderboardRepository;
  /**
   * Atomic cross-collection claim: marks the settlement claimed, credits the
   * wallet and writes the ledger in one step. A repeat claim returns
   * { alreadyClaimed: true } and never touches the wallet twice.
   */
  claim(userId: string, settlementId: string, now: number): Promise<ClaimResult>;
  /** Debit wallet + insert the idempotent order + ledger row in one transaction. */
  placeOrder(userId: string, order: OrderRecord, now: number): Promise<{ wallet: Wallet; alreadyExisted: boolean }>;
  /** Claim every currently pending settlement in one transaction. */
  claimAll(userId: string, now: number): Promise<{ amount: number; count: number }>;
  /** Compare the wallet cache with the sum of pending settlement facts. */
  pendingClaimConsistency(userId: string): Promise<{ cached: number; expected: number; consistent: boolean }>;
  /** Rebuild wallets.pending_claim from settlement facts. */
  rebuildPendingClaim(userId: string, now: number): Promise<Wallet>;
  /** Insert a settlement fact and update the pending cache in one transaction. */
  recordSettlement(settlement: SettlementRecord, now: number): Promise<{ created: boolean; wallet: Wallet }>;
}
