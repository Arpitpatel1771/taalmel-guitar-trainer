// Streaming wrapper around the filter bank: feed sample blocks, get one whitened frame per hop
// (20 ms), each with the audio-context time its window ended. Pure; the Worker wraps it.

import { FilterBank, whitenFrame } from "./bank";
import { HINT_FRAME_RATE } from "./constants";

export interface StreamFrame {
  frame: Uint8Array;
  /** AudioContext time at the end of the frame's window, seconds. */
  endTime: number;
}

export class StreamAnalyzer {
  private readonly bank: FilterBank;
  private readonly hop: number;
  private readonly ring: Float32Array;
  private total = 0;
  private nextEnd: number;

  constructor(readonly sampleRate: number) {
    this.bank = new FilterBank(sampleRate);
    this.hop = Math.round(sampleRate / HINT_FRAME_RATE);
    this.ring = new Float32Array(this.bank.maxLength + this.hop * 4);
    this.nextEnd = this.bank.maxLength;
  }

  /** Adds a block whose last sample is at AudioContext time `endTime`; returns the frames it completed. */
  push(samples: Float32Array, endTime: number): StreamFrame[] {
    const size = this.ring.length;
    const base = this.total;
    for (let i = 0; i < samples.length; i++) this.ring[(base + i) % size] = samples[i];
    this.total += samples.length;
    const out: StreamFrame[] = [];
    const scratch = new Float32Array(this.bank.maxLength);
    while (this.nextEnd <= this.total) {
      const end = this.nextEnd;
      for (let i = 0; i < scratch.length; i++) scratch[i] = this.ring[(end - scratch.length + i + size) % size];
      out.push({
        frame: whitenFrame(this.bank.analyze(scratch)),
        endTime: endTime - (this.total - end) / this.sampleRate,
      });
      this.nextEnd += this.hop;
    }
    return out;
  }
}
