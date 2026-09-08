export type LambdaIndicatorKey =
  | "shortReturn"
  | "slope"
  | "movingAverage"
  | "tickImbalance"
  | "rangePosition"
  | "volatility"
  | "momentumChange"
  | "breakout";

export type LambdaSizingMode = "fixed" | "confidence" | "edge";
export type LambdaMarketRegime = "trend" | "range" | "highVolatility" | "lowVolatility";

export interface LambdaIndicatorConfig {
  key: LambdaIndicatorKey;
  enabled: boolean;
  windowMs: number;
  weight: 1 | 2 | 3 | 4 | 5;
}

export interface LambdaExtraCondition {
  field: "volatility" | "secondsRemaining" | "edge";
  operator: "lt" | "gt";
  value: number;
  join: "AND" | "OR";
}

export interface LambdaConfig {
  indicators: LambdaIndicatorConfig[];
  minEdge: number;
  activity: 1 | 2 | 3;
  sizingMode: LambdaSizingMode;
  fixedStakeRatio: number;
  maxSingleOrderRatio: number;
  maxRoundExposureRatio: number;
  maxSideExposureRatio: number;
  maxSameSideEntries: number;
  adaptiveHedge: boolean;
  marketRegimes: Record<LambdaMarketRegime, boolean>;
  extraConditions: LambdaExtraCondition[];
}

export const DEFAULT_LAMBDA_CONFIG: LambdaConfig = {
  indicators: [
    { key: "shortReturn", enabled: true, windowMs: 20_000, weight: 4 },
    { key: "slope", enabled: true, windowMs: 30_000, weight: 3 },
    { key: "tickImbalance", enabled: true, windowMs: 20_000, weight: 2 },
    { key: "movingAverage", enabled: true, windowMs: 30_000, weight: 3 },
    { key: "rangePosition", enabled: false, windowMs: 30_000, weight: 2 },
    { key: "volatility", enabled: true, windowMs: 30_000, weight: 2 },
    { key: "momentumChange", enabled: true, windowMs: 24_000, weight: 3 },
    { key: "breakout", enabled: false, windowMs: 40_000, weight: 2 },
  ],
  minEdge: 0.04,
  activity: 2,
  sizingMode: "edge",
  fixedStakeRatio: 0.02,
  maxSingleOrderRatio: 0.04,
  maxRoundExposureRatio: 0.18,
  maxSideExposureRatio: 0.12,
  maxSameSideEntries: 4,
  adaptiveHedge: true,
  marketRegimes: { trend: true, range: true, highVolatility: false, lowVolatility: true },
  extraConditions: [],
};

const INDICATOR_KEYS = new Set<LambdaIndicatorKey>(DEFAULT_LAMBDA_CONFIG.indicators.map((item) => item.key));

export function sanitizeLambdaConfig(value: unknown): LambdaConfig {
  const input = value && typeof value === "object" ? value as Partial<LambdaConfig> : {};
  const indicators = Array.isArray(input.indicators)
    ? input.indicators
      .filter((item): item is LambdaIndicatorConfig => Boolean(item && INDICATOR_KEYS.has(item.key)))
      .slice(0, 8)
      .map((item) => ({
        key: item.key,
        enabled: Boolean(item.enabled),
        windowMs: Math.min(60_000, Math.max(8_000, Math.round(Number(item.windowMs) || 20_000))),
        weight: Math.min(5, Math.max(1, Math.round(Number(item.weight) || 1))) as 1 | 2 | 3 | 4 | 5,
      }))
    : DEFAULT_LAMBDA_CONFIG.indicators;
  const activity = Math.min(3, Math.max(1, Math.round(Number(input.activity) || 2))) as 1 | 2 | 3;
  const regimes = input.marketRegimes ?? DEFAULT_LAMBDA_CONFIG.marketRegimes;
  const sizingMode = input.sizingMode === "fixed" || input.sizingMode === "confidence" ? input.sizingMode : "edge";
  return {
    indicators: indicators.length ? indicators : DEFAULT_LAMBDA_CONFIG.indicators,
    minEdge: clamp(Number(input.minEdge), 0.01, 0.08, 0.04),
    activity,
    sizingMode,
    fixedStakeRatio: clamp(Number(input.fixedStakeRatio), 0.01, 0.05, 0.02),
    maxSingleOrderRatio: clamp(Number(input.maxSingleOrderRatio), 0.01, 0.06, 0.04),
    maxRoundExposureRatio: clamp(Number(input.maxRoundExposureRatio), 0.1, 0.25, 0.18),
    maxSideExposureRatio: clamp(Number(input.maxSideExposureRatio), 0.05, 0.15, 0.12),
    maxSameSideEntries: Math.min(6, Math.max(1, Math.round(Number(input.maxSameSideEntries) || 4))),
    adaptiveHedge: input.adaptiveHedge !== false,
    marketRegimes: {
      trend: regimes.trend !== false,
      range: regimes.range !== false,
      highVolatility: Boolean(regimes.highVolatility),
      lowVolatility: regimes.lowVolatility !== false,
    },
    extraConditions: Array.isArray(input.extraConditions) ? input.extraConditions.slice(0, 4).map((condition) => ({
      field: condition?.field === "volatility" || condition?.field === "secondsRemaining" ? condition.field : "edge",
      operator: condition?.operator === "lt" ? "lt" : "gt",
      value: Number.isFinite(Number(condition?.value)) ? Number(condition.value) : 0,
      join: condition?.join === "OR" ? "OR" : "AND",
    })) : [],
  };
}

function clamp(value: number, min: number, max: number, fallback: number) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
