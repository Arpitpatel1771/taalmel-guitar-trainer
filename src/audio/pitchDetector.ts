// Main-thread facade over pitch.worker.ts, spec 9.5. Not unit-testable in
// Node (module Workers aren't available there); kept type-correct.

import type { PitchRequest, PitchResponse } from "./pitch.worker";

export type PitchResult = { freq: number; confidence: number } | null;

export class PitchDetector {
  private readonly worker: Worker;
  private nextId = 0;
  private readonly pending = new Map<number, (result: PitchResult) => void>();

  constructor() {
    this.worker = new Worker(new URL("./pitch.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (ev: MessageEvent<PitchResponse>) => {
      const { id, result } = ev.data;
      const resolve = this.pending.get(id);
      if (resolve) {
        this.pending.delete(id);
        resolve(result);
      }
    };
  }

  detect(samples: Float32Array, sampleRate: number): Promise<PitchResult> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      const request: PitchRequest = { id, samples, sampleRate };
      this.worker.postMessage(request, [samples.buffer]);
    });
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}
