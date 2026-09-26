// Bundled by Vite as a standalone chunk (OnsetDetector inlined) and resolved
// to its URL, so the worklet loads in both dev and production builds.
import envelopeProcessorUrl from "./envelope-processor.ts?worker&url";

// Microphone capture, spec 9.1. Wires getUserMedia to the envelope-processor
// AudioWorklet and republishes its MessagePort events as typed callbacks.
// Not unit-testable in Node (requires real getUserMedia/AudioWorklet); kept
// type-correct and exercised manually per spec 14.3.

export type MicErrorKind = "denied" | "nodevice" | "other";

export class MicError extends Error {
  readonly kind: MicErrorKind;

  constructor(kind: MicErrorKind, message?: string) {
    super(message ?? kind);
    this.name = "MicError";
    this.kind = kind;
  }
}

export interface EnvelopeBatch {
  frameStart: number;
  rms: number[];
}

type EnvelopeCb = (p: EnvelopeBatch) => void;
type OnsetCb = (frame: number) => void;
type SliceCb = (onsetFrame: number, samples: Float32Array) => void;

interface PortMessage {
  type: "envelope" | "onset" | "slice";
  frameStart?: number;
  rms?: number[];
  frame?: number;
  onsetFrame?: number;
  samples?: Float32Array;
}

/** getUserMedia constraints per spec 9.1: defaults are tuned for voice calls
 * and damage guitar onsets, so every processing option is disabled. */
const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  },
};

export class MicInput {
  private envelopeCb: EnvelopeCb | null = null;
  private onsetCb: OnsetCb | null = null;
  private sliceCb: SliceCb | null = null;

  private constructor(
    private readonly ctx: AudioContext,
    private readonly stream: MediaStream,
    private readonly source: MediaStreamAudioSourceNode,
    private readonly node: AudioWorkletNode
  ) {
    this.node.port.onmessage = (ev: MessageEvent<PortMessage>) => this.handleMessage(ev.data);
  }

  get sampleRate(): number {
    return this.ctx.sampleRate;
  }

  static async start(ctx: AudioContext): Promise<MicInput> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    } catch (err) {
      throw MicInput.toMicError(err);
    }

    try {
      await ctx.audioWorklet.addModule(envelopeProcessorUrl);
    } catch (err) {
      stream.getTracks().forEach((track) => track.stop());
      throw new MicError("other", err instanceof Error ? err.message : String(err));
    }

    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "envelope-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
    });
    source.connect(node);

    return new MicInput(ctx, stream, source, node);
  }

  private static toMicError(err: unknown): MicError {
    if (err instanceof Error) {
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError" || err.name === "SecurityError") {
        return new MicError("denied", err.message);
      }
      if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError" || err.name === "OverconstrainedError") {
        return new MicError("nodevice", err.message);
      }
      return new MicError("other", err.message);
    }
    return new MicError("other", String(err));
  }

  private handleMessage(data: PortMessage): void {
    if (data.type === "envelope" && this.envelopeCb) {
      this.envelopeCb({ frameStart: data.frameStart ?? 0, rms: data.rms ?? [] });
    } else if (data.type === "onset" && this.onsetCb) {
      this.onsetCb(data.frame ?? 0);
    } else if (data.type === "slice" && this.sliceCb && data.samples) {
      this.sliceCb(data.onsetFrame ?? 0, data.samples);
    }
  }

  onEnvelope(cb: EnvelopeCb): void {
    this.envelopeCb = cb;
  }

  onOnset(cb: OnsetCb): void {
    this.onsetCb = cb;
  }

  onSlice(cb: SliceCb): void {
    this.sliceCb = cb;
  }

  stop(): void {
    this.node.port.onmessage = null;
    this.node.disconnect();
    this.source.disconnect();
    this.stream.getTracks().forEach((track) => track.stop());
  }
}
