// Camera/mic capture and MediaRecorder wrapper. Optionally mixes extra app
// audio (the metronome) into the recorded audio track via the shared
// AudioContext; otherwise the raw mic track is recorded untouched.

import { getAudioContext } from "../audio";
import { pickMimeType } from "./media";

// Music, not speech: browser voice processing mangles instruments.
const MIC_CONSTRAINTS: MediaTrackConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

export async function openInput(video: boolean): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: MIC_CONSTRAINTS,
    video: video ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
  });
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  hasVideo: boolean;
  durationSec: number;
}

export class ClipRecorder {
  private recorder: MediaRecorder;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private mixCleanup: (() => void) | null = null;
  private readonly hasVideo: boolean;
  /** Pass this to FreeMetronome.setExtraOutput to record clicks; null when not mixing. */
  readonly mixInput: AudioNode | null = null;

  constructor(input: MediaStream, mixAppAudio: boolean) {
    this.hasVideo = input.getVideoTracks().length > 0;
    let stream = input;
    if (mixAppAudio) {
      const ctx = getAudioContext();
      const dest = ctx.createMediaStreamDestination();
      const mic = ctx.createMediaStreamSource(input);
      mic.connect(dest);
      this.mixInput = dest;
      this.mixCleanup = () => mic.disconnect();
      stream = new MediaStream([...input.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    }
    const mimeType = pickMimeType(this.hasVideo, (t) => MediaRecorder.isTypeSupported(t));
    this.recorder = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 192_000,
      ...(this.hasVideo ? { videoBitsPerSecond: 5_000_000 } : {}),
    });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
  }

  start(): void {
    this.chunks = [];
    this.startedAt = performance.now();
    this.recorder.start(1000);
  }

  elapsedSec(): number {
    return this.startedAt ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  stop(): Promise<RecordingResult> {
    return new Promise((resolve, reject) => {
      const durationSec = this.elapsedSec();
      this.recorder.onstop = () => {
        this.mixCleanup?.();
        const mimeType = this.recorder.mimeType || this.chunks[0]?.type || "video/webm";
        resolve({ blob: new Blob(this.chunks, { type: mimeType }), mimeType, hasVideo: this.hasVideo, durationSec });
      };
      this.recorder.onerror = (e) => reject((e as unknown as { error?: Error }).error ?? new Error("Recording failed"));
      if (this.recorder.state === "inactive") this.recorder.onstop(new Event("stop"));
      else this.recorder.stop();
    });
  }
}
