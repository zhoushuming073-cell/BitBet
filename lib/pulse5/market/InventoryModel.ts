import { GAME_CONFIG } from "../game/gameConfig";
import type { Order, Side } from "../engine/types";
import { clampProbability, logit, sigmoid } from "./stats";

/** Dealer payout liability for still-open orders (req 23). */
export function computeLiabilities(openOrders: Order[]): { up: number; down: number } {
  let up = 0;
  let down = 0;
  for (const order of openOrders) {
    if (order.status !== "OPEN") continue;
    const payout = order.stake * order.lockedOdds;
    if (order.side === "up") up += payout;
    else down += payout;
  }
  return { up, down };
}

/**
 * inventory = (LUp - LDown) / BASE_VIRTUAL_LIQUIDITY
 * > 0 means the dealer is short UP and should lower UP odds / raise DOWN odds.
 */
export function computeInventory(liabilityUp: number, liabilityDown: number): number {
  return (liabilityUp - liabilityDown) / GAME_CONFIG.BASE_VIRTUAL_LIQUIDITY;
}

export interface MarketProbability {
  pMarketUp: number;
  pMarketDown: number;
  skewLogit: number;
}

/**
 * Stable Logit inventory skew (req 25). No linear `p += inventory * k`.
 *   logit' = ln(p/(1-p)) + K * inventory ;  pMarket = sigmoid(logit')
 */
export function applyInventorySkew(pFairUp: number, inventory: number): MarketProbability {
  const base = clampProbability(pFairUp);
  const fairLogit = logit(base);
  const skewLogit = GAME_CONFIG.INVENTORY_SKEW_K * inventory;
  const marketLogit = fairLogit + skewLogit;
  const pMarketUp = clampProbability(sigmoid(marketLogit));
  return { pMarketUp, pMarketDown: 1 - pMarketUp, skewLogit };
}

/** Synthetic displayed market depth (req 22) — explicitly simulated, not users. */
export function syntheticLiquidity(pFairUp: number): { up: number; down: number } {
  const base = GAME_CONFIG.BASE_VIRTUAL_LIQUIDITY;
  return { up: pFairUp * base, down: (1 - pFairUp) * base };
}

export function liabilityOfSide(liability: { up: number; down: number }, side: Side): number {
  return side === "up" ? liability.up : liability.down;
}
