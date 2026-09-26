// Plain (non-worklet) onset detector, spec 9.2/9.3. Kept as an ordinary class
// with no AudioWorkletGlobalScope dependencies so it is usable both from the
// worklet (envelope-processor.ts) and directly from Node tests.
//
// Call `process()` once per 128-sample render quantum, in order, with the
// absolute sample frame (AudioWorklet's `currentFrame`) of the first sample
// in the block.

import { median, rms } from "./mathUtils";

/** All tunable thresholds live in one place per spec 9.3. */
export interface OnsetConfig {
  /** Samples per RMS analysis frame. Matches the Web Audio render quantum. */
  frameSize: number;
  /** How long (seconds) to sample the noise floor at start-up. */
  noiseFloorInitSec: number;
  /** EMA rate used to slowly track the noise floor after start-up. */
  noiseFloorEmaAlpha: number;
  /** Onset requires RMS > noiseFloor * this multiplier (~4, i.e. +12 dB). */
  onsetFloorMultiplier: number;
  /** Onset requires RMS > recentAverage * this multiplier (1.8). */
  onsetRecentMultiplier: number;
  /** Window (seconds) used to compute the "recent average" (~30 ms). */
  recentAverageWindowSec: number;
  /** Minimum time (seconds) between onsets (50 ms). */
  refractorySec: number;
  /** Slice starts this many seconds after the onset frame (10 ms). */
  sliceOffsetSec: number;
  /** Slice length in samples (2048). */
  sliceLength: number;
}

export const DEFAULT_ONSET_CONFIG: OnsetConfig = {
  frameSize: 128,
  noiseFloorInitSec: 1.0,
  noiseFloorEmaAlpha: 0.05,
  onsetFloorMultiplier: 4,
  onsetRecentMultiplier: 1.8,
  recentAverageWindowSec: 0.03,
  refractorySec: 0.05,
  sliceOffsetSec: 0.01,
  sliceLength: 2048,
};

export interface OnsetSlice {
  onsetFrame: number;
  samples: Float32Array;
}

export interface OnsetProcessResult {
  /** RMS of the block just processed. */
  rms: number;
  /** Set to the onset's start frame when this block contains a new onset. */
  onsetFrame: number | null;
  /** Set once enough audio has accumulated to satisfy a pending onset's slice. */
  slice: OnsetSlice | null;
}

interface BlockRecord {
  frame: number;
  samples: Float32Array;
  rms: number;
}

/**
 * RMS-envelope onset detector (spec 9.3):
 *  - Noise floor: median RMS over the first ~1s, then a slow EMA of quiet
 *    frames after that.
 *  - Onset: RMS exceeds both `noiseFloor * onsetFloorMultiplier` and
 *    `recentAverage * onsetRecentMultiplier`, and RMS is rising.
 *  - Refractory period after each onset.
 *  - On each onset, buffers raw samples until it can slice out
 *    `sliceLength` samples starting `sliceOffsetSec` after the onset.
 */
export class OnsetDetector {
  private readonly cfg: OnsetConfig;
  private readonly sampleRate: number;
  private readonly initBlockCount: number;
  private readonly recentWindowBlocks: number;

  private history: BlockRecord[] = [];
  private initSamples: number[] = [];
  private noiseFloor = 0;
  private noiseFloorReady = false;
  private lastOnsetFrame = -Infinity;
  /** Onsets detected but not yet sliced, oldest first. Refractory gating is
   * purely time-based (spec 9.3); this queue only tracks slice extraction,
   * so back-to-back onsets are never suppressed just because the previous
   * one's slice hasn't finished buffering yet. */
  private pendingOnsets: number[] = [];

  constructor(sampleRate: number, cfg: OnsetConfig = DEFAULT_ONSET_CONFIG) {
    this.sampleRate = sampleRate;
    this.cfg = cfg;
    this.initBlockCount = Math.max(1, Math.round((cfg.noiseFloorInitSec * sampleRate) / cfg.frameSize));
    this.recentWindowBlocks = Math.max(1, Math.round((cfg.recentAverageWindowSec * sampleRate) / cfg.frameSize));
  }

  /** Resets all learned state (noise floor, history, pending slice). */
  reset(): void {
    this.history = [];
    this.initSamples = [];
    this.noiseFloor = 0;
    this.noiseFloorReady = false;
    this.lastOnsetFrame = -Infinity;
    this.pendingOnsets = [];
  }

  /**
   * Processes one block of samples. `frame` is the absolute sample index of
   * `block[0]` (monotonically increasing, spacing equal to block length).
   */
  process(block: Float32Array, frame: number): OnsetProcessResult {
    const blockRms = rms(block);
    this.history.push({ frame, samples: block, rms: blockRms });

    let onsetFrame: number | null = null;

    if (!this.noiseFloorReady) {
      this.initSamples.push(blockRms);
      if (this.initSamples.length >= this.initBlockCount) {
        this.noiseFloor = median(this.initSamples);
        this.noiseFloorReady = true;
        this.initSamples = [];
      }
    } else {
      const recentAverage = this.recentAverage();
      const prevRms = this.history.length >= 2 ? this.history[this.history.length - 2].rms : 0;
      const isRising = blockRms > prevRms;
      const framesSinceLastOnset = frame - this.lastOnsetFrame;
      const refractorySamples = this.cfg.refractorySec * this.sampleRate;
      const exceedsFloor = blockRms > this.noiseFloor * this.cfg.onsetFloorMultiplier;
      const exceedsRecent = blockRms > recentAverage * this.cfg.onsetRecentMultiplier;

      if (exceedsFloor && exceedsRecent && isRising && framesSinceLastOnset > refractorySamples) {
        onsetFrame = frame;
        this.lastOnsetFrame = frame;
        this.pendingOnsets.push(frame);
      } else if (!exceedsFloor) {
        // Quiet frame: slowly adapt the noise floor to ambient changes.
        this.noiseFloor =
          this.noiseFloor * (1 - this.cfg.noiseFloorEmaAlpha) + blockRms * this.cfg.noiseFloorEmaAlpha;
      }
    }

    const slice = this.tryExtractSlice();
    this.trimHistory();

    return { rms: blockRms, onsetFrame, slice };
  }

  private recentAverage(): number {
    const n = this.history.length;
    if (n <= 1) return 0;
    const end = n - 1; // exclude the current (just-pushed) block
    const start = Math.max(0, end - this.recentWindowBlocks);
    let sum = 0;
    let count = 0;
    for (let i = start; i < end; i++) {
      sum += this.history[i].rms;
      count++;
    }
    return count > 0 ? sum / count : 0;
  }

  private tryExtractSlice(): OnsetSlice | null {
    // At most one slice completes per process() call. Multiple onsets can be
    // queued at once; they are served oldest-first on later calls once
    // enough audio has buffered for each in turn.
    if (this.pendingOnsets.length === 0) return null;
    const onsetFrame = this.pendingOnsets[0];
    const startFrame = onsetFrame + Math.round(this.cfg.sliceOffsetSec * this.sampleRate);
    const endFrame = startFrame + this.cfg.sliceLength;

    const last = this.history[this.history.length - 1];
    const bufferedEnd = last ? last.frame + last.samples.length : 0;
    if (bufferedEnd < endFrame) return null; // not enough audio buffered yet

    const out = new Float32Array(this.cfg.sliceLength);
    for (const rec of this.history) {
      const recEnd = rec.frame + rec.samples.length;
      if (recEnd <= startFrame) continue;
      if (rec.frame >= endFrame) break;
      const overlapStart = Math.max(startFrame, rec.frame);
      const overlapEnd = Math.min(endFrame, recEnd);
      for (let f = overlapStart; f < overlapEnd; f++) {
        out[f - startFrame] = rec.samples[f - rec.frame];
      }
    }

    this.pendingOnsets.shift();
    return { onsetFrame, samples: out };
  }

  private trimHistory(): void {
    if (this.history.length === 0) return;
    const lastFrame = this.history[this.history.length - 1].frame;
    const recentBound = lastFrame - this.recentWindowBlocks * this.cfg.frameSize;
    const pendingBound = this.pendingOnsets.length > 0 ? this.pendingOnsets[0] : Infinity;
    const keepFrom = Math.min(recentBound, pendingBound);
    while (this.history.length > 1 && this.history[0].frame + this.history[0].samples.length <= keepFrom) {
      this.history.shift();
    }
  }
}
