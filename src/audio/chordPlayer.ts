// Chord playback: pure schedule (testable) + a browser player that reuses the
// Karplus-Strong pluck on the shared AudioContext.

import type { StringNumber } from "../model";
import { getAudioContext, resumeAudio } from "./context";
import { renderPluck } from "./guitarSynth";
import { OPEN_STRING_MIDI, midiToFreq } from "./tuner";

export type ChordFrets = readonly (number | null)[]; // index 0 = string 6 (low E)
export type ChordStyle = "strum" | "arpeggio";

export interface ChordNote {
  string: StringNumber;
  midi: number;
  offsetSec: number;
}

const SPACING: Record<ChordStyle, number> = { strum: 0.015, arpeggio: 0.25 };

export function chordSchedule(frets: ChordFrets, style: ChordStyle): ChordNote[] {
  const out: ChordNote[] = [];
  let k = 0;
  for (let i = 0; i < 6; i++) {
    const fret = frets[i];
    if (fret == null) continue;
    const string = (6 - i) as StringNumber;
    out.push({ string, midi: OPEN_STRING_MIDI[string] + fret, offsetSec: k * SPACING[style] });
    k++;
  }
  return out;
}

let active: AudioBufferSourceNode[] = [];

export async function playChord(
  frets: ChordFrets,
  style: ChordStyle,
  opts: { a4Hz: number; volume: number },
): Promise<void> {
  await resumeAudio();
  const ctx = getAudioContext();
  for (const s of active) {
    try {
      s.stop();
    } catch {
      /* already stopped */
    }
  }
  active = [];
  const gain = ctx.createGain();
  gain.gain.value = opts.volume;
  gain.connect(ctx.destination);
  const t0 = ctx.currentTime + 0.02;
  for (const n of chordSchedule(frets, style)) {
    const data = renderPluck(midiToFreq(n.midi, opts.a4Hz), ctx.sampleRate, false, n.midi * 7 + 3);
    const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buf.copyToChannel(data, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    src.start(t0 + n.offsetSec);
    src.onended = () => {
      active = active.filter((a) => a !== src);
    };
    active.push(src);
  }
}

/** Strum spacing between strings for scheduled strums (spec: 12 ms). */
export const STRUM_SPACING_SEC = 0.012;

/** Pure: notes in strum order. Down = low to high, up = high to low. */
export function strumSchedule(frets: ChordFrets, direction: "down" | "up"): ChordNote[] {
  const notes: ChordNote[] = [];
  for (let i = 0; i < 6; i++) {
    const fret = frets[i];
    if (fret == null) continue;
    const string = (6 - i) as StringNumber;
    notes.push({ string, midi: OPEN_STRING_MIDI[string] + fret, offsetSec: 0 });
  }
  if (direction === "up") notes.reverse();
  return notes.map((n, k) => ({ ...n, offsetSec: k * STRUM_SPACING_SEC }));
}

const bufferCache = new Map<string, AudioBuffer>();

function pluckBuffer(ctx: AudioContext, midi: number, a4Hz: number): AudioBuffer {
  const key = `${ctx.sampleRate}|${a4Hz}|${midi}`;
  let buf = bufferCache.get(key);
  if (!buf) {
    const data = renderPluck(midiToFreq(midi, a4Hz), ctx.sampleRate, false, midi * 7 + 3);
    buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buf.copyToChannel(data, 0);
    bufferCache.set(key, buf);
  }
  return buf;
}

/**
 * Schedules one strum at AudioContext time `when` (no resume, no cutting off
 * earlier chords). Returns the sources so the caller can stop them.
 */
export function scheduleChord(
  frets: ChordFrets,
  opts: { when: number; direction: "down" | "up"; volume: number; a4Hz: number },
): AudioBufferSourceNode[] {
  const ctx = getAudioContext();
  const gain = ctx.createGain();
  gain.gain.value = opts.volume;
  gain.connect(ctx.destination);
  const when = Math.max(opts.when, ctx.currentTime);
  return strumSchedule(frets, opts.direction).map((n) => {
    const src = ctx.createBufferSource();
    src.buffer = pluckBuffer(ctx, n.midi, opts.a4Hz);
    src.connect(gain);
    src.start(when + n.offsetSec);
    return src;
  });
}
