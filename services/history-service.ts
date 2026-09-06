/**
 * History service — settled order history and pending claims for a user.
 */
import { getRepositories } from "@/repository";
import type { OrderRecord, SettlementRecord } from "@/lib/domain/types";

export async function getOrderHistory(userId: string, limit = 50): Promise<OrderRecord[]> {
  return getRepositories().orders.listByUser(userId, limit);
}

export async function getPendingClaims(userId: string): Promise<SettlementRecord[]> {
  return getRepositories().settlements.listPending(userId);
}

/** Aggregated wallet summary for the profile page. */
export interface WalletSummary {
  availableBalance: number;
  pendingClaim: number;
  totalStaked: number;
  totalClaimed: number;
  netProfit: number;
  initialBalance: number;
}

export async function getWalletSummary(userId: string): Promise<WalletSummary | null> {
  const wallet = await getRepositories().wallets.getWallet(userId);
  if (!wallet) return null;
  return {
    availableBalance: wallet.availableBalance,
    pendingClaim: wallet.pendingClaim,
    totalStaked: wallet.totalStaked,
    totalClaimed: wallet.totalClaimed,
    netProfit: wallet.netProfit,
    initialBalance: wallet.initialBalance,
  };
}
