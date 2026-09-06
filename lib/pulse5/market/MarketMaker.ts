import { GAME_CONFIG } from "../game/gameConfig";
import type { Order, ProbabilityBreakdown, Side } from "../engine/types";
import { computeFairProbability } from "./FairProbabilityEngine";
import { applyInventorySkew, computeLiabilities, computeInventory } from "./InventoryModel";
import { computePriceImpact, type ImpactResult } from "./PriceImpactModel";

export interface MarketEvaluationInput {
  openPrice: number;
  midPrice: number;
  tauSeconds: number;
  sigma: number;
  openOrders: Order[];
}

/**
 * MachineMarketMaker (req 20-27).
 * BTC fair probability -> dealer inventory risk -> logit-skewed market
 * probability -> 4% takeout base odds. It is NOT a random bet bot.
 */
export function evaluateMarket(input: MarketEvaluationInput): ProbabilityBreakdown {
  const { openPrice, midPrice, tauSeconds, sigma, openOrders } = input;
  const fair = computeFairProbability({ openPrice, midPrice, tauSeconds, sigmaPerSecond: sigma });
  const liability = computeLiabilities(openOrders);
  const inventory = computeInventory(liability.up, liability.down);
  const skew = applyInventorySkew(fair.pFairUp, inventory);
  const takeout = 1 - GAME_CONFIG.HOUSE_TAKEOUT;

  return {
    z: fair.z,
    x: fair.x,
    tau: fair.tau,
    pFairUp: fair.pFairUp,
    pFairDown: fair.pFairDown,
    liabilityUp: liability.up,
    liabilityDown: liability.down,
    inventory,
    inventorySkewLogit: skew.skewLogit,
    pMarketUp: skew.pMarketUp,
    pMarketDown: skew.pMarketDown,
    baseUpOdds: takeout / skew.pMarketUp,
    baseDownOdds: takeout / skew.pMarketDown,
  };
}

/** Walk the virtual book for a requested side/size (req 28-30). */
export function executeVirtualBook(
  breakdown: ProbabilityBreakdown,
  side: Side,
  stake: number,
): ImpactResult {
  return computePriceImpact({
    side,
    stake,
    pFairUp: breakdown.pFairUp,
    liabilityUp: breakdown.liabilityUp,
    liabilityDown: breakdown.liabilityDown,
  });
}

/**
 * Quotability (req 18-19): the model probability is NEVER clamped. If it leaves
 * the quotable band the side is simply not tradable at that moment.
 */
export function isSideQuotable(breakdown: ProbabilityBreakdown, side: Side): boolean {
  const p = side === "up" ? breakdown.pMarketUp : breakdown.pMarketDown;
  return p >= GAME_CONFIG.MIN_QUOTABLE_PROBABILITY && p <= GAME_CONFIG.MAX_QUOTABLE_PROBABILITY;
}
