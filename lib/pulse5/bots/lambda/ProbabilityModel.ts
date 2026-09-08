export interface LambdaProbability {
  up: number;
  down: number;
}

/** Deliberately conservative calibration: Lambda never claims near-certainty. */
export function signalToProbability(score: number): LambdaProbability {
  const up = Math.max(0.15, Math.min(0.85, 0.5 + Math.tanh(score * 1.35) * 0.28));
  return { up, down: 1 - up };
}
