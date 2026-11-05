// Tap tempo: BPM and first beat from taps on the beat. Pure function.

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export interface TapTempoResult {
  bpm: number;
  /** Time of the downbeat of bar 1 (least-squares fit through the taps; the first tap when too few to fit). */
  firstBeatSec: number;
  /** Taps that were used. */
  used: number;
  /** Intervals thrown away as outliers. */
  rejected: number;
  /** Standard deviation of tap residuals, ms. */
  jitterMs: number;
}

/**
 * BPM and first-beat time from taps on the beat (quarter notes).
 * Uses the median interval, rejects intervals more than 30% away from it
 * (a missed beat, an interval of about k beats, is counted as k beats), then fits a line.
 * Returns null with fewer than 2 taps.
 */
export function tapTempo(tapTimesSec: number[]): TapTempoResult | null {
  const taps = [...tapTimesSec].sort((a, b) => a - b);
  if (taps.length < 2) return null;
  const intervals = taps.slice(1).map((t, i) => t - taps[i]!);
  const positive = intervals.filter((d) => d > 0.05);
  if (positive.length === 0) return null;
  const med = median(positive);

  // Assign each tap a beat index, tolerating missed beats and rejecting stray taps.
  const idx: number[] = [0];
  const times: number[] = [taps[0]!];
  let rejected = 0;
  let period = med;
  for (let pass = 0; pass < 2; pass++) {
    idx.length = 1;
    times.length = 1;
    rejected = 0;
    let last = taps[0]!;
    let lastIdx = 0;
    for (let i = 1; i < taps.length; i++) {
      const gap = taps[i]! - last;
      const k = Math.round(gap / period);
      if (k >= 1 && Math.abs(gap - k * period) <= 0.3 * period) {
        lastIdx += k;
        idx.push(lastIdx);
        times.push(taps[i]!);
        last = taps[i]!;
      } else {
        rejected++;
      }
    }
    if (times.length >= 2) {
      const fit = fitLine(idx, times);
      period = fit.slope;
    }
  }
  if (times.length < 2) return null;
  const { slope, intercept } = fitLine(idx, times);
  const residuals = times.map((t, i) => t - (intercept + slope * idx[i]!));
  const sd = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / residuals.length);
  return {
    bpm: 60 / slope,
    firstBeatSec: times.length >= 4 ? intercept : times[0]!,
    used: times.length,
    rejected,
    jitterMs: sd * 1000,
  };
}

function fitLine(x: number[], y: number[]): { slope: number; intercept: number } {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i]! - mx) * (y[i]! - my);
    den += (x[i]! - mx) ** 2;
  }
  const slope = den === 0 ? y[1]! - y[0]! : num / den;
  return { slope, intercept: my - slope * mx };
}
