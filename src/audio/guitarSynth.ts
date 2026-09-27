// "Play notes": a synthetic guitar that plays the song (Karplus-Strong
// plucked string). Split into pure parts (Node-testable: pluck rendering and
// the per-note play plan) and a browser scheduler (GuitarPlayer) that mirrors
// the metronome's lookahead scheduling on AudioContext time.

import type { Note, Song, StringNumber } from "../model";
import type { Clock } from "../clock";
import type { TempoMap } from "../tempo";
import { OPEN_STRING_MIDI, midiToFreq } from "./tuner";

// ---------------------------------------------------------------- synthesis

/** Renders one plucked note with Karplus-Strong: a noise burst circulating in
 * a delay line of length sampleRate/freq, low-pass averaged each pass. Muted
 * notes damp much faster and are shorter. */
export function renderPluck(freq: number, sampleRate: number, muted = false, seed = 1): Float32Array<ArrayBuffer> {
  const seconds = muted ? 0.25 : 2.5;
  const out = new Float32Array(Math.floor(seconds * sampleRate));
  const period = Math.max(2, Math.round(sampleRate / freq));
  const line = new Float32Array(period);
  // Deterministic pseudo-random burst (LCG), slightly smoothed for a softer pick.
  let x = seed >>> 0 || 1;
  let prev = 0;
  for (let i = 0; i < period; i++) {
    x = (1664525 * x + 1013904223) >>> 0;
    const r = x / 4294967296 - 0.5;
    prev = 0.6 * r + 0.4 * prev;
    line[i] = prev;
  }
  const decay = muted ? 0.9 : 0.996;
  let idx = 0;
  for (let n = 0; n < out.length; n++) {
    const next = (idx + 1) % period;
    const v = line[idx];
    out[n] = v;
    line[idx] = decay * 0.5 * (v + line[next]);
    idx = next;
  }
  // Short fade-out so buffers never end with a click.
  const fade = Math.min(out.length, Math.floor(0.02 * sampleRate));
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  return out;
}

// ------------------------------------------------------------------ planning

/** How the pitch changes on an already-sounding string. */
export interface PitchChange {
  sec: number; // song seconds at base tempo
  midi: number;
  /** Seconds (real time at 1x) to reach the new pitch; 0 = instant. */
  glideSec: number;
}

/** One plucked voice on one string, possibly re-pitched by legato notes. */
export interface PluckPlan {
  string: StringNumber;
  sec: number; // pluck time, song seconds, incl. offsetMs and strum spread
  endSec: number; // when the voice is released
  midi: number; // fretted pitch at the pluck
  muted: boolean;
  vibrato: boolean;
  changes: PitchChange[];
}

const STRUM_SPREAD_SEC = 0.012; // per string, down = low to high
const SLIDE_SEC = 0.06;
const BEND_SEC = 0.12;

/** Builds the voices to play. Hammer/pull/slide and same-fret bends continue
 * the previous voice on their string (no re-pluck); anything else plucks. */
export function buildPlayPlan(song: Song, tempo: TempoMap): PluckPlan[] {
  const plans: PluckPlan[] = [];
  const current = new Map<StringNumber, PluckPlan>();
  const lastFret = new Map<StringNumber, number>();

  // Strum spread per start tick: direction from any note in the slot.
  const strumByTick = new Map<number, "up" | "down">();
  for (const n of song.notes) if (n.meta.strum) strumByTick.set(n.startTick, n.meta.strum);

  const timeOf = (n: Note) => tempo.ticksToSec(n.startTick) + n.offsetMs / 1000;
  const endOf = (n: Note) => tempo.ticksToSec(n.startTick + n.durationTicks) + n.offsetMs / 1000;

  for (const n of song.notes) {
    const midi = OPEN_STRING_MIDI[n.string] + n.fret;
    const conn = n.meta.connection;
    const prevFret = lastFret.get(n.string);
    lastFret.set(n.string, n.fret);
    const voice = current.get(n.string);
    const legato =
      !!voice &&
      !!conn &&
      (conn.kind === "hammer" || conn.kind === "pull" || conn.kind === "slide" || (conn.kind === "bend" && prevFret === n.fret));

    if (legato && voice) {
      const sec = timeOf(n);
      if (conn!.kind === "bend") {
        voice.changes.push({ sec, midi: midi + conn!.semitones, glideSec: BEND_SEC });
      } else {
        voice.changes.push({ sec, midi, glideSec: conn!.kind === "slide" ? SLIDE_SEC : 0 });
      }
      voice.endSec = Math.max(voice.endSec, endOf(n));
      voice.vibrato = voice.vibrato || !!n.meta.vibrato;
      voice.muted = voice.muted || !!n.meta.muted;
      continue;
    }

    // New pluck. A previous voice on this string is cut off here.
    let sec = timeOf(n);
    const strum = strumByTick.get(n.startTick);
    if (strum) {
      const order = strum === "down" ? 6 - n.string : n.string - 1; // down: string 6 first
      sec += order * STRUM_SPREAD_SEC;
    }
    if (voice) voice.endSec = Math.min(voice.endSec, sec);
    const plan: PluckPlan = {
      string: n.string,
      sec,
      endSec: Math.max(sec + 0.03, endOf(n)),
      midi,
      muted: !!n.meta.muted,
      vibrato: !!n.meta.vibrato,
      changes: [],
    };
    // A fresh bend (picked and bent): pluck at the fret, then bend up.
    if (conn?.kind === "bend") plan.changes.push({ sec: sec + 0.02, midi: midi + conn.semitones, glideSec: BEND_SEC });
    plans.push(plan);
    current.set(n.string, plan);
  }
  return plans.sort((a, b) => a.sec - b.sec);
}

// ----------------------------------------------------------------- playback

const SCHEDULER_INTERVAL_MS = 25;
const SCHEDULE_AHEAD_SEC = 0.1;
const RELEASE_SEC = 0.06;

interface LiveVoice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  endAudio: number;
}

/** Schedules the play plan on AudioContext time from the active clock, like
 * the metronome (spec 4.3 rule 5: never setTimeout-fired sound). */
export class GuitarPlayer {
  private readonly plans: PluckPlan[];
  private readonly cache = new Map<string, AudioBuffer>();
  private readonly out: GainNode;
  private clock: Clock | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeLoop: (() => void) | null = null;
  private unsubscribeState: (() => void) | null = null;
  private live: LiveVoice[] = [];
  private enabled = false;
  private lastScheduledSongSec = -Infinity;

  constructor(
    private readonly ctx: AudioContext,
    song: Song,
    tempo: TempoMap,
  ) {
    this.plans = buildPlayPlan(song, tempo);
    this.out = ctx.createGain();
    this.out.gain.value = 0.6;
    this.out.connect(ctx.destination);
  }

  attach(clock: Clock): void {
    this.unsubscribeLoop?.();
    this.unsubscribeState?.();
    this.clock = clock;
    this.unsubscribeLoop = clock.onLoop(() => {
      this.silence();
      this.lastScheduledSongSec = clock.unclampedPositionSec() - 1e-6;
    });
    this.unsubscribeState = clock.onStateChange((s) => {
      if (!s.playing) this.silence();
      this.lastScheduledSongSec = clock.unclampedPositionSec() - 1e-6;
    });
  }

  setVolume(v: number): void {
    this.out.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), this.ctx.currentTime, 0.02);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.silence();
    else if (this.clock) this.lastScheduledSongSec = this.clock.unclampedPositionSec() - 1e-6;
  }

  start(): void {
    if (this.timer !== null) return;
    this.lastScheduledSongSec = this.clock ? this.clock.unclampedPositionSec() - 1e-6 : -Infinity;
    this.timer = setInterval(() => this.tick(), SCHEDULER_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.silence();
    this.unsubscribeLoop?.();
    this.unsubscribeState?.();
    this.out.disconnect();
  }

  private silence(): void {
    const now = this.ctx.currentTime;
    for (const v of this.live) {
      try {
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setTargetAtTime(0, now, 0.01);
        v.source.stop(now + 0.05);
      } catch {
        // already stopped
      }
    }
    this.live = [];
  }

  private buffer(midi: number, muted: boolean): AudioBuffer {
    const key = `${midi}:${muted ? 1 : 0}`;
    let buf = this.cache.get(key);
    if (!buf) {
      const data = renderPluck(midiToFreq(midi), this.ctx.sampleRate, muted, midi * 7 + 3);
      buf = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
      buf.copyToChannel(data, 0);
      this.cache.set(key, buf);
    }
    return buf;
  }

  private tick(): void {
    if (!this.clock || !this.enabled || !this.clock.isPlaying()) return;
    const now = this.ctx.currentTime;
    const songSecNow = this.clock.unclampedPositionSec();
    const speed = this.clock.speed();
    // Backward jump (stop/seek) without a loop event: resync the watermark.
    if (songSecNow < this.lastScheduledSongSec - SCHEDULE_AHEAD_SEC * speed - 0.05) {
      this.lastScheduledSongSec = songSecNow - 1e-6;
    }
    const windowEnd = songSecNow + SCHEDULE_AHEAD_SEC * speed;
    const toAudio = (sec: number) => now + (sec - songSecNow) / speed;
    this.live = this.live.filter((v) => v.endAudio > now);

    for (const p of this.plans) {
      if (p.sec <= this.lastScheduledSongSec) continue;
      if (p.sec > windowEnd) break;
      const t = toAudio(p.sec);
      if (t < now) continue;
      const source = this.ctx.createBufferSource();
      source.buffer = this.buffer(p.midi, p.muted);
      const gain = this.ctx.createGain();
      gain.gain.value = p.muted ? 0.8 : 1;
      source.connect(gain);
      gain.connect(this.out);

      for (const c of p.changes) {
        const ct = Math.max(t, toAudio(c.sec));
        const rate = Math.pow(2, (c.midi - p.midi) / 12);
        if (c.glideSec > 0) {
          source.playbackRate.setValueAtTime(source.playbackRate.value, ct);
          source.playbackRate.linearRampToValueAtTime(rate, ct + c.glideSec);
        } else {
          source.playbackRate.setValueAtTime(rate, ct);
        }
      }
      if (p.vibrato) {
        const lfo = this.ctx.createOscillator();
        const depth = this.ctx.createGain();
        lfo.frequency.value = 5.5;
        depth.gain.value = 0.012; // about ±20 cents on playbackRate
        lfo.connect(depth);
        depth.connect(source.playbackRate);
        lfo.start(t);
        lfo.stop(toAudio(p.endSec) + RELEASE_SEC);
      }

      const end = Math.max(t + 0.03, toAudio(p.endSec));
      gain.gain.setValueAtTime(gain.gain.value, end);
      gain.gain.linearRampToValueAtTime(0, end + RELEASE_SEC);
      source.start(t);
      source.stop(end + RELEASE_SEC + 0.01);
      this.live.push({ source, gain, endAudio: end + RELEASE_SEC });
    }
    this.lastScheduledSongSec = windowEnd;
  }
}
