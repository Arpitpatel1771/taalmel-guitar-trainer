import { describe, expect, it } from "vitest";
import { computeCalibration, DEFAULT_CALIBRATION_CONFIG } from "./calibration";

function scheduledClicks(count: number, intervalSec = 1.0, startAt = 0.2): number[] {
  return Array.from({ length: count }, (_, i) => startAt + i * intervalSec);
}

describe("computeCalibration", () => {
  it("passes with a consistent latency across all 8 clicks", () => {
    const scheduled = scheduledClicks(8);
    const latencyTruth = 0.045; // 45ms
    const detected = scheduled.map((t) => t + latencyTruth);

    const result = computeCalibration(scheduled, detected);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.detected).toBe(8);
      expect(result.latencyMs).toBeCloseTo(45, 0);
    }
  });

  it("passes with small jitter as long as the median absolute deviation stays under 10ms", () => {
    const scheduled = scheduledClicks(8);
    const jitterMs = [40, 42, 38, 41, 39, 44, 37, 43]; // spread a few ms, MAD well under 10ms
    const detected = scheduled.map((t, i) => t + jitterMs[i] / 1000);

    const result = computeCalibration(scheduled, detected);

    expect(result.ok).toBe(true);
  });

  it("fails when fewer than 6 of 8 clicks are detected", () => {
    const scheduled = scheduledClicks(8);
    // Only 5 of the 8 clicks got a matching onset.
    const detected = scheduled.slice(0, 5).map((t) => t + 0.04);

    const result = computeCalibration(scheduled, detected);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/5 of 8/);
    }
  });

  it("fails when the median absolute deviation is 10ms or more even with all 8 detected", () => {
    const scheduled = scheduledClicks(8);
    // Wildly inconsistent offsets: median ~40ms but scattered +-40ms around it.
    const offsetsMs = [0, 80, 5, 75, 10, 70, 0, 80];
    const detected = scheduled.map((t, i) => t + offsetsMs[i] / 1000);

    const result = computeCalibration(scheduled, detected);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/inconsistent/i);
    }
  });

  it("exactly 6 of 8 detected with tight timing passes (boundary case)", () => {
    const scheduled = scheduledClicks(8);
    // Two clicks produced no onset at all (missing from `detected`).
    const detected = [0, 1, 3, 4, 6, 7].map((i) => scheduled[i] + 0.05);

    const result = computeCalibration(scheduled, detected);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.detected).toBe(6);
      expect(result.latencyMs).toBeCloseTo(50, 0);
    }
  });

  it("does not let a stray onset far from every click get paired in", () => {
    // 8 clicks scheduled, all 8 got a real, close onset, plus two stray
    // onsets (e.g. incidental noise) well outside the whole click window on
    // either side. Pairing is capped at interval/2 from a given scheduled
    // click, so the strays must not be absorbed into the result.
    const scheduled = scheduledClicks(8);
    const real = scheduled.map((t) => t + 0.04);
    const strays = [scheduled[0] - 2.0, scheduled[7] + 2.0];
    const detected = [...real, ...strays];

    const result = computeCalibration(scheduled, detected, DEFAULT_CALIBRATION_CONFIG);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.detected).toBe(8);
      expect(result.latencyMs).toBeCloseTo(40, 0);
    }
  });
});
