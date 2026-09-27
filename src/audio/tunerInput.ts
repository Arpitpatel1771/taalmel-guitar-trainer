// Continuous pitch capture for the tuner (browser only). Mic -> AnalyserNode,
// polled ~20 times a second; each frame runs YIN on the main thread (4096
// samples is cheap) and results are median-smoothed over the last 5 frames.

import { MIC_CONSTRAINTS, MicError } from "./micInput";
import { median } from "./tuner";
import { yin } from "./yin";

const POLL_MS = 50;
const SMOOTH = 5;
const MIN_RMS = 0.004; // below this, treat as silence

export class TunerInput {
  private timer: number | null = null;
  private recent: number[] = [];

  private constructor(
    private readonly ctx: AudioContext,
    private readonly stream: MediaStream,
    private readonly source: MediaStreamAudioSourceNode,
    private readonly analyser: AnalyserNode,
  ) {}

  static async start(ctx: AudioContext, onPitch: (freq: number | null, level: number) => void): Promise<TunerInput> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    } catch (err) {
      const e = err as { name?: string; message?: string };
      const kind = e.name === "NotAllowedError" ? "denied" : e.name === "NotFoundError" ? "nodevice" : "other";
      throw new MicError(kind, e.message ?? String(err));
    }
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    source.connect(analyser);
    const t = new TunerInput(ctx, stream, source, analyser);
    t.run(onPitch);
    return t;
  }

  private run(onPitch: (freq: number | null, level: number) => void): void {
    const buf = new Float32Array(this.analyser.fftSize);
    this.timer = window.setInterval(() => {
      this.analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const level = Math.max(0, Math.min(1, (20 * Math.log10(Math.max(rms, 1e-6)) + 60) / 60));
      const est = rms >= MIN_RMS ? yin(buf, this.ctx.sampleRate) : null;
      if (!est || est.confidence < 0.8) {
        this.recent = [];
        onPitch(null, level);
        return;
      }
      this.recent.push(est.freq);
      if (this.recent.length > SMOOTH) this.recent.shift();
      onPitch(median(this.recent), level);
    }, POLL_MS);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.source.disconnect();
    this.stream.getTracks().forEach((tr) => tr.stop());
  }
}
