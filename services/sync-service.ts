/**
 * Sync queue abstraction — decouples "finish a round now" from "persist to
 * CloudBase eventually". The authoritative (offshore) backend settles a round
 * and immediately starts the next one; persistence runs in the background with
 * exponential backoff so cross-border latency / outages never block live play.
 *
 * This is the contract for the future offshore backend. In the browser it is a
 * memory queue; the offshore service can swap in a durable implementation
 * (SQLite / Redis / Durable Object) behind the same interface.
 */
import type { SyncBatch } from "@/lib/domain/types";

export interface SyncQueue {
  readonly durable: boolean;
  enqueue(batch: SyncBatch): Promise<void>;
  process(): Promise<void>;
  pendingCount(): Promise<number>;
}

export type SyncHandler = (batch: SyncBatch) => Promise<void>;

const MAX_ATTEMPTS = 6;
const MAX_DELAY_MS = 60_000;

export class MemorySyncQueue implements SyncQueue {
  readonly durable = false;
  private queue: SyncBatch[] = [];
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly handler: SyncHandler;

  constructor(handler: SyncHandler) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("生产环境必须注入持久化 SyncQueue；内存队列已禁用");
    }
    this.handler = handler;
  }

  async enqueue(batch: SyncBatch): Promise<void> {
    this.queue.push(batch);
    this.schedule();
  }

  async pendingCount(): Promise<number> {
    return this.queue.length;
  }

  private schedule(): void {
    if (this.inFlight || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.process();
    }, 0);
  }

  async process(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      while (this.queue.length > 0) {
        const batch = this.queue[0];
        batch.status = "syncing";
        try {
          await this.handler(batch);
          batch.status = "synced";
          batch.syncedAt = Date.now();
          batch.updatedAt = batch.syncedAt;
          batch.nextAttemptAt = null;
          this.queue.shift();
        } catch (error) {
          batch.status = "failed";
          batch.attemptCount += 1;
          batch.lastError = error instanceof Error ? error.message : String(error);
          batch.updatedAt = Date.now();
          if (batch.attemptCount >= MAX_ATTEMPTS) {
            console.warn("[sync]", batch.batchId, batch.lastError);
            break; // keep it queued; a later process() run retries
          }
          const delay = Math.min(1000 * 2 ** batch.attemptCount, MAX_DELAY_MS);
          batch.nextAttemptAt = Date.now() + delay;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    } finally {
      this.inFlight = false;
    }
  }
}
