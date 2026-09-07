/**
 * Wallet service — balance reads, atomic bet debit, and idempotent claim.
 *
 * Claim is intentionally idempotent: the same settlement can be claimed any
 * number of times, but credits the wallet at most once. The settlement is
 * marked `claimed` first (a second click sees `claimed` and does nothing), then
 * the wallet credits — so double-credit is impossible.
 */
import { getRepositories } from "@/repository";
import type { ClaimResult } from "@/repository";
import type { Wallet } from "@/lib/domain/types";

export async function getWallet(userId: string): Promise<Wallet | null> {
  return getRepositories().wallets.getWallet(userId);
}

/** Atomic bet debit (throws on insufficient balance). */
export async function debitBet(
  userId: string,
  input: { orderId: string; roundId: string; stake: number },
): Promise<Wallet> {
  return getRepositories().wallets.debit(userId, { ...input, now: Date.now() });
}

/** Idempotent, atomic single claim. Never credits twice. */
export async function claimSettlement(userId: string, settlementId: string): Promise<ClaimResult> {
  return getRepositories().claim(userId, settlementId, Date.now());
}

/** Claim every pending settlement for a user. Returns the total credited. */
export async function claimAll(userId: string): Promise<number> {
  return (await getRepositories().claimAll(userId, Date.now())).amount;
}

export async function checkPendingClaim(userId: string) {
  return getRepositories().pendingClaimConsistency(userId);
}

export async function rebuildPendingClaim(userId: string): Promise<Wallet> {
  return getRepositories().rebuildPendingClaim(userId, Date.now());
}

/** Move a settled payout into pendingClaim (funds not yet spendable). */
export async function addPendingClaim(userId: string, amount: number): Promise<Wallet> {
  return getRepositories().wallets.addPendingClaim(userId, amount, Date.now());
}
