function roundToTens(value: number): number {
  if (!(value > 0)) return 0;
  if (value < 10) return Math.round(value);
  return Math.round(value / 10) * 10;
}

/** 10% / 25% / 50% of the balance at the start of the current round. */
export function quickAmountsFor(roundStartingBalance: number): number[] {
  return [...new Set(
    [0.1, 0.25, 0.5]
      .map((ratio) => roundToTens(roundStartingBalance * ratio))
      .filter((value) => Number.isFinite(value) && value > 0),
  )];
}

/** Numeric shortcuts that can actually be submitted with the current balance. */
export function availableQuickAmountsFor(roundStartingBalance: number, availableBalance: number): number[] {
  if (!(availableBalance > 0) || !Number.isFinite(availableBalance)) return [];
  const capped = Math.floor(availableBalance * 100) / 100;
  return [...new Set(
    quickAmountsFor(roundStartingBalance)
      .map((value) => Math.min(value, capped))
      .filter((value) => value >= 1),
  )];
}
