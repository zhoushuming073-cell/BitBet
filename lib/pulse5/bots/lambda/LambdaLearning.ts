import type { Order } from "../../engine/types";
import { sanitizeLambdaConfig, type LambdaConfig } from "./LambdaConfig";

export const MAX_PARAMETER_CHANGE_PER_ROUND = {
  signalWeight: 0.03,
  minEdge: 0.001,
  windowMs: 500,
  stakeRatio: 0.001,
} as const;

export interface LambdaLearningReport {
  roundId: number;
  settledAt: number;
  summary: string;
  changes: string[];
}

export interface LambdaLearningState {
  config: LambdaConfig;
  exp: number;
  level: number;
  generation: number;
  totalRounds: number;
  effectiveExperiences: number;
  calibrationBias: number;
  processedRoundIds: number[];
  recentReports: LambdaLearningReport[];
}

export function defaultLambdaLearningState(config: LambdaConfig): LambdaLearningState {
  return {
    config: sanitizeLambdaConfig(config),
    exp: 0,
    level: 1,
    generation: 1,
    totalRounds: 0,
    effectiveExperiences: 0,
    calibrationBias: 0,
    processedRoundIds: [],
    recentReports: [],
  };
}

export function lambdaGrowthStage(totalRounds: number): "初生期" | "适应期" | "成熟期" {
  if (totalRounds < 20) return "初生期";
  if (totalRounds < 100) return "适应期";
  return "成熟期";
}

function bounded(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** One deterministic, tightly bounded update after a genuinely settled Lambda round. */
export function learnFromSettledRound(
  current: LambdaLearningState,
  roundId: number,
  orders: Order[],
  settledAt: number,
): LambdaLearningState {
  if (!orders.length || current.processedRoundIds.includes(roundId)) return current;

  const stake = orders.reduce((sum, order) => sum + order.stake, 0) || 1;
  const profit = orders.reduce((sum, order) => sum + order.profit, 0);
  const avgEdge = orders.reduce((sum, order) => sum + (order.strategyMeta?.edge ?? 0), 0) / orders.length;
  const hedgeCount = orders.filter((order) => order.strategyMeta?.adaptiveHedge).length;
  const overtrading = orders.length > 8;
  const lossRatio = Math.min(1, Math.max(0, -profit / stake));
  const config = structuredClone(current.config);
  const changes: string[] = [];

  const primary = config.indicators.find((item) => item.key === "shortReturn" && item.enabled)
    ?? config.indicators.find((item) => item.enabled);
  if (primary) {
    const delta = profit >= 0 ? MAX_PARAMETER_CHANGE_PER_ROUND.signalWeight : -0.02;
    const before = primary.weight;
    primary.weight = Math.round(bounded(before + delta, 1, 5) * 100) / 100;
    if (primary.weight !== before) changes.push(`${primary.key} ${delta > 0 ? "+" : ""}${(primary.weight - before).toFixed(2)}`);
  }

  const edgeDelta = overtrading || lossRatio > 0.04
    ? MAX_PARAMETER_CHANGE_PER_ROUND.minEdge
    : profit > 0 && avgEdge > 0.02 ? -0.0005 : 0;
  if (edgeDelta) {
    const before = config.minEdge;
    config.minEdge = Math.round(bounded(before + edgeDelta, 0.01, 0.08) * 10_000) / 10_000;
    if (config.minEdge !== before) changes.push(`Minimum Edge ${(before * 100).toFixed(1)}% → ${(config.minEdge * 100).toFixed(1)}%`);
  }

  if (lossRatio > 0.05) {
    const before = config.maxSingleOrderRatio;
    config.maxSingleOrderRatio = Math.round(bounded(before - MAX_PARAMETER_CHANGE_PER_ROUND.stakeRatio, 0.01, 0.06) * 1_000) / 1_000;
    if (config.maxSingleOrderRatio !== before) changes.push(`单笔风险 -${(MAX_PARAMETER_CHANGE_PER_ROUND.stakeRatio * 100).toFixed(1)}%`);
  }

  // Rare deterministic exploration changes only an existing observation window; it never forces an order.
  if (roundId % 17 === 0 && primary) {
    const direction = (roundId / 300_000) % 2 === 0 ? 1 : -1;
    primary.windowMs = bounded(primary.windowMs + direction * MAX_PARAMETER_CHANGE_PER_ROUND.windowMs, 8_000, 60_000);
    changes.push(`观察窗口 ${direction > 0 ? "+" : "-"}0.5s`);
  }

  const totalRounds = current.totalRounds + 1;
  const exp = current.exp + 10;
  const summary = overtrading
    ? "本轮交易偏密，略微提高执行门槛。"
    : lossRatio > 0.04 ? "本轮回撤偏高，略微收敛风险。"
      : hedgeCount > 0 ? "本轮对冲有效，保留当前暴露管理。"
        : profit >= 0 ? "本轮信号表现稳定，进行小幅强化。" : "本轮判断有偏差，保持缓慢调整。";

  return {
    config: sanitizeLambdaConfig(config),
    exp,
    level: Math.floor(exp / 100) + 1,
    generation: Math.floor(totalRounds / 50) + 1,
    totalRounds,
    effectiveExperiences: current.effectiveExperiences + 1,
    calibrationBias: bounded(current.calibrationBias + bounded(profit / stake, -0.02, 0.02) * 0.02, -0.08, 0.08),
    processedRoundIds: [...current.processedRoundIds, roundId].slice(-500),
    recentReports: [{ roundId, settledAt, summary, changes: changes.slice(0, 3) }, ...current.recentReports].slice(0, 12),
  };
}
