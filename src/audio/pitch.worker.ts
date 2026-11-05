// Pitch detection Worker, spec 9.5. Wraps the pure `yin` function so the
// (somewhat expensive) autocorrelation-style search runs off the main
// thread. Communicates over postMessage only (no SharedArrayBuffer, per
// spec 4.3 rule 4).

import { yin, yinWithCheck, DEFAULT_YIN_OPTIONS, type OctaveCheck } from "./yin";

export interface PitchRequest {
  id: number;
  samples: Float32Array;
  sampleRate: number;
  /** Expected note frequency (Hz); when set, the response carries the octave re-check values. */
  expectedFreq?: number;
}

export interface PitchResponse {
  id: number;
  result: { freq: number; confidence: number } | null;
  check?: OctaveCheck | null;
}

// `self` is typed as `Window & typeof globalThis` when the DOM and WebWorker
// libs are both loaded (as this project's tsconfig does); cast through
// `unknown` to get the DedicatedWorkerGlobalScope-shaped API we actually run
// under, without fighting that lib conflict.
const workerCtx = self as unknown as Worker;

workerCtx.onmessage = (ev: MessageEvent<PitchRequest>): void => {
  const { id, samples, sampleRate, expectedFreq } = ev.data;
  let response: PitchResponse;
  if (expectedFreq !== undefined) {
    const { result, check } = yinWithCheck(samples, sampleRate, expectedFreq, DEFAULT_YIN_OPTIONS);
    response = { id, result, check };
  } else {
    response = { id, result: yin(samples, sampleRate, DEFAULT_YIN_OPTIONS) };
  }
  workerCtx.postMessage(response);
};

export {};
