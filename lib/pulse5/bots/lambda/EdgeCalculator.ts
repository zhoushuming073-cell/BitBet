import type { Side } from "../../engine/types";
import type { LambdaProbability } from "./ProbabilityModel";

export function probabilityForSide(probability: LambdaProbability, side: Side) {
  return side === "up" ? probability.up : probability.down;
}

export function calculateEdge(modelProbability: number, executionOdds: number) {
  if (!(executionOdds > 1)) return -1;
  return modelProbability - 1 / executionOdds;
}
