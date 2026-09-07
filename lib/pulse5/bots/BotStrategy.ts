import type { Side } from "@/lib/pulse5/engine/types";

export interface VisiblePriceSample {
  time: number;
  price: number;
}

export interface BotPastResult {
  roundId: number;
  profit: number;
  settledAt: number;
}

/** Contains only information legally visible at the decision timestamp. */
export interface BotDecisionContext {
  now: number;
  round: {
    id: number;
    start: number;
    lockTime: number;
    end: number;
  };
  currentPrice: number;
  roundOpen: number;
  priceSamples: VisiblePriceSample[];
  executionOdds: Record<Side, number | null>;
  availableBalance: number;
  recentResults: BotPastResult[];
  openOrderCount: number;
  lastOrderAt: number | null;
  lastOrderSide: Side | null;
}

export interface BotDecision {
  action: "UP" | "DOWN" | "SKIP";
  stake: number;
  confidence: number;
  reason: string;
}

export interface BotStrategy {
  readonly id: "alpha" | "beta";
  readonly name: string;
  readonly label: string;
  decide(context: BotDecisionContext): BotDecision;
}

export interface SignalMetrics {
  cumulativeReturn: number;
  slope: number;
  upTickRatio: number;
  meanDeviation: number;
  recentMomentum: number;
  priorMomentum: number;
}

export function visibleWindow(context: BotDecisionContext, windowMs: number): VisiblePriceSample[] {
  const cutoff = context.now - windowMs;
  return context.priceSamples.filter((sample) => sample.time >= cutoff && sample.time <= context.now);
}

function segmentReturn(samples: VisiblePriceSample[]): number {
  if (samples.length < 2 || samples[0].price <= 0) return 0;
  return (samples.at(-1)!.price - samples[0].price) / samples[0].price;
}

export function signalMetrics(context: BotDecisionContext, windowMs: number, recentMs: number): SignalMetrics | null {
  const samples = visibleWindow(context, windowMs);
  if (samples.length < 8) return null;
  let upTicks = 0;
  let comparableTicks = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const delta = samples[index].price - samples[index - 1].price;
    if (delta === 0) continue;
    comparableTicks += 1;
    if (delta > 0) upTicks += 1;
  }
  const mean = samples.reduce((sum, sample) => sum + sample.price, 0) / samples.length;
  const recent = samples.filter((sample) => sample.time >= context.now - recentMs);
  const prior = samples.filter((sample) => (
    sample.time >= context.now - recentMs * 2 && sample.time < context.now - recentMs
  ));
  return {
    cumulativeReturn: segmentReturn(samples),
    slope: segmentReturn(samples) / Math.max(1, (samples.at(-1)!.time - samples[0].time) / 1000),
    upTickRatio: comparableTicks ? upTicks / comparableTicks : 0.5,
    meanDeviation: mean > 0 ? (context.currentPrice - mean) / mean : 0,
    recentMomentum: segmentReturn(recent),
    priorMomentum: segmentReturn(prior),
  };
}

export function roundNoise(roundId: number, salt: number): number {
  let value = (Math.floor(roundId / 1000) ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}

export function resultStreak(results: BotPastResult[]): { wins: number; losses: number } {
  let wins = 0;
  let losses = 0;
  for (const result of results) {
    if (result.profit > 0 && losses === 0) wins += 1;
    else if (result.profit < 0 && wins === 0) losses += 1;
    else break;
  }
  return { wins, losses };
}

export function sizedStake(balance: number, ratio: number): number {
  const raw = Math.min(balance, balance * ratio);
  return Math.max(1, Math.floor(raw / 10) * 10);
}

export const SKIP = (reason: string, confidence = 0): BotDecision => ({
  action: "SKIP",
  stake: 0,
  confidence,
  reason,
});
