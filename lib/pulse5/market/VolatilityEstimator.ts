import { GAME_CONFIG } from "../game/gameConfig";
import { ewmaLambda } from "./stats";

/**
 * VolatilityEstimator
 * -------------------
 * Samples the BTC *mid* price once per second, computes 1s log returns
 * r[t] = ln(P[t] / P[t-1]) and tracks dual-speed EWMA variance:
 *   fast half-life 60s, slow half-life 600s, blended 0.70 fast + 0.30 slow.
 *
 * Includes a safety floor, NaN/Infinity guards, per-second outlier rejection,
 * missing-data protection and a 1m-kline bootstrap for warm-up.
 */
export class VolatilityEstimator {
  private fastVar = 0;
  private slowVar = 0;
  private initialized = false;
  private prevPrice = 0;
  private prevTs = 0;
  private sampleCount = 0;
  private bootstrapped = false;

  private readonly fastLambda = ewmaLambda(GAME_CONFIG.FAST_VOL_HALF_LIFE_SECONDS);
  private readonly slowLambda = ewmaLambda(GAME_CONFIG.SLOW_VOL_HALF_LIFE_SECONDS);

  /** Feed a mid observation. Called ~once per second by the feed manager. */
  sample(price: number, ts: number): void {
    if (!Number.isFinite(price) || price <= 0) return;

    if (this.prevPrice > 0 && this.prevTs > 0) {
      const dtSec = (ts - this.prevTs) / 1000;
      // Missing-data / irregular-gap protection: only accept ~1s cadence.
      if (dtSec >= 0.5 && dtSec <= 2) {
        const r = Math.log(price / this.prevPrice);
        // Outlier protection: reject an impossible 1-second jump.
        if (Number.isFinite(r) && Math.abs(r) <= GAME_CONFIG.MAX_VOLATILITY_PER_SEC) {
          this.ingestReturn(r * r);
        }
      }
    }

    this.prevPrice = price;
    this.prevTs = ts;
  }

  private ingestReturn(rSquared: number): void {
    if (!this.initialized) {
      this.fastVar = rSquared;
      this.slowVar = rSquared;
      this.initialized = true;
    } else {
      this.fastVar = this.fastLambda * this.fastVar + (1 - this.fastLambda) * rSquared;
      this.slowVar = this.slowLambda * this.slowVar + (1 - this.slowLambda) * rSquared;
    }
    this.sampleCount += 1;
  }

  /**
   * Bootstrap from recent 1m kline closes before live samples accumulate.
   * A 60s log return has variance = 60 * per-second variance, so per-second
   * variance ≈ r60^2 / 60.
   */
  seedFromOneMinuteKlines(closes: number[]): void {
    const perSecond: number[] = [];
    for (let i = 1; i < closes.length; i += 1) {
      const prev = closes[i - 1];
      const cur = closes[i];
      if (prev > 0 && cur > 0 && Number.isFinite(prev) && Number.isFinite(cur)) {
        const r60 = Math.log(cur / prev);
        if (Number.isFinite(r60)) perSecond.push((r60 * r60) / 60);
      }
    }
    if (perSecond.length < 2) return;
    const mean = perSecond.reduce((a, b) => a + b, 0) / perSecond.length;
    if (!Number.isFinite(mean) || mean <= 0) return;
    if (!this.initialized) {
      this.fastVar = mean;
      this.slowVar = mean;
      this.initialized = true;
    } else {
      this.fastVar = 0.5 * this.fastVar + 0.5 * mean;
      this.slowVar = 0.5 * this.slowVar + 0.5 * mean;
    }
    this.bootstrapped = perSecond.length >= GAME_CONFIG.VOL_BOOTSTRAP_KLINES;
    // A partial bootstrap still counts as a few samples toward warm-up.
    this.sampleCount = Math.max(this.sampleCount, perSecond.length);
  }

  get warmed(): boolean {
    return (
      this.initialized &&
      (this.bootstrapped || this.sampleCount >= GAME_CONFIG.VOL_WARMUP_SAMPLES)
    );
  }

  get samples(): number {
    return this.sampleCount;
  }

  get fastSigma(): number {
    return this.safeSigma(this.fastVar);
  }

  get slowSigma(): number {
    return this.safeSigma(this.slowVar);
  }

  /** Final blended per-second sigma with hard safety floor/ceiling. */
  get sigma(): number {
    const blended =
      GAME_CONFIG.FAST_VOL_WEIGHT * this.fastVar + GAME_CONFIG.SLOW_VOL_WEIGHT * this.slowVar;
    return this.safeSigma(blended);
  }

  private safeSigma(variance: number): number {
    if (!Number.isFinite(variance) || variance < 0) {
      return GAME_CONFIG.MIN_VOLATILITY_PER_SEC;
    }
    const s = Math.sqrt(variance);
    if (!Number.isFinite(s) || s <= 0) return GAME_CONFIG.MIN_VOLATILITY_PER_SEC;
    return Math.min(GAME_CONFIG.MAX_VOLATILITY_PER_SEC, Math.max(GAME_CONFIG.MIN_VOLATILITY_PER_SEC, s));
  }

  reset(): void {
    this.fastVar = 0;
    this.slowVar = 0;
    this.initialized = false;
    this.prevPrice = 0;
    this.prevTs = 0;
    this.sampleCount = 0;
    this.bootstrapped = false;
  }
}
