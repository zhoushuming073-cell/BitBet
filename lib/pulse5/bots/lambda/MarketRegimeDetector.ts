import type { LambdaSignal } from "./SignalEngine";
import type { LambdaMarketRegime } from "./LambdaConfig";

export function detectMarketRegimes(signal: LambdaSignal): Set<LambdaMarketRegime> {
  const regimes = new Set<LambdaMarketRegime>();
  if (signal.pathEfficiency >= 0.34 && Math.abs(signal.score) >= 0.16) regimes.add("trend");
  else regimes.add("range");
  if (signal.volatility >= 0.00045) regimes.add("highVolatility");
  else regimes.add("lowVolatility");
  return regimes;
}
