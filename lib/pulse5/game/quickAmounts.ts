function roundToTens(value: number): number {
  if (!(value > 0)) return 0;
  if (value < 10) return Math.round(value);
  return Math.round(value / 10) * 10;
}

/** 10% / 25% / 50% of the balance at the start of the current round. */
export function quickAmountsFor(roundStartingBalance: number): number[] {
  return [0.1, 0.25, 0.5].map((ratio) => roundToTens(roundStartingBalance * ratio));
}
