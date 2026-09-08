import { GAME_CONFIG } from "../game/gameConfig";
import type { LedgerSnapshot, Order, RoundRecord } from "../engine/types";
import type { GameStateStore } from "./GameStateStore";

export interface LedgerPersister {
  load(): LedgerSnapshot | null;
  save(snapshot: LedgerSnapshot): void;
}

const SNAPSHOT_VERSION = 2;

export function emptySnapshot(): LedgerSnapshot {
  return {
    balance: GAME_CONFIG.INITIAL_BALANCE,
    orders: [],
    rounds: {},
    idempotency: {},
    settledRounds: [],
    version: SNAPSHOT_VERSION,
  };
}

/**
 * LedgerStore — the single authoritative account ledger. Balances, orders and
 * rounds live here; persistence is injected so the same code runs in the
 * browser (localStorage) and under unit tests (in-memory).
 */
export class LedgerStore implements GameStateStore {
  balance: number;
  orders: Order[];
  rounds: Map<string, RoundRecord>;
  idempotency: Map<string, string>;
  settledRounds: Set<string>;
  private persister: LedgerPersister | null;

  constructor(persister: LedgerPersister | null = null, snapshot?: LedgerSnapshot | null) {
    this.persister = persister;
    const initial = snapshot ?? persister?.load() ?? emptySnapshot();
    this.balance = sanitizeMoney(initial.balance, GAME_CONFIG.INITIAL_BALANCE);
    // Migration: orders persisted before the claim feature were credited to the
    // balance at settlement time, so they default to `claimed: true`.
    this.orders = (Array.isArray(initial.orders) ? initial.orders : []).map((o) => ({
      ...o,
      claimed: typeof o.claimed === "boolean" ? o.claimed : o.status !== "OPEN",
    }));
    this.rounds = new Map(Object.entries(initial.rounds ?? {}));
    this.idempotency = new Map(Object.entries(initial.idempotency ?? {}));
    this.settledRounds = new Set(initial.settledRounds ?? []);
  }

  openOrdersForRound(roundId: number): Order[] {
    return this.orders.filter((o) => o.roundId === roundId && o.status === "OPEN");
  }

  /** Open orders across all rounds (used by recovery/settlement). */
  allOpenOrders(): Order[] {
    return this.orders.filter((o) => o.status === "OPEN");
  }

  findIdempotent(roundId: number, idempotencyKey: string): Order | undefined {
    if (!idempotencyKey) return undefined;
    const orderId = this.idempotency.get(`${roundId}:${idempotencyKey}`);
    return orderId ? this.orders.find((o) => o.id === orderId) : undefined;
  }

  debit(amount: number): void {
    this.balance = money(this.balance - amount);
  }

  credit(amount: number): void {
    this.balance = money(this.balance + amount);
  }

  addOrder(order: Order): void {
    this.orders.unshift(order);
    if (order.idempotencyKey) {
      this.idempotency.set(`${order.roundId}:${order.idempotencyKey}`, order.id);
    }
  }

  upsertRound(round: RoundRecord): void {
    this.rounds.set(String(round.id), round);
  }

  getRound(roundId: number): RoundRecord | undefined {
    return this.rounds.get(String(roundId));
  }

  isSettled(roundId: number): boolean {
    return this.settledRounds.has(String(roundId));
  }

  markSettled(roundId: number): void {
    this.settledRounds.add(String(roundId));
  }

  /**
   * Claimable amount for one settled order: the WON payout or the VOID refund.
   * LOST orders (and anything already claimed) return 0.
   */
  claimableOf(order: Order): number {
    if (order.claimed || order.status === "OPEN") return 0;
    if (order.status === "WON") return money(order.payout);
    if (order.status === "VOID") return money(order.stake);
    return 0;
  }

  /** Total unclaimed winnings/refunds across all settled orders. */
  claimableBalance(): number {
    return money(this.orders.reduce((sum, order) => sum + this.claimableOf(order), 0));
  }

  /** Claim a single order; returns the amount credited (0 if nothing to claim). */
  claimOrder(orderId: string): number {
    const order = this.orders.find((o) => o.id === orderId);
    if (!order) return 0;
    const amount = this.claimableOf(order);
    if (amount <= 0) return 0;
    order.claimed = true;
    this.credit(amount);
    this.persist();
    return amount;
  }

  /** Claim everything outstanding; returns the total credited. */
  claimAll(): number {
    let total = 0;
    for (const order of this.orders) {
      const amount = this.claimableOf(order);
      if (amount <= 0) continue;
      order.claimed = true;
      total = money(total + amount);
    }
    if (total > 0) {
      this.credit(total);
      this.persist();
    }
    return total;
  }

  reset(): void {
    const fresh = emptySnapshot();
    this.balance = fresh.balance;
    this.orders = fresh.orders;
    this.rounds = new Map();
    this.idempotency = new Map();
    this.settledRounds = new Set();
    this.persist();
  }

  /** Replace local state with a server-authoritative ledger snapshot. */
  restore(snapshot: LedgerSnapshot): void {
    this.balance = sanitizeMoney(snapshot.balance, GAME_CONFIG.INITIAL_BALANCE);
    this.orders = (Array.isArray(snapshot.orders) ? snapshot.orders : []).map((order) => ({
      ...order,
      claimed: typeof order.claimed === "boolean" ? order.claimed : order.status !== "OPEN",
    }));
    this.rounds = new Map(Object.entries(snapshot.rounds ?? {}));
    this.idempotency = new Map(Object.entries(snapshot.idempotency ?? {}));
    this.settledRounds = new Set(snapshot.settledRounds ?? []);
  }

  snapshot(): LedgerSnapshot {
    return {
      balance: this.balance,
      orders: this.orders,
      rounds: Object.fromEntries(this.rounds.entries()),
      idempotency: Object.fromEntries(this.idempotency.entries()),
      settledRounds: [...this.settledRounds],
      version: SNAPSHOT_VERSION,
    };
  }

  persist(): void {
    try {
      this.persister?.save(this.snapshot());
    } catch {
      // Persistence must never crash the transaction; ledger state still holds.
    }
  }
}

export function money(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sanitizeMoney(value: number, fallback: number): number {
  return Number.isFinite(value) && value >= 0 ? money(value) : fallback;
}
