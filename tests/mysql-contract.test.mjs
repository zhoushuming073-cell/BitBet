import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

test("MySQL 8 schema covers required tables, DECIMAL money, FKs and idempotency", async () => {
  const sql = await readFile(`${root}/migrations/001_initial_schema.sql`, "utf8");
  for (const table of [
    "users", "profiles", "wallets", "rounds", "orders", "settlements",
    "wallet_ledger", "leaderboard_stats", "sync_batches",
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`, "i"));
  }
  assert.match(sql, /DECIMAL\(20,2\)/i);
  assert.match(sql, /ENGINE=InnoDB DEFAULT CHARSET=utf8mb4/i);
  assert.match(sql, /FOREIGN KEY/i);
  assert.match(sql, /UNIQUE KEY uq_orders_user_idempotency \(user_id, idempotency_key\)/i);
  assert.match(sql, /JSON NOT NULL/i);
});

test("MySQL adapter uses row locks and wraps order/claim paths in transactions", async () => {
  const source = await readFile(`${root}/repository/mysql.ts`, "utf8");
  assert.match(source, /SELECT \* FROM wallets WHERE user_id = \? FOR UPDATE/);
  assert.match(source, /SELECT \* FROM settlements WHERE settlement_id = \? FOR UPDATE/);
  assert.match(source, /SELECT order_id FROM orders WHERE user_id = \? AND idempotency_key = \? FOR UPDATE/);
  assert.match(source, /withTransaction\(async \(connection\)/);
  assert.match(source, /rebuildPendingClaim/);
});

test("真实 CloudBase MySQL 集成测试需要连接配置", { skip: !process.env.CONNECTION_URI }, async () => {
  // Intentionally non-mutating: presence is reported separately from the memory
  // and static-contract suites. A disposable integration database is required
  // before running transaction race tests against MySQL itself.
  assert.match(process.env.CONNECTION_URI, /^mysql:\/\//i);
});
