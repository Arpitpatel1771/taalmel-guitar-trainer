// Waveform peaks for display: decode a clip's audio once, reduce it to a
// fixed number of peak buckets (0..1), and keep those with the clip.

import { extractMonoPcm } from "./trim";

/** Buckets stored per clip; the canvas resamples them to its pixel width. */
export const PEAK_BUCKETS = 1600;
/** Decoding at a low rate keeps long clips cheap; peaks don't need more. */
const DECODE_RATE = 8000;

/** Max |sample| per bucket, rounded to 3 decimals so stored arrays stay small. */
export function computePeaks(samples: Float32Array, buckets: number): number[] {
  const out = new Array<number>(buckets).fill(0);
  if (samples.length === 0) return out;
  const per = samples.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * per);
    const to = Math.max(from + 1, Math.floor((b + 1) * per));
    let peak = 0;
    for (let i = from; i < to && i < samples.length; i++) {
      const v = Math.abs(samples[i]);
      if (v > peak) peak = v;
    }
    out[b] = Math.round(Math.min(1, peak) * 1000) / 1000;
  }
  return out;
}

/**
 * Resamples stored peaks to `columns` (taking the max of the buckets each
 * column covers) and scales so the loudest part fills the height; quiet
 * recordings stay readable, near-silence isn't blown up to full scale.
 */
export function peaksToColumns(peaks: number[], columns: number): number[] {
  const out = new Array<number>(Math.max(0, columns)).fill(0);
  if (peaks.length === 0 || columns <= 0) return out;
  const max = peaks.reduce((m, p) => (p > m ? p : m), 0);
  const scale = 1 / Math.max(max, 0.1);
  const per = peaks.length / columns;
  for (let c = 0; c < columns; c++) {
    const from = Math.floor(c * per);
    const to = Math.max(from + 1, Math.floor((c + 1) * per));
    let peak = 0;
    for (let i = from; i < to && i < peaks.length; i++) if (peaks[i] > peak) peak = peaks[i];
    out[c] = Math.min(1, peak * scale);
  }
  return out;
}

async function decodeWithWebAudio(blob: Blob): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, 1, DECODE_RATE);
  const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const mono = new Float32Array(buffer.length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
  }
  return mono;
}

/**
 * Peaks for a clip. Tries the browser's decoder first (fast, no download);
 * falls back to ffmpeg.wasm for containers the browser can't decode (e.g.
 * video WebM in some browsers).
 */
export async function computeClipPeaks(blob: Blob, sourceMime: string, hasVideo: boolean): Promise<number[]> {
  let samples: Float32Array;
  try {
    samples = await decodeWithWebAudio(blob);
  } catch {
    samples = await extractMonoPcm(blob, sourceMime, hasVideo, DECODE_RATE);
  }
  return computePeaks(samples, PEAK_BUCKETS);
}
