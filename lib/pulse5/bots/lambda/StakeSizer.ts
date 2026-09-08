import type { LambdaConfig } from "./LambdaConfig";

export function sizeLambdaStake(balance: number, confidence: number, edge: number, config: LambdaConfig) {
  let ratio = config.fixedStakeRatio;
  if (config.sizingMode === "confidence") ratio *= 0.7 + Math.max(0, confidence - 0.5) * 1.8;
  if (config.sizingMode === "edge") ratio *= 0.65 + Math.min(1.5, Math.max(0, edge) / Math.max(0.01, config.minEdge));
  ratio = Math.min(config.maxSingleOrderRatio, Math.max(0.005, ratio));
  return Math.max(1, Math.floor((balance * ratio) / 10) * 10);
}
