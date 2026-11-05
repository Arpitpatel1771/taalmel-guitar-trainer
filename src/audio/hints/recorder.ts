// HintRecorder: connects a captured tab-audio stream to the analysis Worker and stamps the
// frames it returns into a `VideoHints` by video time (specs/5-11-piano-roll.md 5.1, 5.2).
// Not unit-testable in Node (AudioWorklet, Worker); the logic that matters (bucketing and
// hole filling) is in `RecordingBuffer`, which is tested.

import hintProcessorUrl from "./hint-processor.ts?worker&url";
import type { HintWorkerResponse } from "./hint.worker";
import { bucketOf, setFrame, type VideoHints } from "./types";

export type HintStatus = "recording" | "paused-own-sounds" | "paused-video" | "stopped";

export interface VideoState {
  /** Current video time, seconds. */
  timeSec: number;
  playing: boolean;
  /** Playback rate (0.25..1); defaults to 1. */
  rate?: number;
}

/** Largest hole (in buckets) filled between consecutive frames of one continuous run. */
const MAX_FILL = 3;

/** Stamps frames into hints; replaces re-recorded buckets and fills tiny timing holes. */
export class RecordingBuffer {
  private lastBucket: number | null = null;

  constructor(readonly hints: VideoHints) {}

  /** Records one frame at a video time. Returns the buckets written. */
  add(videoSec: number, frame: Uint8Array): number[] {
    const bucket = bucketOf(videoSec);
    if (bucket < 0) return [];
    const written: number[] = [];
    const last = this.lastBucket;
    if (last !== null && bucket > last + 1 && bucket - last <= MAX_FILL + 1) {
      for (let b = last + 1; b < bucket; b++) {
        setFrame(this.hints, b, frame);
        written.push(b);
      }
    }
    setFrame(this.hints, bucket, frame);
    written.push(bucket);
    this.lastBucket = bucket;
    return written;
  }

  /** Ends the current run (pause, seek): the next frame will not fill back to the old one. */
  breakRun(): void {
    this.lastBucket = null;
  }
}

export interface HintRecorderOptions {
  stream: MediaStream;
  context: AudioContext;
  /** The hints to record into (load with `loadHints` first so re-recording replaces buckets). */
  hints: VideoHints;
  getVideoState: () => VideoState;
  /** True while Taalmel's own synth or metronome is audible; frames are skipped then. */
  ownSoundsAudible: () => boolean;
  /** Called after frames are stored, e.g. `saver.schedule`. */
  onUpdate?: () => void;
  /** Seconds to subtract from video time to account for capture/player delay. Default 0. */
  latencySec?: number;
}

export class HintRecorder {
  private status: HintStatus = "stopped";
  private readonly statusListeners = new Set<(s: HintStatus) => void>();
  private readonly frameListeners = new Set<(bucket: number, frame: Uint8Array) => void>();
  private readonly buffer: RecordingBuffer;
  private worker: Worker | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private lastTime = -1;

  constructor(private readonly opts: HintRecorderOptions) {
    this.buffer = new RecordingBuffer(opts.hints);
  }

  get currentStatus(): HintStatus {
    return this.status;
  }

  /** Subscribes to status changes; returns the unsubscribe function. */
  subscribe(cb: (status: HintStatus) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  /** Subscribes to each stored frame (for live pitch readouts); returns the unsubscribe function. */
  onFrame(cb: (bucket: number, frame: Uint8Array) => void): () => void {
    this.frameListeners.add(cb);
    return () => this.frameListeners.delete(cb);
  }

  /** Starts analysing. Resolves once audio is flowing; rejects if the worklet cannot load. */
  async start(): Promise<void> {
    if (this.worker) return;
    const { context, stream } = this.opts;
    await context.audioWorklet.addModule(hintProcessorUrl);
    const worker = new Worker(new URL("./hint.worker.ts", import.meta.url), { type: "module" });
    const channel = new MessageChannel();
    worker.postMessage({ type: "init", sampleRate: context.sampleRate, port: channel.port2 }, [channel.port2]);
    worker.onmessage = (ev: MessageEvent<HintWorkerResponse>) => this.handleFrame(ev.data);
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, "hint-processor", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 });
    node.port.postMessage({ port: channel.port1 }, [channel.port1]);
    source.connect(node);
    this.worker = worker;
    this.source = source;
    this.node = node;
    this.setStatus(this.computeStatus());
  }

  /** Stops analysing and releases the capture stream. */
  stop(): void {
    this.source?.disconnect();
    this.node?.disconnect();
    this.worker?.terminate();
    this.opts.stream.getTracks().forEach((t) => t.stop());
    this.source = null;
    this.node = null;
    this.worker = null;
    this.setStatus("stopped");
  }

  private computeStatus(): HintStatus {
    if (!this.worker) return "stopped";
    if (!this.opts.getVideoState().playing) return "paused-video";
    if (this.opts.ownSoundsAudible()) return "paused-own-sounds";
    return "recording";
  }

  private setStatus(next: HintStatus): void {
    if (next === this.status) return;
    this.status = next;
    if (next !== "recording") this.buffer.breakRun();
    this.statusListeners.forEach((cb) => cb(next));
  }

  private handleFrame(msg: HintWorkerResponse): void {
    if (msg.type !== "frame") return;
    this.setStatus(this.computeStatus());
    if (this.status !== "recording") return;
    const state = this.opts.getVideoState();
    // The frame ended `age` real seconds ago; the video advanced `age * rate` in that time.
    const age = Math.max(0, this.opts.context.currentTime - msg.endTime);
    const videoSec = state.timeSec - age * (state.rate ?? 1) - (this.opts.latencySec ?? 0);
    // A backwards jump (seek, loop) starts a new run.
    if (videoSec < this.lastTime - 0.05 || videoSec > this.lastTime + 0.5) this.buffer.breakRun();
    this.lastTime = videoSec;
    const written = this.buffer.add(videoSec, msg.frame);
    if (written.length === 0) return;
    this.opts.onUpdate?.();
    this.frameListeners.forEach((cb) => cb(written[written.length - 1], msg.frame));
  }
}
