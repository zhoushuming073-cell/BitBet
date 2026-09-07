import { roundFor } from "@/lib/pulse5/game/RoundEngine";

export interface ServerMarketSnapshot {
  midPrice: number;
  bid: number;
  ask: number;
  observedAt: number;
  roundOpen: number;
  volatilityCloses: number[];
}

export interface MarketPriceProvider {
  getSnapshot(now: number): Promise<ServerMarketSnapshot>;
}

let provider: MarketPriceProvider | null = null;

export function configureMarketPriceProvider(next: MarketPriceProvider): void {
  provider = next;
}

export async function getServerMarketSnapshot(now: number, devClientPrice?: number): Promise<ServerMarketSnapshot> {
  if (provider) return provider.getSnapshot(now);
  const allowDevPrice = process.env.NODE_ENV !== "production"
    && process.env.ALLOW_CLIENT_MARKET_PRICE_DEV === "true";
  if (allowDevPrice && Number.isFinite(devClientPrice) && (devClientPrice ?? 0) > 0) {
    const midPrice = devClientPrice as number;
    return {
      midPrice,
      bid: midPrice - 0.5,
      ask: midPrice + 0.5,
      observedAt: now,
      roundOpen: midPrice,
      volatilityCloses: Array.from({ length: 25 }, (_, index) => midPrice + index * 0.5),
    };
  }
  const round = roundFor(now);
  throw new Error(`服务端行情源未配置（当前轮次 ${round.id}）；生产环境拒绝客户端价格`);
}
