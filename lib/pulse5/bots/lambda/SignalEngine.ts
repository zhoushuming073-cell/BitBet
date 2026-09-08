import type { VisiblePriceSample } from "../BotStrategy";
import type { LambdaConfig, LambdaIndicatorKey } from "./LambdaConfig";

export interface LambdaSignal {
  score: number;
  components: Partial<Record<LambdaIndicatorKey, number>>;
  volatility: number;
  pathEfficiency: number;
}

const clamp = (value: number) => Math.max(-1, Math.min(1, value));

function windowOf(samples: VisiblePriceSample[], now: number, windowMs: number) {
  return samples.filter((sample) => sample.time >= now - windowMs && sample.time <= now);
}

function metrics(samples: VisiblePriceSample[], currentPrice: number) {
  if (samples.length < 6) return null;
  const first = samples[0].price;
  const last = currentPrice;
  const mean = samples.reduce((sum, item) => sum + item.price, 0) / samples.length;
  let up = 0;
  let moves = 0;
  let path = 0;
  const returns: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    const delta = samples[index].price - samples[index - 1].price;
    path += Math.abs(delta);
    if (delta !== 0) {
      moves += 1;
      if (delta > 0) up += 1;
    }
    if (samples[index - 1].price > 0) returns.push(delta / samples[index - 1].price);
  }
  const variance = returns.length
    ? returns.reduce((sum, value) => sum + value * value, 0) / returns.length
    : 0;
  const prices = samples.map((item) => item.price);
  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const half = Math.max(2, Math.floor(samples.length / 2));
  const prior = samples.slice(0, half);
  const recent = samples.slice(half);
  const segmentReturn = (items: VisiblePriceSample[]) => items.length > 1 && items[0].price > 0
    ? (items.at(-1)!.price - items[0].price) / items[0].price
    : 0;
  return {
    shortReturn: first > 0 ? (last - first) / first : 0,
    slope: first > 0 ? ((last - first) / first) / Math.max(1, (samples.at(-1)!.time - samples[0].time) / 1000) : 0,
    movingAverage: mean > 0 ? (last - mean) / mean : 0,
    tickImbalance: moves ? (up / moves - 0.5) * 2 : 0,
    rangePosition: high > low ? ((last - low) / (high - low) - 0.5) * 2 : 0,
    volatility: Math.sqrt(variance),
    momentumChange: segmentReturn(recent) - segmentReturn(prior),
    breakout: high > low ? last >= high ? 1 : last <= low ? -1 : 0 : 0,
    pathEfficiency: path > 0 ? Math.abs(last - first) / path : 0,
  };
}

export function calculateLambdaSignal(
  samples: VisiblePriceSample[],
  currentPrice: number,
  now: number,
  config: LambdaConfig,
): LambdaSignal | null {
  const components: LambdaSignal["components"] = {};
  let weighted = 0;
  let totalWeight = 0;
  let observedVolatility = 0;
  let observedEfficiency = 0;
  for (const indicator of config.indicators.filter((item) => item.enabled)) {
    const result = metrics(windowOf(samples, now, indicator.windowMs), currentPrice);
    if (!result) continue;
    observedVolatility = Math.max(observedVolatility, result.volatility);
    observedEfficiency = Math.max(observedEfficiency, result.pathEfficiency);
    let value = 0;
    switch (indicator.key) {
      case "shortReturn": value = clamp(result.shortReturn / 0.0015); break;
      case "slope": value = clamp(result.slope / 0.00006); break;
      case "movingAverage": value = clamp(result.movingAverage / 0.001); break;
      case "tickImbalance": value = clamp(result.tickImbalance); break;
      case "rangePosition": value = clamp(result.rangePosition); break;
      case "volatility": value = clamp((result.volatility / 0.0003) * Math.sign(result.shortReturn)); break;
      case "momentumChange": value = clamp(result.momentumChange / 0.001); break;
      case "breakout": value = clamp(result.breakout); break;
    }
    components[indicator.key] = value;
    weighted += value * indicator.weight;
    totalWeight += indicator.weight;
  }
  if (totalWeight === 0) return null;
  return { score: clamp(weighted / totalWeight), components, volatility: observedVolatility, pathEfficiency: observedEfficiency };
}
