/** Pure numeric helpers shared by the odds engines. */

/** Abramowitz & Stegun 7.1.26 erf approximation, |error| < 1.5e-7. */
export function erf(x: number): number {
  if (x === 0) return 0;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/** Standard normal cumulative distribution function. */
export function normalCdf(z: number): number {
  if (z === 0) return 0.5;
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

export function sigmoid(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
  if (x >= 0) {
    const e = Math.exp(-x);
    return 1 / (1 + e);
  }
  const e = Math.exp(x);
  return e / (1 + e);
}

export function logit(p: number): number {
  const q = clampProbability(p);
  return Math.log(q / (1 - q));
}

/** Numerical safety guard only — this is NOT a model probability clamp. */
export function clampProbability(p: number): number {
  if (!Number.isFinite(p)) return 0.5;
  const eps = 1e-9;
  if (p <= eps) return eps;
  if (p >= 1 - eps) return 1 - eps;
  return p;
}

/** EWMA decay factor for a given half-life expressed in sample periods. */
export function ewmaLambda(halfLifePeriods: number): number {
  return Math.pow(0.5, 1 / Math.max(1, halfLifePeriods));
}

export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

export function round6(x: number): number {
  return Math.round((x + Number.EPSILON) * 1e6) / 1e6;
}
