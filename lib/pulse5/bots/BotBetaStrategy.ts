import {
  SKIP,
  resultStreak,
  roundNoise,
  signalMetrics,
  sizedStake,
  type BotDecision,
  type BotDecisionContext,
  type BotStrategy,
} from "./BotStrategy";
import { BOT_BETA_CONFIG as config } from "./botConfig";

export class BotBetaStrategy implements BotStrategy {
  readonly id = "beta" as const;
  readonly name = "Bot Beta";
  readonly label = "均值回归";

  decide(context: BotDecisionContext): BotDecision {
    const streak = resultStreak(context.recentResults);
    const previousRound = context.recentResults[0];
    if (previousRound?.profit < 0 && previousRound.roundId === context.round.id - 5 * 60 * 1000) {
      return SKIP("上轮判断失误，本轮休息");
    }

    const duration = context.round.end - context.round.start;
    const progress = (context.now - context.round.start) / duration;
    const timingNoise = (roundNoise(context.round.id, 401) - 0.5) * config.timingJitter * 2;
    if (progress < config.earliestProgress + timingNoise) return SKIP("继续等待偏离扩大");
    if (progress > config.latestProgress + timingNoise || context.now >= context.round.lockTime) {
      return SKIP("已过均值回归入场时段");
    }
    if (roundNoise(context.round.id, 503) < config.skipRoundChance) return SKIP("边缘行情，保持克制");

    const metrics = signalMetrics(context, config.windowMs, config.recentMs);
    if (!metrics) return SKIP("价格样本不足");
    const direction = Math.sign(metrics.cumulativeReturn);
    if (!direction || Math.abs(metrics.cumulativeReturn) < config.minCumulativeReturn) return SKIP("偏离幅度不够");
    if (direction * metrics.meanDeviation < config.minMeanDeviation) return SKIP("价格尚未明显偏离短期均值");

    const directionalTicks = direction > 0 ? metrics.upTickRatio : 1 - metrics.upTickRatio;
    const slowing = Math.abs(metrics.recentMomentum) < Math.abs(metrics.priorMomentum) * 0.82
      || direction * metrics.recentMomentum < 0;
    const acceleratingTrend = directionalTicks > config.strongTrendTickRatio
      && direction * metrics.recentMomentum > Math.abs(metrics.priorMomentum) * 0.85;
    if (acceleratingTrend) return SKIP("单边趋势仍强，不提前猜顶底");
    if (!slowing) return SKIP("动量尚未衰减");

    const confidence = Math.min(0.88,
      0.42
      + Math.min(0.2, Math.abs(metrics.meanDeviation) / 0.0025 * 0.2)
      + Math.min(0.16, Math.abs(metrics.cumulativeReturn) / 0.004 * 0.16)
      + (slowing ? 0.12 : 0)
      + (roundNoise(context.round.id, 607) - 0.5) * config.confidenceJitter * 2,
    );
    if (confidence < config.minConfidence) return SKIP("反转迹象不够清晰", confidence);

    const action = direction > 0 ? "DOWN" : "UP";
    const odds = context.executionOdds[action === "UP" ? "up" : "down"];
    if (!odds || odds < 1.16) return SKIP("反向成交赔率不合适", confidence);

    let risk: number = confidence > 0.78 ? config.strongRisk : config.baseRisk;
    if (streak.losses > 0) risk -= Math.min(0.02, streak.losses * config.lossRiskReduction);
    risk = Math.min(config.maxRisk, Math.max(0.02, risk));
    return {
      action,
      stake: sizedStake(context.availableBalance, risk),
      confidence,
      reason: Math.abs(metrics.meanDeviation) > config.minMeanDeviation * 1.8 ? "价格偏离均值" : "动量开始衰减",
    };
  }
}
