// Playing a clip with its volume boost, and baking the boost into the file
// (spec 5-11-recording-level 2.3-2.4).

import { buildBoostPlan } from "./media";
import { replaceClipMedia, type ClipRecord } from "./clipStore";
import { computeClipPeaks } from "./waveform";
import { runFfmpegPlan, type TrimStage } from "./trim";

/** Linear gain for `gainDb`; 1 when the boost is off. */
export function gainFactor(gainDb: number | undefined, boost: boolean | undefined): number {
  return boost && gainDb && gainDb > 0 ? 10 ** (gainDb / 20) : 1;
}

/** The boost to play with: `gainDb` when the clip's boost is on, else 0. */
export function effectiveGainDb(clip: Pick<ClipRecord, "gainDb" | "boost">): number {
  return clip.boost && clip.gainDb && clip.gainDb > 0 ? clip.gainDb : 0;
}

/** Waveform peaks scaled by the boost, so the drawing matches what you hear (capped at 1). */
export function scalePeaks(peaks: number[], gainDb: number): number[] {
  if (gainDb <= 0) return peaks;
  const k = 10 ** (gainDb / 20);
  return peaks.map((p) => Math.min(1, p * k));
}

export interface BoostedPlayback {
  /** Sets the boost in dB (0 = unboosted). */
  setGainDb(gainDb: number): void;
  /** Detaches the nodes. The element can't be routed again afterwards (a browser limit), so only call on unmount. */
  dispose(): void;
}

// A media element can only ever have one MediaElementAudioSourceNode.
const routed = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

/**
 * Routes `el` through Web Audio: MediaElementAudioSourceNode -> GainNode ->
 * destination (`el.volume` can't exceed 1). Reuses the element's source node
 * if it was routed before.
 */
export function routeMediaThroughGain(ctx: AudioContext, el: HTMLMediaElement, gainDb = 0): BoostedPlayback {
  let entry = routed.get(el);
  if (!entry) {
    entry = ctx.createMediaElementSource(el);
    routed.set(el, entry);
  }
  const gain = ctx.createGain();
  gain.gain.value = gainFactor(gainDb, true);
  entry.disconnect();
  entry.connect(gain);
  gain.connect(ctx.destination);
  return {
    setGainDb(db) {
      gain.gain.setTargetAtTime(gainFactor(db, true), ctx.currentTime, 0.01);
    },
    dispose() {
      entry.disconnect();
      gain.disconnect();
    },
  };
}

export type BoostStage = TrimStage;

/**
 * Makes the boost permanent: re-encodes the audio louder (video copied),
 * replaces the local media (bumping `mediaRev` so sync updates the same Drive
 * file), sets gainDb 0 and boost off, and recomputes the waveform peaks.
 * Needs the media on this device (`clip.blob`).
 */
export async function makeBoostPermanent(
  clip: ClipRecord,
  onProgress?: (stage: BoostStage, fraction: number | null) => void
): Promise<ClipRecord> {
  if (!clip.blob) throw new Error("Download the clip first.");
  const gainDb = effectiveGainDb({ gainDb: clip.gainDb, boost: true });
  if (gainDb <= 0) throw new Error("This clip has no boost to apply.");
  const plan = buildBoostPlan({ sourceMime: clip.mimeType, hasVideo: clip.hasVideo, gainDb });
  const { blob, mimeType } = await runFfmpegPlan(clip.blob, plan, onProgress);
  const peaks = await computeClipPeaks(blob, mimeType, clip.hasVideo).catch(() => undefined);
  return replaceClipMedia(clip.id, blob, { gainDb: 0, boost: false, mimeType, ...(peaks ? { peaks } : {}) });
}
