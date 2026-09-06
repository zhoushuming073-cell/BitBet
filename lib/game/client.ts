/**
 * Browser client for the authoritative GameServer API. The UI calls these
 * instead of mutating state directly, so balance / orders / settlement / claim
 * are authoritative on the server, not in the browser.
 */
import type { Order, Side } from "@/lib/pulse5/engine/types";

export interface AuthorityState {
  balance: number;
  claimable: number;
  openOrders: Order[];
  settledOrders: Order[];
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? "请求失败");
  }
  return res.json() as Promise<T>;
}

export function fetchState(): Promise<AuthorityState> {
  return api<AuthorityState>("/api/game/state");
}

export function placeOrder(
  side: Side,
  stake: number,
  midPrice: number,
  idempotencyKey: string,
): Promise<{ order: Order }> {
  return api<{ order: Order }>("/api/game/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ side, stake, midPrice, idempotencyKey }),
  });
}

export function claim(orderId: string): Promise<{ claimed: number }> {
  return api<{ claimed: number }>("/api/game/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId }),
  });
}

export function claimAll(): Promise<{ claimed: number }> {
  return api<{ claimed: number }>("/api/game/claim-all", { method: "POST" });
}

export function settle(roundId: number, openPrice: number, closePrice: number): Promise<unknown> {
  return api("/api/game/settle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roundId, openPrice, closePrice }),
  });
}
