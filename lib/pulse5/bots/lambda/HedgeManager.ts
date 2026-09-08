import type { Side } from "../../engine/types";
import type { LambdaExposure } from "./ExposureManager";
import { projectedWorstPnl } from "./ExposureManager";

export function isAdaptiveHedge(
  exposure: LambdaExposure,
  side: Side,
  stake: number,
  payout: number,
) {
  if (!exposure.netSide || exposure.netSide === side) return false;
  const before = Math.min(exposure.pnlIfUp, exposure.pnlIfDown);
  return projectedWorstPnl(exposure, side, stake, payout) > before + 0.01;
}
