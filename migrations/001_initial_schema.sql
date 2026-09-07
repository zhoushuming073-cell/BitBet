-- BitBet / CloudBase MySQL 8.0 baseline schema.
-- Money is persisted as DECIMAL; timestamps are Unix milliseconds (BIGINT).

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) NOT NULL,
  auth_uid VARCHAR(128) NOT NULL,
  email VARCHAR(320) NULL,
  username VARCHAR(20) NOT NULL,
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  created_at BIGINT UNSIGNED NOT NULL,
  last_login_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_auth_uid (auth_uid),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_username (username),
  KEY idx_users_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS profiles (
  user_id VARCHAR(64) NOT NULL,
  username VARCHAR(20) NOT NULL,
  avatar_url VARCHAR(2048) NOT NULL DEFAULT '',
  bio VARCHAR(280) NOT NULL DEFAULT '',
  created_at BIGINT UNSIGNED NOT NULL,
  updated_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_profiles_username (username),
  CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS wallets (
  user_id VARCHAR(64) NOT NULL,
  available_balance DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  pending_claim DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  initial_balance DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  total_staked DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  total_claimed DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  net_profit DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at BIGINT UNSIGNED NOT NULL,
  updated_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT chk_wallet_nonnegative CHECK (available_balance >= 0 AND pending_claim >= 0),
  CONSTRAINT fk_wallets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS rounds (
  round_id VARCHAR(64) NOT NULL,
  symbol VARCHAR(20) NOT NULL,
  start_time BIGINT UNSIGNED NOT NULL,
  end_time BIGINT UNSIGNED NOT NULL,
  open_price DECIMAL(24,8) NOT NULL,
  close_price DECIMAL(24,8) NULL,
  result ENUM('UP', 'DOWN', 'DRAW') NULL,
  status ENUM('OPEN', 'SETTLED') NOT NULL,
  settled_at BIGINT UNSIGNED NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (round_id),
  KEY idx_rounds_status_end (status, end_time),
  KEY idx_rounds_symbol_start (symbol, start_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS orders (
  order_id VARCHAR(96) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  round_id VARCHAR(64) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  side ENUM('up', 'down') NOT NULL,
  stake DECIMAL(20,2) NOT NULL,
  locked_odds DECIMAL(14,6) NOT NULL,
  potential_payout DECIMAL(20,2) NOT NULL,
  entry_price DECIMAL(24,8) NOT NULL,
  placed_at BIGINT UNSIGNED NOT NULL,
  status ENUM('OPEN', 'SETTLED', 'VOID') NOT NULL,
  payout DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  profit DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  settlement_id VARCHAR(96) NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (order_id),
  UNIQUE KEY uq_orders_user_idempotency (user_id, idempotency_key),
  KEY idx_orders_user_placed (user_id, placed_at DESC),
  KEY idx_orders_round_status (round_id, status),
  CONSTRAINT chk_orders_stake CHECK (stake > 0),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_orders_round FOREIGN KEY (round_id) REFERENCES rounds(round_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS settlements (
  settlement_id VARCHAR(96) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  round_id VARCHAR(64) NOT NULL,
  order_id VARCHAR(96) NOT NULL,
  result ENUM('UP', 'DOWN', 'DRAW') NOT NULL,
  stake DECIMAL(20,2) NOT NULL,
  locked_odds DECIMAL(14,6) NOT NULL,
  payout DECIMAL(20,2) NOT NULL,
  profit DECIMAL(20,2) NOT NULL,
  claim_status ENUM('pending', 'claimed') NOT NULL DEFAULT 'pending',
  settled_at BIGINT UNSIGNED NOT NULL,
  claimed_at BIGINT UNSIGNED NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (settlement_id),
  UNIQUE KEY uq_settlements_order (order_id),
  KEY idx_settlements_user_claim (user_id, claim_status, settled_at),
  KEY idx_settlements_round (round_id),
  CONSTRAINT fk_settlements_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_settlements_round FOREIGN KEY (round_id) REFERENCES rounds(round_id) ON DELETE RESTRICT,
  CONSTRAINT fk_settlements_order FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS wallet_ledger (
  ledger_id VARCHAR(96) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  type ENUM('INITIAL_BALANCE', 'BET', 'CLAIM', 'REFUND', 'ADJUSTMENT') NOT NULL,
  amount DECIMAL(20,2) NOT NULL,
  balance_after DECIMAL(20,2) NOT NULL,
  round_id VARCHAR(64) NULL,
  order_id VARCHAR(96) NULL,
  settlement_id VARCHAR(96) NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (ledger_id),
  UNIQUE KEY uq_ledger_bet_order (type, order_id),
  UNIQUE KEY uq_ledger_claim_settlement (type, settlement_id),
  KEY idx_ledger_user_created (user_id, created_at DESC),
  CONSTRAINT fk_ledger_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS leaderboard_stats (
  user_id VARCHAR(64) NOT NULL,
  total_orders BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_rounds BIGINT UNSIGNED NOT NULL DEFAULT 0,
  total_staked DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  total_payout DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  net_profit DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  roi DECIMAL(18,8) NOT NULL DEFAULT 0.00000000,
  wins BIGINT UNSIGNED NOT NULL DEFAULT 0,
  losses BIGINT UNSIGNED NOT NULL DEFAULT 0,
  win_rate DECIMAL(18,8) NOT NULL DEFAULT 0.00000000,
  current_balance DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  updated_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id),
  KEY idx_lb_profit (net_profit DESC, user_id),
  KEY idx_lb_roi (roi DESC, user_id),
  KEY idx_lb_win_rate (win_rate DESC, total_orders DESC, user_id),
  KEY idx_lb_balance (current_balance DESC, user_id),
  CONSTRAINT fk_leaderboard_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS sync_batches (
  batch_id VARCHAR(96) NOT NULL,
  round_id VARCHAR(64) NOT NULL,
  payload_json JSON NOT NULL,
  status ENUM('pending', 'syncing', 'synced', 'failed') NOT NULL DEFAULT 'pending',
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  next_attempt_at BIGINT UNSIGNED NULL,
  lease_owner VARCHAR(128) NULL,
  lease_expires_at BIGINT UNSIGNED NULL,
  created_at BIGINT UNSIGNED NOT NULL,
  updated_at BIGINT UNSIGNED NOT NULL,
  synced_at BIGINT UNSIGNED NULL,
  PRIMARY KEY (batch_id),
  UNIQUE KEY uq_sync_batches_round (round_id),
  KEY idx_sync_batches_retry (status, next_attempt_at),
  CONSTRAINT fk_sync_batches_round FOREIGN KEY (round_id) REFERENCES rounds(round_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
