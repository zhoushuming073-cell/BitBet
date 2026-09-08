CREATE TABLE IF NOT EXISTS `lambda_learning_states` (
	`user_id` text PRIMARY KEY NOT NULL,
	`state_json` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer NOT NULL
);
