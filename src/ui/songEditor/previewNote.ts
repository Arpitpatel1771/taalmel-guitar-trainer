// A short synth pluck for clicking, drawing or moving a note.

import { getAudioContext, resumeAudio, midiToFreq, renderPluck } from "../../audio";

const cache = new Map<string, AudioBuffer>();
let current: AudioBufferSourceNode | null = null;

export async function previewPitch(midi: number, volume: number, a4Hz = 440): Promise<void> {
  if (volume <= 0) return;
  try {
    await resumeAudio();
    const ctx = getAudioContext();
    const key = `${midi}:${a4Hz}:${ctx.sampleRate}`;
    let buf = cache.get(key);
    if (!buf) {
      const data = renderPluck(midiToFreq(midi, a4Hz), ctx.sampleRate, false, midi * 7 + 3);
      buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
      buf.copyToChannel(data, 0);
      cache.set(key, buf);
    }
    try {
      current?.stop();
    } catch {
      /* already stopped */
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = Math.min(1, volume);
    gain.gain.setTargetAtTime(0, ctx.currentTime + 0.6, 0.12);
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start();
    src.stop(ctx.currentTime + 1.2);
    current = src;
  } catch {
    // no audio available; the preview is optional
  }
}
