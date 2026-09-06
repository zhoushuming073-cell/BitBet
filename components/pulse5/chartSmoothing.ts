/**
 * Monotone cubic smoothing for the price chart.
 *
 * Uses Fritsch–Carlson tangent estimation (harmonic-mean slopes, zero slope at
 * local extrema) so the curve NEVER overshoots real highs/lows, stays monotone
 * through every up/down run, and turns smoothly at inflection points. A light
 * dynamic handle-scale shortens tangents on sharp acceleration (spikes) so they
 * aren't ironed out into a big arc.
 */

export interface ChartPoint {
  x: number;
  y: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Per-point tangent (dy/dx in pixel space) via monotone cubic. Guarantees no
 * overshoot: |tangent| stays within the 3× neighbor-slope limit of
 * Fritsch–Carlson, and the dynamic handle-scale only shrinks it further.
 */
export function computeMonotoneTangents(pts: ChartPoint[]): number[] {
  const n = pts.length;
  const m: number[] = new Array(n).fill(0);
  if (n <= 1) return m;

  const d: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i += 1) {
    const dx = pts[i + 1].x - pts[i].x;
    const dy = pts[i + 1].y - pts[i].y;
    d[i] = dx > 0 ? dy / dx : 0;
  }

  m[0] = d[0];
  m[n - 1] = d[n - 2];

  for (let i = 1; i < n - 1; i += 1) {
    const d0 = d[i - 1];
    const d1 = d[i];
    if (d0 * d1 <= 0) {
      m[i] = 0; // local extremum → flat tangent (no overshoot)
      continue;
    }
    // Harmonic mean (Fritsch–Carlson) — monotonicity-preserving.
    const harmonic = (2 * d0 * d1) / (d0 + d1);

    // Dynamic curvature: steady move → long smooth tangents; sharp velocity
    // change (spike / reversal) → shorter handles so the turn stays tight.
    const speed = (Math.abs(d0) + Math.abs(d1)) / 2;
    const accel = Math.abs(d1 - d0);
    const norm = speed > 0 ? accel / speed : 0;
    const handleScale = clamp(1 - norm * 0.45, 0.25, 1);

    m[i] = harmonic * handleScale;
  }

  return m;
}

/**
 * Stroke a single smooth path through the points using Hermite→cubic-Bézier.
 * One beginPath() for the whole series (no per-segment stroke → no seams).
 */
export function drawSmoothPath(
  ctx: CanvasRenderingContext2D,
  pts: ChartPoint[],
): void {
  const n = pts.length;
  if (n === 0) return;

  ctx.moveTo(pts[0].x, pts[0].y);
  if (n === 1) return;
  if (n === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
    return;
  }

  const m = computeMonotoneTangents(pts);
  for (let i = 0; i < n - 1; i += 1) {
    const p0 = pts[i];
    const p3 = pts[i + 1];
    const dx = p3.x - p0.x;
    if (dx <= 0) {
      ctx.lineTo(p3.x, p3.y);
      continue;
    }
    const c1x = p0.x + dx / 3;
    const c1y = p0.y + (m[i] * dx) / 3;
    const c2x = p3.x - dx / 3;
    const c2y = p3.y - (m[i + 1] * dx) / 3;
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p3.x, p3.y);
  }
}
