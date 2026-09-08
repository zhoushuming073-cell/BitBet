import type { Side } from "../../engine/types";
import type { BotDecisionContext } from "../BotStrategy";
import type { LambdaConfig } from "./LambdaConfig";
import type { LambdaProbability } from "./ProbabilityModel";
import type { LambdaExposure } from "./ExposureManager";
import { calculateEdge, probabilityForSide } from "./EdgeCalculator";
import { isAdaptiveHedge } from "./HedgeManager";

export interface LambdaExecution {
  side: Side;
  stake: number;
  executionOdds: number;
  edge: number;
  modelProbability: number;
  adaptiveHedge: boolean;
}

export function findExecutableStake(
  context: BotDecisionContext,
  side: Side,
  theoreticalStake: number,
  probability: LambdaProbability,
  exposure: LambdaExposure,
  startingAssets: number,
  config: LambdaConfig,
): LambdaExecution | null {
  if (!context.estimateQuote) return null;
  const sideExposure = side === "up" ? exposure.up : exposure.down;
  const maxGross = startingAssets * config.maxRoundExposureRatio;
  const maxSide = startingAssets * config.maxSideExposureRatio;
  let stake = Math.min(theoreticalStake, maxGross - exposure.gross, maxSide - sideExposure, context.availableBalance);
  const modelProbability = probabilityForSide(probability, side);
  for (let attempt = 0; attempt < 5 && stake >= 1; attempt += 1) {
    stake = Math.max(1, Math.floor(stake / 10) * 10);
    const quote = context.estimateQuote(side, stake);
    if (quote?.quotable) {
      const edge = calculateEdge(modelProbability, quote.executionOdds);
      const adaptiveHedge = isAdaptiveHedge(exposure, side, stake, quote.potentialPayout);
      const opposite = exposure.netSide && exposure.netSide !== side;
      if (edge >= config.minEdge && (!opposite || (config.adaptiveHedge && adaptiveHedge))) {
        return { side, stake, executionOdds: quote.executionOdds, edge, modelProbability, adaptiveHedge };
      }
    }
    stake *= 0.75;
  }
  return null;
}
