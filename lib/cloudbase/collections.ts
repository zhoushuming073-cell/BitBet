/**
 * CloudBase NoSQL collection names — the canonical mapping for every persisted
 * entity. Keep this as the single source of truth so repositories never scatter
 * raw collection strings.
 */
export const COLLECTIONS = {
  users: "users",
  profiles: "profiles",
  wallets: "wallets",
  rounds: "rounds",
  orders: "orders",
  settlements: "settlements",
  walletLedger: "wallet_ledger",
  leaderboardStats: "leaderboard_stats",
  syncBatches: "sync_batches",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
