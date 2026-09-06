import { normalCdf } from "./stats";

export interface FairProbInput {
  /** S0 = official round open. */
  openPrice: number;
  /** St = current BTC mid price. */
  midPrice: number;
  /** Seconds remaining in the round. */
  tauSeconds: number;
  /** Per-second log-return sigma. */
  sigmaPerSecond: number;
}

export interface FairProbOutput {
  x: number;
  z: number;
  tau: number;
  pFairUp: number;
  pFairDown: number;
}

/**
 * FairProbabilityEngine (req 13-14).
 *
 *   x   = ln(St / S0)
 *   z   = x / (sigma * sqrt(tau))
 *   pUp = NormalCDF(z),  pDown = 1 - pUp   (always sums to exactly 1)
 *
 * Time enters ONLY through sqrt(tau) — there are no artificial time multipliers.
 * There is NO probability clamp anywhere in the model.
 */
export function computeFairProbability(input: FairProbInput): FairProbOutput {
  const { openPrice, midPrice, sigmaPerSecond } = input;
  const tau = Math.max(0, input.tauSeconds);

  if (!(openPrice > 0) || !(midPrice > 0) || !Number.isFinite(sigmaPerSecond) || sigmaPerSecond <= 0) {
    return { x: 0, z: 0, tau, pFairUp: 0.5, pFairDown: 0.5 };
  }

  const x = Math.log(midPrice / openPrice);

  // At/after expiry the sign of x is deterministic.
  if (tau <= 0) {
    const pUp = x > 0 ? 1 : x < 0 ? 0 : 0.5;
    return { x, z: x > 0 ? Infinity : x < 0 ? -Infinity : 0, tau, pFairUp: pUp, pFairDown: 1 - pUp };
  }

  const denom = sigmaPerSecond * Math.sqrt(tau);
  const z = x / denom;
  const pFairUp = normalCdf(z);
  return { x, z, tau, pFairUp, pFairDown: 1 - pFairUp };
}
