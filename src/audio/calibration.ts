// Calibration, spec 9.7. `computeCalibration` is the pure, tested core;
// `runLoopbackCalibration`/`runTapCalibration` drive it against real
// hardware and are not unit-testable in Node.

import { median } from "./mathUtils";
import { scheduleClick } from "./metronome";
import type { MicInput } from "./micInput";

export interface CalibrationConfig {
  /** Number of clicks played (8). */
  clickCount: number;
  /** Seconds between clicks (1.0). */
  intervalSec: number;
  /** Minimum clicks that must be detected to pass (6 of 8). */
  minDetected: number;
  /** Maximum allowed median absolute deviation, in ms (10). */
  maxMadMs: number;
}

export const DEFAULT_CALIBRATION_CONFIG: CalibrationConfig = {
  clickCount: 8,
  intervalSec: 1.0,
  minDetected: 6,
  maxMadMs: 10,
};

export type CalibrationResult =
  | { ok: true; latencyMs: number; detected: number }
  | { ok: false; reason: string };

/**
 * Pairs each scheduled click time (AudioContext seconds) with the nearest
 * unused detected onset time, then checks the spec 9.7 pass rules: at least
 * `minDetected` of `clickCount` clicks found, and median absolute deviation
 * of the offsets under `maxMadMs`. All times are in the same clock (audio
 * context seconds); latency = median(detected - scheduled).
 */
export function computeCalibration(
  scheduled: number[],
  detected: number[],
  config: CalibrationConfig = DEFAULT_CALIBRATION_CONFIG
): CalibrationResult {
  const used = new Set<number>();
  const offsets: number[] = [];

  for (const s of scheduled) {
    let bestIdx = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < detected.length; i++) {
      if (used.has(i)) continue;
      const diff = Math.abs(detected[i] - s);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }
    // Only accept a pairing reasonably close to its own click slot, so a
    // stray onset can't get claimed by a distant, already-missed click.
    if (bestIdx !== -1 && bestDiff < config.intervalSec / 2) {
      used.add(bestIdx);
      offsets.push(detected[bestIdx] - s);
    }
  }

  if (offsets.length < config.minDetected) {
    return {
      ok: false,
      reason: `Only ${offsets.length} of ${scheduled.length} clicks were detected (need at least ${config.minDetected}).`,
    };
  }

  const med = median(offsets);
  const madMs = median(offsets.map((o) => Math.abs(o - med))) * 1000;
  if (madMs > config.maxMadMs) {
    return {
      ok: false,
      reason: `Timing was too inconsistent (median deviation ${madMs.toFixed(1)} ms, need <= ${config.maxMadMs} ms).`,
    };
  }

  return { ok: true, latencyMs: med * 1000, detected: offsets.length };
}

async function runClickBasedCalibration(
  ctx: AudioContext,
  mic: MicInput,
  config: CalibrationConfig
): Promise<CalibrationResult> {
  const startAt = ctx.currentTime + 0.2;
  const scheduled: number[] = [];
  for (let i = 0; i < config.clickCount; i++) {
    const t = startAt + i * config.intervalSec;
    scheduled.push(t);
    scheduleClick(ctx, t, true, 1);
  }

  const detected: number[] = [];
  mic.onOnset((frame) => detected.push(frame / mic.sampleRate));

  const totalWaitMs = (config.clickCount * config.intervalSec + 1) * 1000;
  await new Promise<void>((resolve) => setTimeout(resolve, totalWaitMs));

  return computeCalibration(scheduled, detected, config);
}

/**
 * Speaker loopback method (primary, spec 9.7): plays clicks through the
 * speakers and listens for them in the mic signal. Measures output + input
 * latency without the player's own timing bias.
 */
export function runLoopbackCalibration(
  ctx: AudioContext,
  mic: MicInput,
  config: CalibrationConfig = DEFAULT_CALIBRATION_CONFIG
): Promise<CalibrationResult> {
  return runClickBasedCalibration(ctx, mic, config);
}

/**
 * Tap fallback method (headphones, spec 9.7): same click schedule, but the
 * user plucks a muted string on each click rather than the speaker looping
 * back automatically. Less accurate (absorbs the player's own timing bias);
 * callers should label results from this method accordingly.
 */
export function runTapCalibration(
  ctx: AudioContext,
  mic: MicInput,
  config: CalibrationConfig = DEFAULT_CALIBRATION_CONFIG
): Promise<CalibrationResult> {
  return runClickBasedCalibration(ctx, mic, config);
}
