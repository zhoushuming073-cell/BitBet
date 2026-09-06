/**
 * GameServer — a minimal authoritative game backend for local verification.
 *
 * It owns a single engine instance (authoritative balance / orders / settlement
 * / claim) backed by a pure in-memory store. The browser should call the HTTP
 * API instead of mutating state directly, so the authoritative state lives on
 * the server, not in the browser.
 *
 * NOTE: this module-level singleton is correct for the single-process local
 * dev server. In production (Cloudflare Workers) the authoritative state must
 * move into a Durable Object / durable store — that's the offshore backend step.
 *
 * The live market feed (Binance) still lives in the browser today; the client
 * passes the current midPrice so the server can price/validate orders. Swapping
 * in a server-side feed later changes nothing here.
 */
import { createServerEngine } from "@/lib/pulse5/engine/createServerEngine";
import { roundFor } from "@/lib/pulse5/game/RoundEngine";
import type { Order, Side } from "@/lib/pulse5/engine/types";

const engine = createServerEngine();
let warmed = false;
const openedRounds = new Set<number>();

function ensureWarmed(midPrice: number): void {
  if (warmed) return;
  engine.setConnected(true);
  // Simplified warm-up: a gentle ramp around the price seeds the volatility
  // estimator (production feeds real 1m klines).
  engine.seedVolatility(Array.from({ length: 25 }, (_, i) => midPrice + i * 0.5));
  warmed = true;
}

function feedMarket(midPrice: number, now: number): void {
  engine.onBookTicker(midPrice - 0.5, midPrice + 0.5, now);
  engine.onTrade(midPrice, now);
}

/** Authoritative order placement. Returns the server-priced order. */
export function placeOrder(
  side: Side,
  stake: number,
  midPrice: number,
  now: number,
  idempotencyKey: string,
): Order {
  ensureWarmed(midPrice);
  const round = roundFor(now);
  if (!openedRounds.has(round.id)) {
    openedRounds.add(round.id);
    engine.setRoundOpen(round.id, midPrice);
  }
  feedMarket(midPrice, now);
  return engine.placeOrder(side, stake, idempotencyKey, now);
}

export function claimOrder(orderId: string): number {
  return engine.claimOrder(orderId);
}

export function claimAll(): number {
  return engine.claimAll();
}

/** Settle a round from its official open/close (dev helper; prod uses Binance klines). */
export function settle(roundId: number, openPrice: number, closePrice: number, now: number) {
  return engine.settle(roundId, openPrice, closePrice, now);
}

/** Minimal authoritative state (what the browser may read). */
export function getState() {
  return {
    balance: engine.ledger.balance,
    claimable: engine.ledger.claimableBalance(),
    openOrders: engine.ledger.allOpenOrders().map((o) => ({ ...o })),
    settledOrders: engine.ledger.orders
      .filter((o) => o.status !== "OPEN")
      .map((o) => ({ ...o })),
  };
}
