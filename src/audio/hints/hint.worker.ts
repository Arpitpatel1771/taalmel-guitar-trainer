// Analysis Worker: receives sample blocks straight from the HintProcessor worklet (over a
// transferred MessagePort) and posts whitened frames to the main thread.

import { StreamAnalyzer } from "./streamAnalyzer";

export type HintWorkerRequest = { type: "init"; sampleRate: number; port: MessagePort };
export type HintWorkerResponse = { type: "frame"; frame: Uint8Array; endTime: number };

const workerCtx = self as unknown as Worker;

workerCtx.onmessage = (ev: MessageEvent<HintWorkerRequest>): void => {
  if (ev.data.type !== "init") return;
  const analyzer = new StreamAnalyzer(ev.data.sampleRate);
  ev.data.port.onmessage = (m: MessageEvent<{ samples: Float32Array; endTime: number }>) => {
    for (const f of analyzer.push(m.data.samples, m.data.endTime)) {
      const msg: HintWorkerResponse = { type: "frame", frame: f.frame, endTime: f.endTime };
      workerCtx.postMessage(msg, [f.frame.buffer]);
    }
  };
};

export {};
