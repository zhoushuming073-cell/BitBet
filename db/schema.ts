import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * One authoritative ledger per player/bot actor. The snapshot is produced by
 * the shared Pulse5 engine, so browser, bot and settlement paths use one model.
 */
export const gameActorLedgers = sqliteTable("game_actor_ledgers", {
  actorId: text("actor_id").primaryKey(),
  ownerUserId: text("owner_user_id").notNull(),
  actorType: text("actor_type").notNull(),
  displayName: text("display_name").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  runtimeJson: text("runtime_json").notNull().default("{}"),
  version: integer("version").notNull().default(1),
  updatedAt: integer("updated_at").notNull(),
});

/** Per-user no-code Lambda strategy configuration. */
export const lambdaConfigs = sqliteTable("lambda_configs", {
  userId: text("user_id").primaryKey(),
  configJson: text("config_json").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: integer("updated_at").notNull(),
});

/** A tiny global lease lets cron/request fallbacks avoid duplicate bot cycles. */
export const botSchedulerLeases = sqliteTable("bot_scheduler_leases", {
  leaseKey: text("lease_key").primaryKey(),
  leaseUntil: integer("lease_until").notNull(),
  owner: text("owner").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
