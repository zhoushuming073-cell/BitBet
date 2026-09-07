/**
 * Server-side engine factory — the authoritative game engine for the future
 * offshore backend. Unlike createBrowserEngine (which owns a browser feed), this
 * takes an injected GameStateStore and is driven by the backend's own market
 * data. Defaults to a pure in-memory store; swap in SQLite / Redis / Durable
 * Object persistence without touching the engine.
 */
import { LedgerStore } from "../orders/LedgerStore";
import type { GameStateStore } from "../orders/GameStateStore";
import { Pulse5Engine } from "./Pulse5Engine";

export function createServerEngine(store?: GameStateStore): Pulse5Engine {
  if (!store && process.env.NODE_ENV === "production") {
    throw new Error("生产环境必须注入 DurableGameStateStore；内存权威状态已禁用");
  }
  return new Pulse5Engine(store ?? new LedgerStore(null));
}
