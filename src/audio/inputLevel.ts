// Live input level logic (spec 5-11-recording-level 1.2-1.3). Pure: fed one
// peak (dBFS) per 50 ms, it keeps a rolling window and a held state. The
// browser tap that produces the peaks lives in levelTap.ts.

/** All tuning constants for the meter, in one place. */
export const LEVEL_CONFIG = {
  /** How often a peak is measured. */
  intervalMs: 50,
  /** The state is decided from the loudest peak in this window. */
  windowMs: 2000,
  /** A new state must hold this long before it is shown (no flapping between notes). */
  holdMs: 1000,
  /** Below this the player is not playing yet. */
  waitingBelowDb: -50,
  /** Below this the level is too quiet. */
  quietBelowDb: -24,
  /** At or above this (about 0.99) the signal is clipping. */
  loudFromDb: -1,
  /** Number of meter bars and the dB range they span. */
  barCount: 5,
  barFloorDb: -60,
  /** Bar fall-off per measurement, in dB (rises are instant). */
  barFallDb: 3,
} as const;

export type LevelState = "waiting" | "tooQuiet" | "good" | "tooLoud";

export interface LevelReading {
  /** The held state to show. */
  state: LevelState;
  /** The latest peak in dBFS (-Infinity for digital silence). */
  peakDb: number;
  /** Lit bars, 0..barCount, following the peak with a short fall-off. */
  bars: number;
}

/** Peak absolute sample in dBFS; -Infinity for silence. */
export function peakDbOf(samples: ArrayLike<number>): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

/** The state a window whose loudest peak is `maxDb` calls for (before the hold). */
export function levelStateFor(maxDb: number): LevelState {
  const c = LEVEL_CONFIG;
  if (maxDb >= c.loudFromDb) return "tooLoud";
  if (maxDb >= c.quietBelowDb) return "good";
  if (maxDb >= c.waitingBelowDb) return "tooQuiet";
  return "waiting";
}

export class LevelMeter {
  private window: { t: number; db: number }[] = [];
  private shown: LevelState = "waiting";
  private candidate: LevelState = "waiting";
  private candidateSince = 0;
  private barDb: number = LEVEL_CONFIG.barFloorDb;

  /** Feeds one peak measured at `nowMs`; returns what the UI should show. */
  push(peakDb: number, nowMs: number): LevelReading {
    const c = LEVEL_CONFIG;
    this.window.push({ t: nowMs, db: peakDb });
    while (this.window.length > 1 && this.window[0].t < nowMs - c.windowMs) this.window.shift();
    const maxDb = this.window.reduce((m, w) => (w.db > m ? w.db : m), -Infinity);

    const raw = levelStateFor(maxDb);
    if (raw !== this.candidate) {
      this.candidate = raw;
      this.candidateSince = nowMs;
    }
    if (this.candidate !== this.shown && nowMs - this.candidateSince >= c.holdMs) this.shown = this.candidate;

    const floored = Math.max(c.barFloorDb, peakDb);
    this.barDb = Math.max(floored, this.barDb - c.barFallDb);
    const bars = Math.round(((this.barDb - c.barFloorDb) / -c.barFloorDb) * c.barCount);
    return { state: this.shown, peakDb, bars: Math.min(c.barCount, Math.max(0, bars)) };
  }

  reset(): void {
    this.window = [];
    this.shown = this.candidate = "waiting";
    this.candidateSince = 0;
    this.barDb = LEVEL_CONFIG.barFloorDb;
  }
}
