/**
 * GameStateStore — the authoritative game-state contract (balance, orders,
 * rounds, settlement/claim). The engine and order/settlement services depend on
 * this interface, not on a concrete store, so the authoritative state can live
 * in the browser today and in an offshore backend (SQLite / Redis / Durable
 * Object) tomorrow without touching game logic.
 *
 * Implementations:
 *  - LedgerStore            → browser (inject a localStorage persister)
 *  - new LedgerStore(null)  → pure in-memory (dev / server-side tests)
 */
import type { LedgerSnapshot, Order, RoundRecord } from "../engine/types";

export interface GameStateStore {
  balance: number;
  orders: Order[];
  rounds: Map<string, RoundRecord>;

  openOrdersForRound(roundId: number): Order[];
  allOpenOrders(): Order[];
  findIdempotent(roundId: number, idempotencyKey: string): Order | undefined;
  debit(amount: number): void;
  credit(amount: number): void;
  addOrder(order: Order): void;
  upsertRound(round: RoundRecord): void;
  getRound(roundId: number): RoundRecord | undefined;
  isSettled(roundId: number): boolean;
  markSettled(roundId: number): void;
  claimableOf(order: Order): number;
  claimableBalance(): number;
  claimOrder(orderId: string): number;
  claimAll(): number;
  reset(): void;
  snapshot(): LedgerSnapshot;
  persist(): void;
}

/** Factory boundary for SQLite/Redis/other durable server implementations. */
export interface GameStateStoreFactory {
  readonly durable: boolean;
  forUser(userId: string): GameStateStore;
}
