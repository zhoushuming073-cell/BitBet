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
  enqueue(batch: SyncBatch): void;
  process(): Promise<void>;
  pendingCount(): number;
}

export type SyncHandler = (batch: SyncBatch) => Promise<void>;

const MAX_ATTEMPTS = 6;
const MAX_DELAY_MS = 60_000;

export class MemorySyncQueue implements SyncQueue {
  private queue: SyncBatch[] = [];
  private inFlight = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly handler: SyncHandler;

  constructor(handler: SyncHandler) {
    this.handler = handler;
  }

  enqueue(batch: SyncBatch): void {
    this.queue.push(batch);
    this.schedule();
  }

  pendingCount(): number {
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
          this.queue.shift();
        } catch (error) {
          batch.status = "failed";
          batch.attemptCount += 1;
          batch.lastError = error instanceof Error ? error.message : String(error);
          if (batch.attemptCount >= MAX_ATTEMPTS) {
            console.warn("[sync]", batch.batchId, batch.lastError);
            break; // keep it queued; a later process() run retries
          }
          const delay = Math.min(1000 * 2 ** batch.attemptCount, MAX_DELAY_MS);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    } finally {
      this.inFlight = false;
    }
  }
}
