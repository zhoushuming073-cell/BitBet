CREATE TABLE `bot_scheduler_leases` (
	`lease_key` text PRIMARY KEY NOT NULL,
	`lease_until` integer NOT NULL,
	`owner` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `game_actor_ledgers` (
	`actor_id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`actor_type` text NOT NULL,
	`display_name` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`runtime_json` text DEFAULT '{}' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `lambda_configs` (
	`user_id` text PRIMARY KEY NOT NULL,
	`config_json` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
);
