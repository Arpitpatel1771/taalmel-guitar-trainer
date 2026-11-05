// Volume boost measurement (spec 5-11-recording-level 2.1): how many dB a
// clip can be raised so it plays at a healthy level without clipping.

import { extractMonoPcm } from "./trim";
import { updateClipGain, type ClipRecord } from "./clipStore";

/** Loudness the boost aims for (RMS over the parts being played), dBFS. */
export const TARGET_RMS_DB = -16;
/** The boosted peak never goes past this, dBFS. */
export const CEILING_DB = -1;
export const MAX_GAIN_DB = 24;
/** Gains under this are not worth applying: stored as 0. */
export const MIN_GAIN_DB = 1;
/** Blocks quieter than this don't count towards the active RMS (silence before/after playing). */
export const ACTIVE_FLOOR_DB = -50;
const BLOCK_SEC = 0.05;
/** Decoding rate for measuring; loudness doesn't need more. */
const MEASURE_RATE = 16000;

/** Boost in dB for mono samples: 0 when silent or already loud enough, else 1..24. */
export function computeGainDb(samples: Float32Array, sampleRate: number): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  if (peak === 0) return 0;
  const peakDb = 20 * Math.log10(peak);

  const block = Math.max(1, Math.round(sampleRate * BLOCK_SEC));
  const floorPower = 10 ** (ACTIVE_FLOOR_DB / 10);
  let sum = 0;
  let count = 0;
  for (let from = 0; from < samples.length; from += block) {
    const to = Math.min(samples.length, from + block);
    let s = 0;
    for (let i = from; i < to; i++) s += samples[i] * samples[i];
    if (s / (to - from) >= floorPower) {
      sum += s;
      count += to - from;
    }
  }
  if (count === 0) return 0;
  const activeRmsDb = 10 * Math.log10(sum / count);

  const gain = Math.min(TARGET_RMS_DB - activeRmsDb, CEILING_DB - peakDb);
  const clamped = Math.min(MAX_GAIN_DB, Math.max(0, gain));
  return clamped < MIN_GAIN_DB ? 0 : Math.round(clamped * 10) / 10;
}

async function decodeMono(blob: Blob): Promise<{ samples: Float32Array; sampleRate: number }> {
  const ctx = new OfflineAudioContext(1, 1, MEASURE_RATE);
  const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
  const mono = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
  }
  return { samples: mono, sampleRate: buffer.sampleRate };
}

/** Measures a clip's boost. Decodes in the browser; falls back to ffmpeg audio extraction (lazy-loaded). */
export async function measureClipGain(blob: Blob, sourceMime = blob.type, hasVideo = false): Promise<number> {
  try {
    const { samples, sampleRate } = await decodeMono(blob);
    return computeGainDb(samples, sampleRate);
  } catch {
    return computeGainDb(await extractMonoPcm(blob, sourceMime, hasVideo, MEASURE_RATE), MEASURE_RATE);
  }
}

/**
 * Measures a clip that has no `gainDb` yet and stores it. Call after saving a
 * new clip, or lazily the first time an older clip is opened. Older clips keep
 * `boost` off until the user turns it on; new clips already have it on.
 * Returns the gain, or null when there was nothing to measure.
 */
export async function ensureClipGain(clip: ClipRecord): Promise<number | null> {
  if (clip.gainDb !== undefined) return clip.gainDb;
  if (!clip.blob) return null;
  const gainDb = await measureClipGain(clip.blob, clip.mimeType, clip.hasVideo);
  await updateClipGain(clip.id, gainDb);
  return gainDb;
}
