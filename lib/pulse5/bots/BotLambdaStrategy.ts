import type { Side } from "../engine/types";
import { SKIP, type BotDecision, type BotDecisionContext, type BotStrategy } from "./BotStrategy";
import { DEFAULT_LAMBDA_CONFIG, sanitizeLambdaConfig, type LambdaConfig } from "./lambda/LambdaConfig";
import { calculateLambdaSignal } from "./lambda/SignalEngine";
import { signalToProbability } from "./lambda/ProbabilityModel";
import { detectMarketRegimes } from "./lambda/MarketRegimeDetector";
import { calculateExposure } from "./lambda/ExposureManager";
import { sizeLambdaStake } from "./lambda/StakeSizer";
import { findExecutableStake } from "./lambda/ExecutionManager";

const MAX_ORDERS_BY_ACTIVITY = { 1: 4, 2: 8, 3: 12 } as const;
const COOLDOWN_BY_ACTIVITY = { 1: 10_000, 2: 6_000, 3: 3_000 } as const;

export class BotLambdaStrategy implements BotStrategy {
  readonly id = "lambda" as const;
  readonly name = "Bot Lambda";
  readonly label = "Custom Quant";

  constructor(private readonly config: LambdaConfig = DEFAULT_LAMBDA_CONFIG) {}

  decide(context: BotDecisionContext): BotDecision {
    const config = sanitizeLambdaConfig(this.config);
    if (context.now < context.round.start + 15_000) return SKIP("收集行情样本");
    if (context.now >= context.round.lockTime) return SKIP("已进入锁单阶段");
    if (context.openOrderCount >= MAX_ORDERS_BY_ACTIVITY[config.activity]) return SKIP("已达单轮订单上限");
    if (context.lastOrderAt && context.now - context.lastOrderAt < COOLDOWN_BY_ACTIVITY[config.activity]) {
      return SKIP("执行冷却中");
    }

    const signal = calculateLambdaSignal(context.priceSamples, context.currentPrice, context.now, config);
    if (!signal) return SKIP("有效样本不足");
    const regimes = detectMarketRegimes(signal);
    if (![...regimes].some((regime) => config.marketRegimes[regime])) return SKIP("当前市场环境被过滤");
    if (Math.abs(signal.score) < 0.1) return SKIP("综合信号接近中性", 0.5);

    const probability = signalToProbability(signal.score);
    const side: Side = probability.up >= probability.down ? "up" : "down";
    const confidence = Math.max(probability.up, probability.down);
    const orders = context.currentOrders ?? [];
    const exposure = calculateExposure(orders);
    if (exposure.sameSideRun >= config.maxSameSideEntries && exposure.netSide === side) {
      return SKIP("连续同向加仓已达上限", confidence);
    }
    const provisionalOdds = context.executionOdds[side];
    if (!provisionalOdds) return SKIP("当前方向没有可执行赔率", confidence);
    const provisionalEdge = confidence - 1 / provisionalOdds;
    const theoreticalStake = sizeLambdaStake(context.availableBalance, confidence, provisionalEdge, config);
    const startingAssets = context.availableBalance + exposure.gross;
    const execution = findExecutableStake(context, side, theoreticalStake, probability, exposure, startingAssets, config);
    if (!execution) return SKIP("真实成交赔率下 Edge 不足", confidence);

    const secondsRemaining = (context.round.end - context.now) / 1000;
    const conditionValues = { volatility: signal.volatility, secondsRemaining, edge: execution.edge };
    const checks = config.extraConditions.map((condition) => {
      const actual = conditionValues[condition.field];
      return condition.operator === "lt" ? actual < condition.value : actual > condition.value;
    });
    if (checks.length) {
      const passes = checks.reduce((value, pass, index) => index === 0
        ? pass
        : config.extraConditions[index].join === "AND" ? value && pass : value || pass, true);
      if (!passes) return SKIP("额外过滤条件未满足", confidence);
    }

    const dominant = Object.entries(signal.components).sort((a, b) => Math.abs(b[1] ?? 0) - Math.abs(a[1] ?? 0))[0]?.[0];
    const reason = execution.adaptiveHedge
      ? "Adaptive hedge"
      : dominant === "breakout" ? "Breakout + positive edge"
        : dominant === "movingAverage" ? "Mean deviation + momentum fade"
          : "20s momentum + slope";
    return {
      action: execution.side === "up" ? "UP" : "DOWN",
      stake: execution.stake,
      confidence,
      reason,
      meta: {
        modelProbability: execution.modelProbability,
        executionOdds: execution.executionOdds,
        edge: execution.edge,
        signalScore: signal.score,
        adaptiveHedge: execution.adaptiveHedge,
      },
    };
  }
}
