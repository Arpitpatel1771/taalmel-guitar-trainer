import { describe, expect, it } from "vitest";
import { computePeaks, peaksToColumns } from "./waveform";

describe("waveform peaks", () => {
  it("takes the max absolute sample per bucket", () => {
    const samples = new Float32Array([0.1, -0.5, 0.2, 0.3, -0.9, 0.05, 0, 0]);
    expect(computePeaks(samples, 4)).toEqual([0.5, 0.3, 0.9, 0]);
  });

  it("handles more buckets than samples and empty input", () => {
    expect(computePeaks(new Float32Array([0.4, -0.8]), 4)).toEqual([0.4, 0.4, 0.8, 0.8]);
    expect(computePeaks(new Float32Array(0), 3)).toEqual([0, 0, 0]);
  });

  it("clamps and rounds to 3 decimals", () => {
    expect(computePeaks(new Float32Array([1.7, 0.12345]), 2)).toEqual([1, 0.123]);
  });

  it("resamples to columns and normalises to the loudest peak", () => {
    expect(peaksToColumns([0.1, 0.2, 0.4, 0.2], 2)).toEqual([0.5, 1]);
    expect(peaksToColumns([0.5], 3)).toEqual([1, 1, 1]);
  });

  it("does not blow near-silence up to full height", () => {
    const cols = peaksToColumns([0.01, 0.02], 2);
    expect(cols[1]).toBeCloseTo(0.2);
  });
});
