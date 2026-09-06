import { GAME_CONFIG } from "../game/gameConfig";
import type { LedgerSnapshot, Order, RoundRecord } from "../engine/types";

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
export class LedgerStore {
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
    this.orders = Array.isArray(initial.orders) ? initial.orders : [];
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

  reset(): void {
    const fresh = emptySnapshot();
    this.balance = fresh.balance;
    this.orders = fresh.orders;
    this.rounds = new Map();
    this.idempotency = new Map();
    this.settledRounds = new Set();
    this.persist();
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
