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
  return new Pulse5Engine(store ?? new LedgerStore(null));
}
