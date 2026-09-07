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
import { BOT_ALPHA_CONFIG as config } from "./botConfig";

export class BotAlphaStrategy implements BotStrategy {
  readonly id = "alpha" as const;
  readonly name = "Bot Alpha";
  readonly label = "趋势跟随";

  decide(context: BotDecisionContext): BotDecision {
    const duration = context.round.end - context.round.start;
    const progress = (context.now - context.round.start) / duration;
    const timingNoise = (roundNoise(context.round.id, 101) - 0.5) * config.timingJitter * 2;
    if (progress < config.earliestProgress + timingNoise) return SKIP("等待趋势形成");
    if (progress > config.latestProgress + timingNoise || context.now >= context.round.lockTime) {
      return SKIP("已过主动追势时段");
    }
    if (roundNoise(context.round.id, 211) < config.skipRoundChance) return SKIP("本轮信心不足，主动跳过");

    const metrics = signalMetrics(context, config.windowMs, config.recentMs);
    if (!metrics) return SKIP("价格样本不足");
    const direction = Math.sign(metrics.cumulativeReturn);
    if (!direction || Math.abs(metrics.cumulativeReturn) < config.minCumulativeReturn) return SKIP("短线斜率不明显");

    const tickBias = direction > 0 ? metrics.upTickRatio : 1 - metrics.upTickRatio;
    const alignedWithMean = direction * metrics.meanDeviation > config.minMeanDeviation;
    const stillMoving = direction * metrics.recentMomentum > -Math.abs(metrics.priorMomentum) * 0.2;
    if (tickBias < config.minTickBias || !alignedWithMean || !stillMoving) return SKIP("趋势信号没有形成一致方向");

    const confidence = Math.min(0.9,
      0.38
      + Math.min(0.22, Math.abs(metrics.cumulativeReturn) / 0.003 * 0.22)
      + Math.min(0.18, Math.max(0, tickBias - 0.5) * 1.4)
      + (alignedWithMean ? 0.1 : 0)
      + (roundNoise(context.round.id, 307) - 0.5) * config.confidenceJitter * 2,
    );
    if (confidence < config.minConfidence) return SKIP("信号在临界区，选择观望", confidence);

    const action = direction > 0 ? "UP" : "DOWN";
    const odds = context.executionOdds[action === "UP" ? "up" : "down"];
    if (!odds || odds < 1.16) return SKIP("这一方向的成交赔率不合适", confidence);

    const streak = resultStreak(context.recentResults);
    let risk: number = confidence > 0.76 ? config.strongRisk : config.baseRisk;
    if (streak.wins >= 2) risk += Math.min(0.015, streak.wins * 0.005);
    if (streak.losses > 0) risk -= config.lossRiskReduction;
    risk = Math.min(config.maxRisk, Math.max(0.02, risk));
    return {
      action,
      stake: sizedStake(context.availableBalance, risk),
      confidence,
      reason: action === "UP" ? "短线斜率与上涨 tick 同向" : "短线斜率与下跌 tick 同向",
    };
  }
}
