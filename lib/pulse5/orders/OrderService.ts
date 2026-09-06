import { GAME_CONFIG } from "../game/gameConfig";
import { EngineError, ErrorCode, type ErrorCodeType } from "../engine/errors";
import type { Order, Quote } from "../engine/types";
import type { LedgerStore } from "./LedgerStore";

export interface BettingGate {
  canBet: boolean;
  reason?: ErrorCodeType;
}

export interface PlaceOrderInput {
  ledger: LedgerStore;
  /**
   * Freshly built executable quote at order time (latest market). Orders are
   * placed by amount and always filled against the market at the click moment,
   * never against an expired prior quote.
   */
  quote: Quote;
  idempotencyKey: string;
  currentRoundId: number;
  now: number;
  gate: BettingGate;
}

let orderCounter = 0;
function newOrderId(now: number): string {
  orderCounter += 1;
  return `o_${now.toString(36)}_${orderCounter.toString(36)}`;
}

/**
 * OrderService — atomic order creation (req 33, 59).
 * The executable quote is computed from the latest market at order time; all
 * validation happens before a single balance/order mutation ("transaction"),
 * and idempotency keys prevent double spend.
 */
export class OrderService {
  private lastOrderAt = -Infinity;

  placeOrder(input: PlaceOrderInput): Order {
    const { ledger, quote, now, currentRoundId, gate, idempotencyKey } = input;

    // 1) Market / round gate is computed authoritatively at order time.
    if (!gate.canBet) {
      throw new EngineError(gate.reason ?? ErrorCode.NO_ROUND_OPEN);
    }
    if (quote.roundId !== currentRoundId) {
      throw new EngineError(ErrorCode.NO_ROUND_OPEN);
    }

    // 2) Defensive rate limit (anti double-click / request flood).
    if (now - this.lastOrderAt < GAME_CONFIG.ORDER_RATE_LIMIT_MS) {
      throw new EngineError(ErrorCode.RATE_LIMITED);
    }

    // 3) Idempotency: same key in same round returns the original order.
    const existing = ledger.findIdempotent(currentRoundId, idempotencyKey);
    if (existing) return existing;

    // 4) Balance check (hedge never releases earlier margin).
    if (ledger.balance + 1e-9 < quote.stake) {
      throw new EngineError(ErrorCode.INSUFFICIENT_BALANCE, {
        available: ledger.balance,
        required: quote.stake,
      });
    }

    // 5) Atomic commit: debit, create the pending order at LATEST execution odds.
    const order: Order = {
      id: newOrderId(now),
      userId: GAME_CONFIG.USER_ID,
      roundId: currentRoundId,
      side: quote.side,
      stake: quote.stake,
      lockedOdds: quote.averageExecutionOdds,
      potentialPayout: quote.potentialPayout,
      priceAtEntry: quote.spotPrice,
      pFairUpAtEntry: quote.pFairUp,
      pMarketUpAtEntry: quote.pMarketUp,
      volatilityAtEntry: quote.volatilityAtEntry,
      inventoryAtEntry: quote.inventoryAtEntry,
      priceImpactPercent: quote.priceImpactPercent,
      quoteId: quote.quoteId,
      idempotencyKey,
      status: "OPEN",
      payout: 0,
      profit: 0,
      claimed: false,
      createdAt: now,
      settledAt: null,
    };

    ledger.debit(order.stake);
    ledger.addOrder(order);
    ledger.persist();

    this.lastOrderAt = now;
    return order;
  }

  resetRateLimit(): void {
    this.lastOrderAt = -Infinity;
  }
}
