// Browser side of the level meter: reads peaks from an AnalyserNode attached
// to an existing mic stream or node. Never opens its own getUserMedia and
// never connects to the speakers.

import { LEVEL_CONFIG, peakDbOf } from "./inputLevel";

export type LevelSource = MediaStream | AudioNode;

/**
 * Calls `onPeak(peakDb)` every LEVEL_CONFIG.intervalMs with the loudest
 * sample of the latest audio. Returns a function that stops and detaches.
 */
export function startLevelTap(ctx: AudioContext, source: LevelSource, onPeak: (peakDb: number) => void): () => void {
  const node = source instanceof MediaStream ? ctx.createMediaStreamSource(source) : source;
  const analyser = ctx.createAnalyser();
  // Two intervals of audio, so nothing falls between two reads.
  analyser.fftSize = 4096;
  node.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const window = Math.min(buf.length, Math.ceil((ctx.sampleRate * LEVEL_CONFIG.intervalMs) / 1000));
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    onPeak(peakDbOf(buf.subarray(buf.length - window)));
  }, LEVEL_CONFIG.intervalMs);
  return () => {
    clearInterval(timer);
    // The owner of the mic may already have torn it down (disconnect then throws).
    try {
      node.disconnect(analyser);
      if (source instanceof MediaStream) node.disconnect();
      analyser.disconnect();
    } catch {
      // Already detached.
    }
  };
}
