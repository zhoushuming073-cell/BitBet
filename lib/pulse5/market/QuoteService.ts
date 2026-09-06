import { GAME_CONFIG } from "../game/gameConfig";
import { EngineError, ErrorCode } from "../engine/errors";
import type { ProbabilityBreakdown, Quote, Side } from "../engine/types";
import { executeVirtualBook, isSideQuotable } from "./MarketMaker";

export interface CreateQuoteInput {
  side: Side;
  stake: number;
  roundId: number;
  breakdown: ProbabilityBreakdown;
  spotPrice: number;
  roundOpen: number;
  sigma: number;
  marketTimestamp: number;
  now: number;
}

let quoteCounter = 0;
function newQuoteId(): string {
  quoteCounter += 1;
  return `q_${Date.now().toString(36)}_${quoteCounter.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * QuoteService — builds an executable quote from the market snapshot passed in.
 * Orders are placed by amount and filled at the LATEST market at order time, so
 * there is no stored-quote TTL validation on the order path: a fresh quote is
 * built inside placeOrder() the instant the order arrives. Kept quotes are only
 * bounded in-memory previews.
 */
export class QuoteService {
  private quotes = new Map<string, Quote>();

  createQuote(input: CreateQuoteInput): Quote {
    const { side, stake, breakdown } = input;
    if (!(Number.isFinite(stake) && stake > 0)) {
      throw new EngineError(ErrorCode.INVALID_STAKE);
    }
    if (stake < GAME_CONFIG.MIN_BET) {
      throw new EngineError(ErrorCode.BELOW_MIN_BET, { min: GAME_CONFIG.MIN_BET });
    }
    if (!isSideQuotable(breakdown, side)) {
      throw new EngineError(ErrorCode.MARKET_ONE_SIDED);
    }

    const impact = executeVirtualBook(breakdown, side, stake);
    const potentialPayout = round2(stake * impact.averageOdds);
    const quote: Quote = {
      quoteId: newQuoteId(),
      roundId: input.roundId,
      side,
      stake: round2(stake),
      spotPrice: input.spotPrice,
      roundOpen: input.roundOpen,
      pFairUp: breakdown.pFairUp,
      pMarketUp: breakdown.pMarketUp,
      displayedBaseOdds: impact.baseOdds,
      averageExecutionOdds: impact.averageOdds,
      priceImpactPercent: impact.priceImpactPercent,
      potentialPayout,
      potentialProfit: round2(potentialPayout - stake),
      volatilityAtEntry: input.sigma,
      inventoryAtEntry: breakdown.inventory,
      marketTimestamp: input.marketTimestamp,
      createdAt: input.now,
      // Informational preview TTL only — never used to reject an order.
      expiresAt: input.now + GAME_CONFIG.QUOTE_TTL_MS,
    };
    this.quotes.set(quote.quoteId, quote);
    this.prune(input.now);
    return quote;
  }

  clear(): void {
    this.quotes.clear();
  }

  private prune(now: number): void {
    if (this.quotes.size <= 200) return;
    for (const [id, quote] of this.quotes) {
      if (now > quote.expiresAt + 5_000) this.quotes.delete(id);
    }
  }
}

function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}
