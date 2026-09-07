import type { RowDataPacket } from "mysql2/promise";
import type { SyncBatch } from "@/lib/domain/types";
import { getMySqlPool, withTransaction } from "@/lib/mysql/pool";
import type { SyncHandler, SyncQueue } from "./sync-service";

type BatchRow = RowDataPacket & {
  batch_id: string;
  round_id: string;
  payload_json: string | SyncBatch;
  status: SyncBatch["status"];
  attempt_count: number;
  last_error: string | null;
  created_at: string | number;
  synced_at: string | number | null;
};

const MAX_ATTEMPTS = 6;

export class MySqlSyncQueue implements SyncQueue {
  readonly durable = true;
  private readonly workerId = crypto.randomUUID();

  constructor(private readonly handler: SyncHandler) {}

  async enqueue(batch: SyncBatch): Promise<void> {
    const now = Date.now();
    const pool = await getMySqlPool();
    await pool.execute(
      `INSERT INTO sync_batches
       (batch_id, round_id, payload_json, status, attempt_count, last_error, next_attempt_at,
        lease_owner, lease_expires_at, created_at, updated_at, synced_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, NULL, NULL, ?, ?, ?)
       ON DUPLICATE KEY UPDATE batch_id = batch_id`,
      [batch.batchId, batch.roundId, JSON.stringify(batch), batch.attemptCount, batch.lastError ?? null,
        batch.nextAttemptAt ?? now, batch.createdAt, batch.updatedAt ?? now, batch.syncedAt],
    );
  }

  async pendingCount(): Promise<number> {
    const pool = await getMySqlPool();
    const [rows] = await pool.query<Array<RowDataPacket & { total: number }>>(
      "SELECT COUNT(*) AS total FROM sync_batches WHERE status IN ('pending', 'failed', 'syncing')",
    );
    return Number(rows[0]?.total ?? 0);
  }

  async process(): Promise<void> {
    while (true) {
      const row = await this.leaseNext();
      if (!row) return;
      const payload = typeof row.payload_json === "string"
        ? JSON.parse(row.payload_json) as SyncBatch
        : row.payload_json;
      const batch: SyncBatch = {
        ...payload,
        batchId: row.batch_id,
        roundId: row.round_id,
        status: "syncing",
        attemptCount: Number(row.attempt_count),
        lastError: row.last_error ?? undefined,
        createdAt: Number(row.created_at),
        syncedAt: row.synced_at == null ? null : Number(row.synced_at),
      };
      try {
        await this.handler(batch);
        const now = Date.now();
        const pool = await getMySqlPool();
        await pool.execute(
          `UPDATE sync_batches SET status = 'synced', synced_at = ?, updated_at = ?,
           next_attempt_at = NULL, lease_owner = NULL, lease_expires_at = NULL, last_error = NULL
           WHERE batch_id = ? AND lease_owner = ?`,
          [now, now, batch.batchId, this.workerId],
        );
      } catch (error) {
        const attempts = batch.attemptCount + 1;
        const now = Date.now();
        const delay = Math.min(1000 * 2 ** attempts, 60_000);
        const pool = await getMySqlPool();
        await pool.execute(
          `UPDATE sync_batches SET status = 'failed', attempt_count = ?, last_error = ?,
           next_attempt_at = ?, updated_at = ?, lease_owner = NULL, lease_expires_at = NULL
           WHERE batch_id = ? AND lease_owner = ?`,
          [attempts, error instanceof Error ? error.message : String(error), now + delay, now,
            batch.batchId, this.workerId],
        );
        if (attempts >= MAX_ATTEMPTS) return;
      }
    }
  }

  private async leaseNext(): Promise<BatchRow | null> {
    return withTransaction(async (connection) => {
      const now = Date.now();
      const [rows] = await connection.query<BatchRow[]>(
        `SELECT * FROM sync_batches
         WHERE ((status IN ('pending', 'failed') AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
           OR (status = 'syncing' AND lease_expires_at < ?))
           AND attempt_count < ?
         ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
        [now, now, MAX_ATTEMPTS],
      );
      const row = rows[0];
      if (!row) return null;
      await connection.execute(
        `UPDATE sync_batches SET status = 'syncing', lease_owner = ?, lease_expires_at = ?, updated_at = ?
         WHERE batch_id = ?`,
        [this.workerId, now + 60_000, now, row.batch_id],
      );
      return row;
    });
  }
}
