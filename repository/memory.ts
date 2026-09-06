/**
 * In-memory repository implementation backed by localStorage. Used when CloudBase
 * is not configured so the app (and guest play) works with zero secrets. It
 * implements the same idempotency / atomicity contract as the CloudBase store,
 * so swapping backends changes nothing for services or UI.
 */
import type {
  LeaderboardStats,
  OrderRecord,
  Profile,
  SettlementRecord,
  User,
  Wallet,
  WalletLedgerEntry,
} from "@/lib/domain/types";
import { money } from "@/lib/domain/types";
import type {
  ClaimResult,
  LeaderboardRepository,
  OrderRepository,
  ProfileRepository,
  Repositories,
  RoundRepository,
  SettlementRepository,
  UserRepository,
  WalletRepository,
} from "./types";

const STORE_KEY = "bitbet:memory-store:v1";

class MemoryStore {
  private data: Record<string, Map<string, unknown>>;

  constructor() {
    this.data = this.load();
  }

  private load(): Record<string, Map<string, unknown>> {
    try {
      if (typeof localStorage === "undefined") return {};
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
      const data: Record<string, Map<string, unknown>> = {};
      for (const [k, v] of Object.entries(parsed)) data[k] = new Map(Object.entries(v));
      return data;
    } catch {
      return {};
    }
  }

  private persist(): void {
    try {
      if (typeof localStorage === "undefined") return;
      const plain: Record<string, Record<string, unknown>> = {};
      for (const [k, v] of Object.entries(this.data)) plain[k] = Object.fromEntries(v.entries());
      localStorage.setItem(STORE_KEY, JSON.stringify(plain));
    } catch {
      /* storage full / unavailable — keep in memory */
    }
  }

  coll(name: string): Map<string, unknown> {
    if (!this.data[name]) this.data[name] = new Map();
    return this.data[name];
  }

  upsert<T extends object>(name: string, id: string, doc: T): void {
    this.coll(name).set(id, { ...doc, _id: id } as Record<string, unknown>);
    this.persist();
  }

  get<T>(name: string, id: string): T | null {
    return (this.coll(name).get(id) as T | undefined) ?? null;
  }

  list<T>(name: string): T[] {
    return [...this.coll(name).values()] as T[];
  }
}

const store = new MemoryStore();

const nowMs = () => Date.now();

function newId(prefix: string): string {
  return `${prefix}-${nowMs().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

// ---- repositories ---------------------------------------------------------

const users: UserRepository = {
  async createUser({ authUid, username, now }) {
    const user: User = { _id: authUid, authUid, username, status: "active", createdAt: now, lastLoginAt: now };
    store.upsert("users", authUid, user);
    return user;
  },
  async getUserByAuthUid(authUid) {
    return store.get<User>("users", authUid);
  },
  async getUserByUsername(username) {
    const match = store.list<User>("users").find((u) => u.username.toLowerCase() === username.toLowerCase());
    return match ?? null;
  },
  async touchLogin(userId, at) {
    const u = store.get<User>("users", userId);
    if (u) store.upsert("users", userId, { ...u, lastLoginAt: at });
  },
};

const profiles: ProfileRepository = {
  async createProfile(profile) {
    store.upsert("profiles", profile.userId, profile);
    return profile;
  },
  async getProfile(userId) {
    return store.get<Profile>("profiles", userId);
  },
  async updateProfile(userId, patch, now) {
    const p = store.get<Profile>("profiles", userId);
    if (!p) return null;
    const updated: Profile = { ...p, ...patch, updatedAt: now };
    store.upsert("profiles", userId, updated);
    return updated;
  },
};

function appendLedger(entry: Omit<WalletLedgerEntry, "_id" | "ledgerId">): void {
  const ledgerId = newId("ledger");
  store.upsert("wallet_ledger", ledgerId, { ...entry, _id: ledgerId, ledgerId });
}

const wallets: WalletRepository = {
  async createWallet({ userId, initialBalance, now }) {
    const wallet: Wallet = {
      _id: userId,
      userId,
      availableBalance: initialBalance,
      pendingClaim: 0,
      initialBalance,
      totalStaked: 0,
      totalClaimed: 0,
      netProfit: 0,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    store.upsert("wallets", userId, wallet);
    appendLedger({ userId, type: "INITIAL_BALANCE", amount: initialBalance, balanceAfter: initialBalance, createdAt: now });
    return wallet;
  },
  async getWallet(userId) {
    return store.get<Wallet>("wallets", userId);
  },
  async debit(userId, { orderId, roundId, stake, now }) {
    const w = store.get<Wallet>("wallets", userId);
    if (!w) throw new Error("wallet not found");
    if (w.availableBalance + 1e-9 < stake) throw new Error("insufficient balance");
    const updated: Wallet = {
      ...w,
      availableBalance: money(w.availableBalance - stake),
      totalStaked: money(w.totalStaked + stake),
      updatedAt: now,
      version: w.version + 1,
    };
    store.upsert("wallets", userId, updated);
    appendLedger({ userId, type: "BET", amount: -stake, balanceAfter: updated.availableBalance, roundId, orderId, createdAt: now });
    return updated;
  },
  async claimCredit(userId, { settlementId, amount, now }) {
    const w = store.get<Wallet>("wallets", userId);
    if (!w) throw new Error("wallet not found");
    const updated: Wallet = {
      ...w,
      pendingClaim: money(Math.max(0, w.pendingClaim - amount)),
      availableBalance: money(w.availableBalance + amount),
      totalClaimed: money(w.totalClaimed + amount),
      updatedAt: now,
      version: w.version + 1,
    };
    store.upsert("wallets", userId, updated);
    appendLedger({ userId, type: "CLAIM", amount, balanceAfter: updated.availableBalance, settlementId, createdAt: now });
    return updated;
  },
  async addPendingClaim(userId, amount, now) {
    const w = store.get<Wallet>("wallets", userId);
    if (!w) throw new Error("wallet not found");
    const updated: Wallet = { ...w, pendingClaim: money(w.pendingClaim + amount), updatedAt: now, version: w.version + 1 };
    store.upsert("wallets", userId, updated);
    return updated;
  },
};

const orders: OrderRepository = {
  async createOrder(order) {
    store.upsert("orders", order.orderId, order);
  },
  async listByUser(userId, limit = 50) {
    return store
      .list<OrderRecord>("orders")
      .filter((o) => o.userId === userId)
      .sort((a, b) => b.placedAt - a.placedAt)
      .slice(0, limit);
  },
};

const rounds: RoundRepository = {
  async createRound(round) {
    store.upsert("rounds", round.roundId, round);
  },
};

const settlements: SettlementRepository = {
  async createSettlement(settlement) {
    // Idempotent: never overwrite an already-claimed record's claim state.
    const existing = store.get<SettlementRecord>("settlements", settlement.settlementId);
    if (!existing) store.upsert("settlements", settlement.settlementId, settlement);
  },
  async getSettlement(settlementId) {
    return store.get<SettlementRecord>("settlements", settlementId);
  },
  async listPending(userId) {
    return store
      .list<SettlementRecord>("settlements")
      .filter((s) => s.userId === userId && s.claimStatus === "pending")
      .sort((a, b) => a.settledAt - b.settledAt);
  },
};

/** Atomic claim: single-threaded (no awaits) so mark + credit + ledger is one step. */
async function claimAtomic(userId: string, settlementId: string, now: number): Promise<ClaimResult> {
  const s = store.get<SettlementRecord>("settlements", settlementId);
  if (!s) throw new Error("settlement not found");
  if (s.userId !== userId) throw new Error("无权领取该结算");
  if (s.claimStatus === "claimed") return { alreadyClaimed: true, amount: 0 };

  const w = store.get<Wallet>("wallets", userId);
  if (!w) throw new Error("wallet not found");

  const amount = s.payout;
  store.upsert("settlements", settlementId, { ...s, claimStatus: "claimed", claimedAt: now });
  store.upsert("wallets", userId, {
    ...w,
    pendingClaim: money(Math.max(0, w.pendingClaim - amount)),
    availableBalance: money(w.availableBalance + amount),
    totalClaimed: money(w.totalClaimed + amount),
    updatedAt: now,
    version: w.version + 1,
  });
  appendLedger({ userId, type: "CLAIM", amount, balanceAfter: money(w.availableBalance + amount), settlementId, createdAt: now });

  return { alreadyClaimed: false, amount };
}

const leaderboard: LeaderboardRepository = {
  async upsertStats(stats) {
    store.upsert("leaderboard_stats", stats.userId, stats);
  },
  async listTop(sortBy, limit) {
    const rows = store.list<LeaderboardStats>("leaderboard_stats");
    rows.sort((a, b) => (b[sortBy] ?? 0) - (a[sortBy] ?? 0));
    return rows.slice(0, limit);
  },
  async getStats(userId) {
    return store.get<LeaderboardStats>("leaderboard_stats", userId);
  },
  async getRank(userId, sortBy) {
    const rows = store.list<LeaderboardStats>("leaderboard_stats");
    rows.sort((a, b) => (b[sortBy] ?? 0) - (a[sortBy] ?? 0));
    const idx = rows.findIndex((r) => r.userId === userId);
    return idx < 0 ? -1 : idx + 1;
  },
};

export function createMemoryRepositories(): Repositories {
  return { users, profiles, wallets, orders, rounds, settlements, leaderboard, claim: claimAtomic };
}
