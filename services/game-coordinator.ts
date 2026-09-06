/**
 * GameCoordinator — pure business orchestration between engine events and the
 * account persistence layer. It contains no React and no rendering; the UI only
 * forwards engine events here.
 *
 * This is the seam for the future offshore authoritative backend: swap the
 * engine (and its settle/claim flow) and the sync targets without touching UI.
 * The coordinator just answers "given this user, mirror the outcome".
 */
import type { Order as EngineOrder, RoundRecord as EngineRound } from "@/lib/pulse5/engine/types";
import { syncBet, syncClaim, syncSettlement } from "./settlement-sync-service";

export class GameCoordinator {
  private userId: string | null = null;
  private readonly syncedRounds = new Set<number>();

  setUserId(userId: string | null): void {
    this.userId = userId;
  }

  /** A bet was placed on the engine; mirror it into the account ledger. */
  onOrderPlaced(order: EngineOrder): void {
    if (!this.userId) return;
    void syncBet(this.userId, order);
  }

  /** A round settled on the engine; persist rounds/orders/settlements + pendingClaim. */
  onRoundSettled(round: EngineRound, orders: EngineOrder[]): void {
    if (!this.userId) return;
    if (this.syncedRounds.has(round.id)) return;
    this.syncedRounds.add(round.id);
    void syncSettlement(this.userId, round, orders);
  }

  /** A single order was claimed on the engine; mirror it into the account wallet. */
  onClaim(order: EngineOrder): void {
    if (!this.userId) return;
    void syncClaim(this.userId, order);
  }

  /** Multiple orders were claimed at once. */
  onClaimAll(orders: EngineOrder[]): void {
    if (!this.userId) return;
    for (const order of orders) void syncClaim(this.userId, order);
  }
}
