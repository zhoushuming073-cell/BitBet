import { GAME_CONFIG } from "../game/gameConfig";
import type { Side } from "../engine/types";
import { applyInventorySkew } from "./InventoryModel";

export interface ImpactInput {
  side: Side;
  stake: number;
  /** Fair up probability held constant across this quote. */
  pFairUp: number;
  /** Current dealer liabilities before this order. */
  liabilityUp: number;
  liabilityDown: number;
  slices?: number;
}

export interface ImpactResult {
  /** Odds for an infinitesimal order at the current inventory. */
  baseOdds: number;
  /** Stake-weighted average executed odds after walking the book. */
  averageOdds: number;
  /** Negative number, e.g. -0.026 = -2.6%. */
  priceImpactPercent: number;
  potentialPayout: number;
  endingLiabilityUp: number;
  endingLiabilityDown: number;
  /** Market up-probability at the base inventory (for display/debug). */
  pMarketUpBase: number;
}

function oddsForSide(pFairUp: number, liabilityUp: number, liabilityDown: number, side: Side): { odds: number; pMarketUp: number } {
  const { pMarketUp, pMarketDown } = applyInventorySkew(
    pFairUp,
    (liabilityUp - liabilityDown) / GAME_CONFIG.BASE_VIRTUAL_LIQUIDITY,
  );
  const pSide = side === "up" ? pMarketUp : pMarketDown;
  return { odds: (1 - GAME_CONFIG.HOUSE_TAKEOUT) / pSide, pMarketUp };
}

/**
 * PriceImpactModel (req 28-30).
 * Continuous virtual-pool walk: the order is split into N slices; every slice
 * is filled at odds recomputed from the *simulated* dealer inventory after the
 * preceding slices, then we return the stake-weighted average execution odds.
 * Deterministic numerical integration — no per-size hard-coding.
 */
export function computePriceImpact(input: ImpactInput): ImpactResult {
  const { side, stake, pFairUp } = input;
  const slices = input.slices ?? GAME_CONFIG.PRICE_IMPACT_SLICES;
  let simUp = input.liabilityUp;
  let simDown = input.liabilityDown;

  const base = oddsForSide(pFairUp, simUp, simDown, side);
  const baseOdds = base.odds;

  if (!(stake > 0) || !Number.isFinite(stake)) {
    return {
      baseOdds,
      averageOdds: baseOdds,
      priceImpactPercent: 0,
      potentialPayout: 0,
      endingLiabilityUp: simUp,
      endingLiabilityDown: simDown,
      pMarketUpBase: base.pMarketUp,
    };
  }

  const sliceStake = stake / slices;
  let totalPayout = 0;
  for (let i = 0; i < slices; i += 1) {
    const { odds } = oddsForSide(pFairUp, simUp, simDown, side);
    totalPayout += sliceStake * odds;
    if (side === "up") simUp += sliceStake * odds;
    else simDown += sliceStake * odds;
  }

  const averageOdds = totalPayout / stake;
  const priceImpactPercent = baseOdds > 0 ? averageOdds / baseOdds - 1 : 0;

  return {
    baseOdds,
    averageOdds,
    priceImpactPercent,
    potentialPayout: totalPayout,
    endingLiabilityUp: simUp,
    endingLiabilityDown: simDown,
    pMarketUpBase: base.pMarketUp,
  };
}
