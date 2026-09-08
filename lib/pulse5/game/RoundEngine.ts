import { GAME_CONFIG } from "./gameConfig";

export interface RoundWindow {
  /** Round id = kline open time (epoch ms aligned to 5m). */
  id: number;
  start: number;
  /** Betting locks 15s before the kline closes. */
  lockTime: number;
  end: number;
  secondsRemaining: number;
}

/**
 * Rounds are strictly aligned to UTC 5m candle boundaries:
 * 00, 05, 10, ..., 55 minutes past the hour.
 */
export function roundFor(nowMs: number): RoundWindow {
  const duration = GAME_CONFIG.ROUND_DURATION_MS;
  const start = Math.floor(nowMs / duration) * duration;
  const end = start + duration;
  const lockTime = end - GAME_CONFIG.BET_LOCK_MS;
  const secondsRemaining = Math.max(0, Math.ceil((end - nowMs) / 1000));
  return { id: start, start, lockTime, end, secondsRemaining };
}

export type RoundPhase = "OPEN" | "LOCKED" | "ENDED";

export function roundPhase(nowMs: number): RoundPhase {
  const round = roundFor(nowMs);
  if (nowMs >= round.end) return "ENDED";
  if (nowMs >= round.lockTime) return "LOCKED";
  return "OPEN";
}

/** Betting is allowed strictly while now < end - 15s. */
export function isBettingOpen(nowMs: number): boolean {
  const round = roundFor(nowMs);
  return nowMs < round.lockTime;
}

/** Precimate millisecond margin to the lock boundary (for tests). */
export function lockBoundary(roundId: number): number {
  return roundId + GAME_CONFIG.ROUND_DURATION_MS - GAME_CONFIG.BET_LOCK_MS;
}
