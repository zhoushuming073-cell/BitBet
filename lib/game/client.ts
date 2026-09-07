/**
 * Browser client for the authoritative GameServer API. The UI calls these
 * instead of mutating state directly, so balance / orders / settlement / claim
 * are authoritative on the server, not in the browser.
 */
import type { Order, Side } from "@/lib/pulse5/engine/types";
import { authenticatedFetch } from "@/lib/api/authenticated-fetch";

export interface AuthorityState {
  balance: number;
  claimable: number;
  openOrders: Order[];
  settledOrders: Order[];
}

export function fetchState(): Promise<AuthorityState> {
  return authenticatedFetch<AuthorityState>("/api/game/state");
}

export function placeOrder(
  side: Side,
  stake: number,
  midPrice: number,
  idempotencyKey: string,
): Promise<{ order: Order }> {
  return authenticatedFetch<{ order: Order }>("/api/game/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      side,
      stake,
      idempotencyKey,
      ...(process.env.NODE_ENV !== "production" ? { midPrice } : {}),
    }),
  });
}

export function claim(orderId: string): Promise<{ claimed: number }> {
  return authenticatedFetch<{ claimed: number }>("/api/game/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId }),
  });
}

export function claimAll(): Promise<{ claimed: number }> {
  return authenticatedFetch<{ claimed: number }>("/api/game/claim-all", { method: "POST" });
}

export function settle(roundId: number, openPrice: number, closePrice: number): Promise<unknown> {
  if (process.env.NODE_ENV === "production") {
    return Promise.reject(new Error("生产结算由可信服务端行情任务执行"));
  }
  return authenticatedFetch("/api/game/settle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roundId, openPrice, closePrice }),
  });
}
