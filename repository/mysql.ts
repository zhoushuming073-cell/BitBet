import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import type {
  LeaderboardStats,
  OrderRecord,
  Profile,
  SettlementRecord,
  User,
  Wallet,
} from "@/lib/domain/types";
import { money } from "@/lib/domain/types";
import { getMySqlPool, withTransaction } from "@/lib/mysql/pool";
import type { LeaderboardSortKey, Repositories } from "./types";

type DbRow = RowDataPacket & Record<string, unknown>;

const SORT_COLUMN: Record<LeaderboardSortKey, string> = {
  netProfit: "net_profit",
  roi: "roi",
  winRate: "win_rate",
  currentBalance: "current_balance",
};

function numeric(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function toUser(row: DbRow): User {
  return {
    _id: text(row.id),
    authUid: text(row.auth_uid),
    email: row.email == null ? undefined : text(row.email),
    username: text(row.username),
    status: row.status === "disabled" ? "disabled" : "active",
    createdAt: numeric(row.created_at),
    lastLoginAt: numeric(row.last_login_at),
  };
}

function toProfile(row: DbRow): Profile {
  return {
    _id: text(row.user_id),
    userId: text(row.user_id),
    username: text(row.username),
    avatarUrl: text(row.avatar_url),
    bio: text(row.bio),
    createdAt: numeric(row.created_at),
    updatedAt: numeric(row.updated_at),
  };
}

function toWallet(row: DbRow): Wallet {
  return {
    _id: text(row.user_id),
    userId: text(row.user_id),
    availableBalance: numeric(row.available_balance),
    pendingClaim: numeric(row.pending_claim),
    initialBalance: numeric(row.initial_balance),
    totalStaked: numeric(row.total_staked),
    totalClaimed: numeric(row.total_claimed),
    netProfit: numeric(row.net_profit),
    createdAt: numeric(row.created_at),
    updatedAt: numeric(row.updated_at),
    version: numeric(row.version),
  };
}

function toOrder(row: DbRow): OrderRecord {
  return {
    _id: text(row.order_id),
    orderId: text(row.order_id),
    userId: text(row.user_id),
    roundId: text(row.round_id),
    idempotencyKey: text(row.idempotency_key),
    side: row.side === "down" ? "down" : "up",
    stake: numeric(row.stake),
    lockedOdds: numeric(row.locked_odds),
    potentialPayout: numeric(row.potential_payout),
    entryPrice: numeric(row.entry_price),
    placedAt: numeric(row.placed_at),
    status: row.status as OrderRecord["status"],
    payout: numeric(row.payout),
    profit: numeric(row.profit),
    settlementId: row.settlement_id == null ? undefined : text(row.settlement_id),
    createdAt: numeric(row.created_at),
  };
}

function toSettlement(row: DbRow): SettlementRecord {
  return {
    _id: text(row.settlement_id),
    settlementId: text(row.settlement_id),
    userId: text(row.user_id),
    roundId: text(row.round_id),
    orderId: text(row.order_id),
    result: row.result as SettlementRecord["result"],
    stake: numeric(row.stake),
    lockedOdds: numeric(row.locked_odds),
    payout: numeric(row.payout),
    profit: numeric(row.profit),
    claimStatus: row.claim_status as SettlementRecord["claimStatus"],
    settledAt: numeric(row.settled_at),
    claimedAt: row.claimed_at == null ? null : numeric(row.claimed_at),
    createdAt: numeric(row.created_at),
  };
}

function toStats(row: DbRow): LeaderboardStats {
  return {
    _id: text(row.user_id),
    userId: text(row.user_id),
    totalOrders: numeric(row.total_orders),
    totalRounds: numeric(row.total_rounds),
    totalStaked: numeric(row.total_staked),
    totalPayout: numeric(row.total_payout),
    netProfit: numeric(row.net_profit),
    roi: numeric(row.roi),
    wins: numeric(row.wins),
    losses: numeric(row.losses),
    winRate: numeric(row.win_rate),
    currentBalance: numeric(row.current_balance),
    updatedAt: numeric(row.updated_at),
  };
}

async function walletForUpdate(connection: PoolConnection, userId: string): Promise<Wallet> {
  const [rows] = await connection.execute<DbRow[]>(
    "SELECT * FROM wallets WHERE user_id = ? FOR UPDATE",
    [userId],
  );
  if (!rows[0]) throw new Error("wallet not found");
  return toWallet(rows[0]);
}

function orderValues(order: OrderRecord): Array<string | number | null> {
  return [
    order.orderId, order.userId, order.roundId, order.idempotencyKey, order.side,
    order.stake.toFixed(2), order.lockedOdds.toFixed(6), order.potentialPayout.toFixed(2),
    order.entryPrice.toFixed(8), order.placedAt, order.status, order.payout.toFixed(2),
    order.profit.toFixed(2), order.settlementId ?? null, order.createdAt,
  ];
}

const INSERT_ORDER = `INSERT INTO orders
  (order_id, user_id, round_id, idempotency_key, side, stake, locked_odds,
   potential_payout, entry_price, placed_at, status, payout, profit, settlement_id, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const INSERT_SETTLEMENT = `INSERT INTO settlements
  (settlement_id, user_id, round_id, order_id, result, stake, locked_odds, payout,
   profit, claim_status, settled_at, claimed_at, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const INSERT_SETTLEMENT_IF_NEW = INSERT_SETTLEMENT.replace("INSERT INTO", "INSERT IGNORE INTO");

function settlementValues(settlement: SettlementRecord): Array<string | number | null> {
  return [
    settlement.settlementId, settlement.userId, settlement.roundId, settlement.orderId,
    settlement.result, settlement.stake.toFixed(2), settlement.lockedOdds.toFixed(6),
    settlement.payout.toFixed(2), settlement.profit.toFixed(2), settlement.claimStatus,
    settlement.settledAt, settlement.claimedAt, settlement.createdAt,
  ];
}

function ledgerId(prefix: string, key: string): string {
  return `${prefix}-${key}`.slice(0, 96);
}

export function createMySqlRepositories(): Repositories {
  const users: Repositories["users"] = {
    async createUser({ authUid, email, username, now }) {
      const pool = await getMySqlPool();
      await pool.execute(
        `INSERT INTO users (id, auth_uid, email, username, status, created_at, last_login_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?)
         ON DUPLICATE KEY UPDATE id = id`,
        [authUid, authUid, email ?? null, username, now, now],
      );
      const created = await this.getUserByAuthUid(authUid);
      if (!created || created.username !== username) throw new Error("邮箱或用户名已被占用");
      return created;
    },
    async getUserByAuthUid(authUid) {
      const pool = await getMySqlPool();
      const [rows] = await pool.execute<DbRow[]>("SELECT * FROM users WHERE auth_uid = ? LIMIT 1", [authUid]);
      return rows[0] ? toUser(rows[0]) : null;
    },
    async getUserByUsername(username) {
      const pool = await getMySqlPool();
      const [rows] = await pool.execute<DbRow[]>("SELECT * FROM users WHERE username = ? LIMIT 1", [username]);
      return rows[0] ? toUser(rows[0]) : null;
    },
    async touchLogin(userId, at) {
      const pool = await getMySqlPool();
      await pool.execute("UPDATE users SET last_login_at = ? WHERE id = ?", [at, userId]);
    },
  };

  const profiles: Repositories["profiles"] = {
    async createProfile(profile) {
      const pool = await getMySqlPool();
      await pool.execute(
        `INSERT INTO profiles (user_id, username, avatar_url, bio, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE user_id = user_id`,
        [profile.userId, profile.username, profile.avatarUrl, profile.bio, profile.createdAt, profile.updatedAt],
      );
      const created = await this.getProfile(profile.userId);
      if (!created || created.username !== profile.username) throw new Error("用户名已被占用");
      return created;
    },
    async getProfile(userId) {
      const pool = await getMySqlPool();
      const [rows] = await pool.execute<DbRow[]>("SELECT * FROM profiles WHERE user_id = ? LIMIT 1", [userId]);
      return rows[0] ? toProfile(rows[0]) : null;
    },
    async updateProfile(userId, patch, now) {
      const allowed: Array<[keyof typeof patch, string]> = [
        ["username", "username"], ["avatarUrl", "avatar_url"], ["bio", "bio"],
      ];
      const entries = allowed.filter(([key]) => patch[key] !== undefined);
      if (entries.length) {
        const pool = await getMySqlPool();
        await pool.execute(
          `UPDATE profiles SET ${entries.map(([, column]) => `${column} = ?`).join(", ")}, updated_at = ? WHERE user_id = ?`,
          [...entries.map(([key]) => String(patch[key] ?? "")), now, userId],
        );
      }
      return this.getProfile(userId);
    },
  };

  const wallets: Repositories["wallets"] = {
    async createWallet({ userId, initialBalance, now }) {
      return withTransaction(async (connection) => {
        await connection.execute(
          `INSERT INTO wallets
           (user_id, available_balance, pending_claim, initial_balance, total_staked, total_claimed, net_profit, version, created_at, updated_at)
           VALUES (?, ?, 0.00, ?, 0.00, 0.00, 0.00, 1, ?, ?)
           ON DUPLICATE KEY UPDATE user_id = user_id`,
          [userId, initialBalance.toFixed(2), initialBalance.toFixed(2), now, now],
        );
        const wallet = await walletForUpdate(connection, userId);
        await connection.execute(
          `INSERT IGNORE INTO wallet_ledger
           (ledger_id, user_id, type, amount, balance_after, created_at)
           VALUES (?, ?, 'INITIAL_BALANCE', ?, ?, ?)`,
          [ledgerId("initial", userId), userId, initialBalance.toFixed(2), wallet.availableBalance.toFixed(2), now],
        );
        return wallet;
      });
    },
    async getWallet(userId) {
      const pool = await getMySqlPool();
      const [rows] = await pool.execute<DbRow[]>("SELECT * FROM wallets WHERE user_id = ? LIMIT 1", [userId]);
      return rows[0] ? toWallet(rows[0]) : null;
    },
    async debit(userId, { orderId, roundId, stake, now }) {
      return withTransaction(async (connection) => {
        const wallet = await walletForUpdate(connection, userId);
        if (wallet.availableBalance + 1e-9 < stake) throw new Error("insufficient balance");
        const available = money(wallet.availableBalance - stake);
        await connection.execute(
          `UPDATE wallets SET available_balance = ?, total_staked = total_staked + ?,
           updated_at = ?, version = version + 1 WHERE user_id = ?`,
          [available.toFixed(2), stake.toFixed(2), now, userId],
        );
        await connection.execute(
          `INSERT IGNORE INTO wallet_ledger
           (ledger_id, user_id, type, amount, balance_after, round_id, order_id, created_at)
           VALUES (?, ?, 'BET', ?, ?, ?, ?, ?)`,
          [ledgerId("bet", orderId), userId, (-stake).toFixed(2), available.toFixed(2), roundId, orderId, now],
        );
        return { ...wallet, availableBalance: available, totalStaked: money(wallet.totalStaked + stake), updatedAt: now, version: wallet.version + 1 };
      });
    },
    async claimCredit(userId, input) {
      await claimAtomic(userId, input.settlementId, input.now);
      const wallet = await this.getWallet(userId);
      if (!wallet) throw new Error("wallet not found");
      return wallet;
    },
    async addPendingClaim(userId, amount, now) {
      const pool = await getMySqlPool();
      await pool.execute(
        "UPDATE wallets SET pending_claim = pending_claim + ?, updated_at = ?, version = version + 1 WHERE user_id = ?",
        [amount.toFixed(2), now, userId],
      );
      const wallet = await this.getWallet(userId);
      if (!wallet) throw new Error("wallet not found");
      return wallet;
    },
  };

  const orders: Repositories["orders"] = {
    async createOrder(order) {
      const pool = await getMySqlPool();
      await pool.execute(`${INSERT_ORDER} ON DUPLICATE KEY UPDATE order_id = order_id`, orderValues(order));
      await pool.execute(
        `UPDATE orders SET status = ?, payout = ?, profit = ?, settlement_id = ?
         WHERE order_id = ? AND user_id = ?`,
        [order.status, order.payout.toFixed(2), order.profit.toFixed(2),
          order.settlementId ?? null, order.orderId, order.userId],
      );
    },
    async listByUser(userId, limit = 50) {
      const pool = await getMySqlPool();
      const safeLimit = Math.max(1, Math.min(1000, Math.trunc(limit)));
      const [rows] = await pool.query<DbRow[]>(
        `SELECT * FROM orders WHERE user_id = ? ORDER BY placed_at DESC LIMIT ${safeLimit}`,
        [userId],
      );
      return rows.map(toOrder);
    },
  };

  const rounds: Repositories["rounds"] = {
    async createRound(round) {
      const pool = await getMySqlPool();
      await pool.execute(
        `INSERT INTO rounds
         (round_id, symbol, start_time, end_time, open_price, close_price, result, status, settled_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE close_price = VALUES(close_price), result = VALUES(result),
         status = VALUES(status), settled_at = VALUES(settled_at)`,
        [round.roundId, round.symbol, round.startTime, round.endTime, round.openPrice.toFixed(8),
          round.closePrice == null ? null : round.closePrice.toFixed(8), round.result, round.status,
          round.settledAt, round.createdAt],
      );
    },
  };

  const settlements: Repositories["settlements"] = {
    async createSettlement(settlement) {
      const pool = await getMySqlPool();
      await pool.execute<ResultSetHeader>(INSERT_SETTLEMENT_IF_NEW, settlementValues(settlement));
    },
    async getSettlement(settlementId) {
      const pool = await getMySqlPool();
      const [rows] = await pool.execute<DbRow[]>("SELECT * FROM settlements WHERE settlement_id = ? LIMIT 1", [settlementId]);
      return rows[0] ? toSettlement(rows[0]) : null;
    },
    async listPending(userId) {
      const pool = await getMySqlPool();
      const [rows] = await pool.execute<DbRow[]>(
        "SELECT * FROM settlements WHERE user_id = ? AND claim_status = 'pending' ORDER BY settled_at ASC",
        [userId],
      );
      return rows.map(toSettlement);
    },
  };

  const leaderboard: Repositories["leaderboard"] = {
    async upsertStats(stats) {
      const pool = await getMySqlPool();
      await pool.execute(
        `INSERT INTO leaderboard_stats
         (user_id, total_orders, total_rounds, total_staked, total_payout, net_profit,
          roi, wins, losses, win_rate, current_balance, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE total_orders = VALUES(total_orders), total_rounds = VALUES(total_rounds),
         total_staked = VALUES(total_staked), total_payout = VALUES(total_payout), net_profit = VALUES(net_profit),
         roi = VALUES(roi), wins = VALUES(wins), losses = VALUES(losses), win_rate = VALUES(win_rate),
         current_balance = VALUES(current_balance), updated_at = VALUES(updated_at)`,
        [stats.userId, stats.totalOrders, stats.totalRounds, stats.totalStaked.toFixed(2),
          stats.totalPayout.toFixed(2), stats.netProfit.toFixed(2), stats.roi.toFixed(8), stats.wins,
          stats.losses, stats.winRate.toFixed(8), stats.currentBalance.toFixed(2), stats.updatedAt],
      );
    },
    async listTop(sortBy, limit, minOrders = 0) {
      const pool = await getMySqlPool();
      const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
      const column = SORT_COLUMN[sortBy];
      const [rows] = await pool.query<DbRow[]>(
        `SELECT * FROM leaderboard_stats WHERE total_orders >= ? ORDER BY ${column} DESC, user_id ASC LIMIT ${safeLimit}`,
        [Math.max(0, Math.trunc(minOrders))],
      );
      return rows.map(toStats);
    },
    async getStats(userId) {
      const pool = await getMySqlPool();
      const [rows] = await pool.execute<DbRow[]>("SELECT * FROM leaderboard_stats WHERE user_id = ? LIMIT 1", [userId]);
      return rows[0] ? toStats(rows[0]) : null;
    },
    async getRank(userId, sortBy) {
      const self = await this.getStats(userId);
      if (!self) return -1;
      const minOrders = sortBy === "winRate" ? 20 : 0;
      if (self.totalOrders < minOrders) return -1;
      const pool = await getMySqlPool();
      const column = SORT_COLUMN[sortBy];
      const [rows] = await pool.query<DbRow[]>(
        `SELECT COUNT(*) AS higher FROM leaderboard_stats
         WHERE total_orders >= ? AND (${column} > ? OR (${column} = ? AND user_id < ?))`,
        [minOrders, self[sortBy], self[sortBy], userId],
      );
      return numeric(rows[0]?.higher) + 1;
    },
  };

  async function claimAtomic(userId: string, settlementId: string, now: number) {
    return withTransaction(async (connection) => {
      const wallet = await walletForUpdate(connection, userId);
      const [rows] = await connection.execute<DbRow[]>(
        "SELECT * FROM settlements WHERE settlement_id = ? FOR UPDATE",
        [settlementId],
      );
      const settlement = rows[0] ? toSettlement(rows[0]) : null;
      if (!settlement) throw new Error("settlement not found");
      if (settlement.userId !== userId) throw new Error("无权领取该结算");
      if (settlement.claimStatus === "claimed") return { alreadyClaimed: true, amount: 0 };
      const amount = settlement.payout;
      const available = money(wallet.availableBalance + amount);
      await connection.execute(
        "UPDATE settlements SET claim_status = 'claimed', claimed_at = ? WHERE settlement_id = ? AND claim_status = 'pending'",
        [now, settlementId],
      );
      const [pendingRows] = await connection.execute<DbRow[]>(
        "SELECT payout FROM settlements WHERE user_id = ? AND claim_status = 'pending' FOR UPDATE",
        [userId],
      );
      const pending = money(pendingRows.reduce((sum, row) => sum + numeric(row.payout), 0));
      await connection.execute(
        `UPDATE wallets SET available_balance = ?, pending_claim = ?, total_claimed = total_claimed + ?,
         updated_at = ?, version = version + 1 WHERE user_id = ?`,
        [available.toFixed(2), pending.toFixed(2), amount.toFixed(2), now, userId],
      );
      await connection.execute(
        `INSERT IGNORE INTO wallet_ledger
         (ledger_id, user_id, type, amount, balance_after, settlement_id, created_at)
         VALUES (?, ?, 'CLAIM', ?, ?, ?, ?)`,
        [ledgerId("claim", settlementId), userId, amount.toFixed(2), available.toFixed(2), settlementId, now],
      );
      return { alreadyClaimed: false, amount };
    });
  }

  async function placeOrderAtomic(userId: string, order: OrderRecord, now: number) {
    return withTransaction(async (connection) => {
      const wallet = await walletForUpdate(connection, userId);
      const [existing] = await connection.execute<DbRow[]>(
        "SELECT order_id FROM orders WHERE user_id = ? AND idempotency_key = ? FOR UPDATE",
        [userId, order.idempotencyKey],
      );
      if (existing.length) return { wallet, alreadyExisted: true };
      if (wallet.availableBalance + 1e-9 < order.stake) throw new Error("insufficient balance");
      const available = money(wallet.availableBalance - order.stake);
      await connection.execute(INSERT_ORDER, orderValues(order));
      await connection.execute(
        `UPDATE wallets SET available_balance = ?, total_staked = total_staked + ?,
         updated_at = ?, version = version + 1 WHERE user_id = ?`,
        [available.toFixed(2), order.stake.toFixed(2), now, userId],
      );
      await connection.execute(
        `INSERT INTO wallet_ledger
         (ledger_id, user_id, type, amount, balance_after, round_id, order_id, created_at)
         VALUES (?, ?, 'BET', ?, ?, ?, ?, ?)`,
        [ledgerId("bet", order.orderId), userId, (-order.stake).toFixed(2), available.toFixed(2),
          order.roundId, order.orderId, now],
      );
      return {
        wallet: { ...wallet, availableBalance: available, totalStaked: money(wallet.totalStaked + order.stake), updatedAt: now, version: wallet.version + 1 },
        alreadyExisted: false,
      };
    });
  }

  async function claimAllAtomic(userId: string, now: number) {
    return withTransaction(async (connection) => {
      const wallet = await walletForUpdate(connection, userId);
      const [rows] = await connection.execute<DbRow[]>(
        "SELECT * FROM settlements WHERE user_id = ? AND claim_status = 'pending' ORDER BY settled_at FOR UPDATE",
        [userId],
      );
      const settlementsToClaim = rows.map(toSettlement);
      if (!settlementsToClaim.length) return { amount: 0, count: 0 };
      const amount = money(settlementsToClaim.reduce((sum, row) => sum + row.payout, 0));
      const available = money(wallet.availableBalance + amount);
      await connection.execute(
        "UPDATE settlements SET claim_status = 'claimed', claimed_at = ? WHERE user_id = ? AND claim_status = 'pending'",
        [now, userId],
      );
      await connection.execute(
        `UPDATE wallets SET available_balance = ?, pending_claim = 0.00, total_claimed = total_claimed + ?,
         updated_at = ?, version = version + 1 WHERE user_id = ?`,
        [available.toFixed(2), amount.toFixed(2), now, userId],
      );
      for (const settlement of settlementsToClaim) {
        await connection.execute(
          `INSERT IGNORE INTO wallet_ledger
           (ledger_id, user_id, type, amount, balance_after, settlement_id, created_at)
           VALUES (?, ?, 'CLAIM', ?, ?, ?, ?)`,
          [ledgerId("claim", settlement.settlementId), userId, settlement.payout.toFixed(2),
            available.toFixed(2), settlement.settlementId, now],
        );
      }
      return { amount, count: settlementsToClaim.length };
    });
  }

  async function pendingClaimConsistency(userId: string) {
    const pool = await getMySqlPool();
    const [rows] = await pool.execute<DbRow[]>(
      `SELECT w.pending_claim AS cached,
       COALESCE(SUM(CASE WHEN s.claim_status = 'pending' THEN s.payout ELSE 0 END), 0.00) AS expected
       FROM wallets w LEFT JOIN settlements s ON s.user_id = w.user_id
       WHERE w.user_id = ? GROUP BY w.user_id, w.pending_claim`,
      [userId],
    );
    if (!rows[0]) throw new Error("wallet not found");
    const cached = money(numeric(rows[0].cached));
    const expected = money(numeric(rows[0].expected));
    return { cached, expected, consistent: cached === expected };
  }

  async function rebuildPendingClaim(userId: string, now: number) {
    return withTransaction(async (connection) => {
      const wallet = await walletForUpdate(connection, userId);
      const [rows] = await connection.execute<DbRow[]>(
        "SELECT payout FROM settlements WHERE user_id = ? AND claim_status = 'pending' FOR UPDATE",
        [userId],
      );
      const expected = money(rows.reduce((sum, row) => sum + numeric(row.payout), 0));
      await connection.execute(
        "UPDATE wallets SET pending_claim = ?, updated_at = ?, version = version + 1 WHERE user_id = ?",
        [expected.toFixed(2), now, userId],
      );
      return { ...wallet, pendingClaim: expected, updatedAt: now, version: wallet.version + 1 };
    });
  }

  async function recordSettlementAtomic(settlement: SettlementRecord, now: number) {
    return withTransaction(async (connection) => {
      const wallet = await walletForUpdate(connection, settlement.userId);
      const [result] = await connection.execute<ResultSetHeader>(
        INSERT_SETTLEMENT_IF_NEW,
        settlementValues(settlement),
      );
      if (result.affectedRows === 0 || settlement.claimStatus !== "pending" || settlement.payout <= 0) {
        return { created: result.affectedRows === 1, wallet };
      }
      const [pendingRows] = await connection.execute<DbRow[]>(
        "SELECT payout FROM settlements WHERE user_id = ? AND claim_status = 'pending' FOR UPDATE",
        [settlement.userId],
      );
      const pendingClaim = money(pendingRows.reduce((sum, row) => sum + numeric(row.payout), 0));
      await connection.execute(
        "UPDATE wallets SET pending_claim = ?, updated_at = ?, version = version + 1 WHERE user_id = ?",
        [pendingClaim.toFixed(2), now, settlement.userId],
      );
      return {
        created: true,
        wallet: { ...wallet, pendingClaim, updatedAt: now, version: wallet.version + 1 },
      };
    });
  }

  return {
    users,
    profiles,
    wallets,
    orders,
    rounds,
    settlements,
    leaderboard,
    claim: claimAtomic,
    placeOrder: placeOrderAtomic,
    claimAll: claimAllAtomic,
    pendingClaimConsistency,
    rebuildPendingClaim,
    recordSettlement: recordSettlementAtomic,
  };
}
