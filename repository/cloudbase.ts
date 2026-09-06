/**
 * CloudBase NoSQL repository implementation. Uses the browser SDK; every create
 * is an idempotent upsert keyed by the business id (orderId / settlementId /
 * userId …) so cross-border sync retries can never duplicate rows.
 */
import type {
  LeaderboardStats,
  OrderRecord,
  Profile,
  SettlementRecord,
  User,
  Wallet,
} from "@/lib/domain/types";
import { money } from "@/lib/domain/types";
import { COLLECTIONS } from "@/lib/cloudbase/collections";
import { getCloudBaseApp } from "@/lib/cloudbase/client";
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

async function db() {
  const app = await getCloudBaseApp();
  if (!app) throw new Error("CloudBase not configured");
  return app.database();
}

async function coll(name: string) {
  const d = await db();
  return d.collection(name);
}

/** Idempotent upsert: set() with the business id as the doc id. */
async function upsert<T extends object>(name: string, id: string, doc: T): Promise<void> {
  const c = await coll(name);
  await c.doc(id).set({ ...doc, _id: id } as unknown as Record<string, unknown>);
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function first<T>(res: { data?: Record<string, unknown>[] } | undefined): T | null {
  return (res?.data?.[0] as T | undefined) ?? null;
}

const users: UserRepository = {
  async createUser({ authUid, username, now }) {
    const user: User = { _id: authUid, authUid, username, status: "active", createdAt: now, lastLoginAt: now };
    await upsert(COLLECTIONS.users, authUid, user);
    return user;
  },
  async getUserByAuthUid(authUid) {
    const c = await coll(COLLECTIONS.users);
    const res = await c.doc(authUid).get();
    return first<User>(res);
  },
  async getUserByUsername(username) {
    const c = await coll(COLLECTIONS.users);
    const res = await c.where({ username }).limit(1).get();
    return first<User>(res);
  },
  async touchLogin(userId, at) {
    const c = await coll(COLLECTIONS.users);
    await c.doc(userId).update({ lastLoginAt: at });
  },
};

const profiles: ProfileRepository = {
  async createProfile(profile) {
    await upsert(COLLECTIONS.profiles, profile.userId, profile);
    return profile;
  },
  async getProfile(userId) {
    const c = await coll(COLLECTIONS.profiles);
    const res = await c.doc(userId).get();
    return first<Profile>(res);
  },
  async updateProfile(userId, patch, now) {
    const c = await coll(COLLECTIONS.profiles);
    await c.doc(userId).update({ ...patch, updatedAt: now });
    const res = await c.doc(userId).get();
    return first<Profile>(res);
  },
};

async function appendLedger(userId: string, entry: { type: string; amount: number; balanceAfter: number; roundId?: string; orderId?: string; settlementId?: string; createdAt: number }): Promise<void> {
  const ledgerId = newId("ledger");
  await upsert(COLLECTIONS.walletLedger, ledgerId, { ...entry, _id: ledgerId, ledgerId, userId });
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
    await upsert(COLLECTIONS.wallets, userId, wallet);
    await appendLedger(userId, { type: "INITIAL_BALANCE", amount: initialBalance, balanceAfter: initialBalance, createdAt: now });
    return wallet;
  },
  async getWallet(userId) {
    const c = await coll(COLLECTIONS.wallets);
    const res = await c.doc(userId).get();
    return first<Wallet>(res);
  },
  async debit(userId, { orderId, roundId, stake, now }) {
    const w = await this.getWallet(userId);
    if (!w) throw new Error("wallet not found");
    if (w.availableBalance + 1e-9 < stake) throw new Error("insufficient balance");
    const updated: Wallet = {
      ...w,
      availableBalance: money(w.availableBalance - stake),
      totalStaked: money(w.totalStaked + stake),
      updatedAt: now,
      version: w.version + 1,
    };
    await upsert(COLLECTIONS.wallets, userId, updated);
    await appendLedger(userId, { type: "BET", amount: -stake, balanceAfter: updated.availableBalance, roundId, orderId, createdAt: now });
    return updated;
  },
  async claimCredit(userId, { settlementId, amount, now }) {
    const w = await this.getWallet(userId);
    if (!w) throw new Error("wallet not found");
    const updated: Wallet = {
      ...w,
      pendingClaim: money(Math.max(0, w.pendingClaim - amount)),
      availableBalance: money(w.availableBalance + amount),
      totalClaimed: money(w.totalClaimed + amount),
      updatedAt: now,
      version: w.version + 1,
    };
    await upsert(COLLECTIONS.wallets, userId, updated);
    await appendLedger(userId, { type: "CLAIM", amount, balanceAfter: updated.availableBalance, settlementId, createdAt: now });
    return updated;
  },
  async addPendingClaim(userId, amount, now) {
    const w = await this.getWallet(userId);
    if (!w) throw new Error("wallet not found");
    const updated: Wallet = { ...w, pendingClaim: money(w.pendingClaim + amount), updatedAt: now, version: w.version + 1 };
    await upsert(COLLECTIONS.wallets, userId, updated);
    return updated;
  },
};

const orders: OrderRepository = {
  async createOrder(order) {
    await upsert(COLLECTIONS.orders, order.orderId, order);
  },
  async listByUser(userId, limit = 50) {
    const c = await coll(COLLECTIONS.orders);
    const res = await c.where({ userId }).orderBy("placedAt", "desc").limit(limit).get();
    return (res?.data ?? []) as unknown as OrderRecord[];
  },
};

const rounds: RoundRepository = {
  async createRound(round) {
    await upsert(COLLECTIONS.rounds, round.roundId, round);
  },
};

const settlements: SettlementRepository = {
  async createSettlement(settlement) {
    // set() would overwrite a claimed record; only insert when absent.
    const c = await coll(COLLECTIONS.settlements);
    const existing = await c.doc(settlement.settlementId).get();
    if (!existing?.data?.length) await c.doc(settlement.settlementId).set({ ...settlement, _id: settlement.settlementId });
  },
  async getSettlement(settlementId) {
    const c = await coll(COLLECTIONS.settlements);
    const res = await c.doc(settlementId).get();
    return first<SettlementRecord>(res);
  },
  async listPending(userId) {
    const c = await coll(COLLECTIONS.settlements);
    const res = await c.where({ userId, claimStatus: "pending" }).orderBy("settledAt", "asc").limit(100).get();
    return (res?.data ?? []) as unknown as SettlementRecord[];
  },
};

/** Atomic claim via a CloudBase transaction: mark + credit + ledger together. */
async function claimAtomic(userId: string, settlementId: string, now: number): Promise<ClaimResult> {
  const d = await db();
  return d.runTransaction(async (tx) => {
    const sc = tx.collection(COLLECTIONS.settlements);
    const wc = tx.collection(COLLECTIONS.wallets);
    const lc = tx.collection(COLLECTIONS.walletLedger);

    const sres = await sc.doc(settlementId).get();
    const s = sres?.data?.[0] as SettlementRecord | undefined;
    if (!s) throw new Error("settlement not found");
    if (s.userId !== userId) throw new Error("无权领取该结算");
    if (s.claimStatus === "claimed") return { alreadyClaimed: true, amount: 0 };

    const wres = await wc.doc(userId).get();
    const w = wres?.data?.[0] as Wallet | undefined;
    if (!w) throw new Error("wallet not found");

    const amount = s.payout;
    await sc.doc(settlementId).update({ claimStatus: "claimed", claimedAt: now });
    await wc.doc(userId).update({
      pendingClaim: money(Math.max(0, w.pendingClaim - amount)),
      availableBalance: money(w.availableBalance + amount),
      totalClaimed: money(w.totalClaimed + amount),
      updatedAt: now,
      version: w.version + 1,
    });
    const ledgerId = newId("ledger");
    await lc.doc(ledgerId).set({
      _id: ledgerId,
      ledgerId,
      userId,
      type: "CLAIM",
      amount,
      balanceAfter: money(w.availableBalance + amount),
      settlementId,
      createdAt: now,
    });

    return { alreadyClaimed: false, amount };
  });
}

const leaderboard: LeaderboardRepository = {
  async upsertStats(stats) {
    await upsert(COLLECTIONS.leaderboardStats, stats.userId, stats);
  },
  async listTop(sortBy, limit) {
    const c = await coll(COLLECTIONS.leaderboardStats);
    const res = await c.orderBy(sortBy, "desc").limit(limit).get();
    return (res?.data ?? []) as unknown as LeaderboardStats[];
  },
  async getStats(userId) {
    const c = await coll(COLLECTIONS.leaderboardStats);
    const res = await c.doc(userId).get();
    return first<LeaderboardStats>(res);
  },
  async getRank(userId, sortBy) {
    const self = await this.getStats(userId);
    if (!self) return -1;
    const d = await db();
    const c = d.collection(COLLECTIONS.leaderboardStats);
    const _ = d.command;
    const res = await c.where({ [sortBy]: _.gt(self[sortBy] ?? 0) }).count();
    return (res?.total ?? 0) + 1;
  },
};

export function createCloudBaseRepositories(): Repositories {
  return { users, profiles, wallets, orders, rounds, settlements, leaderboard, claim: claimAtomic };
}
