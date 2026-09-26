// AudioWorklet processor, spec 9.2/9.3. Runs in the AudioWorkletGlobalScope
// (a separate realm from the main thread and from Node). All detection logic
// lives in the plain, testable OnsetDetector class; this file only adapts it
// to the worklet's process() callback and batches results over the
// MessagePort.
//
// This module must stay self-contained (no imports reaching outside
// src/audio) so Vite can bundle it standalone when the main thread loads it
// via `new URL("./envelope-processor.ts", import.meta.url)` +
// `audioContext.audioWorklet.addModule(url)`.
/// <reference path="./worklet-types.d.ts" />

import { OnsetDetector, DEFAULT_ONSET_CONFIG } from "./onsetDetector";

/** Target batch size for envelope points posted over the port (spec 9.2). */
const ENVELOPE_BATCH_INTERVAL_SEC = 0.01;

class EnvelopeProcessor extends AudioWorkletProcessor {
  private detector: OnsetDetector;
  private batchRms: number[] = [];
  private batchFrameStart: number | null = null;

  constructor(options?: unknown) {
    super(options);
    this.detector = new OnsetDetector(sampleRate, DEFAULT_ONSET_CONFIG);
  }

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (!channel || channel.length === 0) {
      return true;
    }

    const frame = currentFrame;
    const result = this.detector.process(channel, frame);

    if (this.batchFrameStart === null) this.batchFrameStart = frame;
    this.batchRms.push(result.rms);
    const elapsedSec = (frame - this.batchFrameStart + channel.length) / sampleRate;
    if (elapsedSec >= ENVELOPE_BATCH_INTERVAL_SEC) {
      this.port.postMessage({
        type: "envelope",
        frameStart: this.batchFrameStart,
        rms: this.batchRms,
      });
      this.batchRms = [];
      this.batchFrameStart = null;
    }

    if (result.onsetFrame !== null) {
      this.port.postMessage({ type: "onset", frame: result.onsetFrame });
    }

    if (result.slice) {
      const samples = result.slice.samples;
      this.port.postMessage(
        { type: "slice", onsetFrame: result.slice.onsetFrame, samples },
        [samples.buffer]
      );
    }

    return true;
  }
}

registerProcessor("envelope-processor", EnvelopeProcessor);
