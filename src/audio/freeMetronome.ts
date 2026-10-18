// Standalone metronome for the Metronome screen: no song, no Clock. Same
// lookahead pattern as metronome.ts (a 25 ms timer schedules clicks landing in
// the next 100 ms onto AudioContext time), but it counts beats itself.

import { scheduleClick } from "./metronome";

const SCHEDULER_INTERVAL_SEC = 0.025;
const SCHEDULE_AHEAD_SEC = 0.1;
const START_DELAY_SEC = 0.05;
const SUBDIVISION_VOLUME_FACTOR = 0.5;

export const FREE_MIN_BPM = 20;
export const FREE_MAX_BPM = 999;
export const MAX_BEATS_PER_BAR = 16;

export type Subdivision = 1 | 2 | 3 | 4;

export type ClickFn = (ctx: AudioContext, time: number, accent: boolean, volume: number, extraOut?: AudioNode) => void;

export function clampFreeBpm(bpm: number): number {
  return Math.min(FREE_MAX_BPM, Math.max(FREE_MIN_BPM, bpm));
}

/** Seconds between consecutive clicks (beats split into `subdivision` parts). */
export function clickInterval(bpm: number, subdivision: Subdivision): number {
  return 60 / clampFreeBpm(bpm) / subdivision;
}

export class FreeMetronome {
  private bpm = 120;
  private beatsPerBar = 4;
  private subdivision: Subdivision = 1;
  private accent = true;
  private volume = 0.7;
  private extraOut: AudioNode | null = null;

  private timer: ReturnType<typeof setInterval> | null = null;
  private nextClickTime = 0;
  /** Position inside the bar, in subdivision steps. */
  private step = 0;
  private readonly beatListeners = new Set<(beatIndex: number, audioTime: number) => void>();

  constructor(
    private readonly ctx: AudioContext,
    private readonly click: ClickFn = scheduleClick
  ) {}

  setBpm(bpm: number): void {
    this.bpm = clampFreeBpm(bpm);
  }

  setBeatsPerBar(n: number): void {
    this.beatsPerBar = Math.min(MAX_BEATS_PER_BAR, Math.max(1, Math.round(n)));
  }

  setSubdivision(s: Subdivision): void {
    // Keep the current beat, restart its subdivisions on the new grid.
    const beat = Math.floor(this.step / this.subdivision);
    this.subdivision = s;
    this.step = beat * s;
  }

  setAccent(on: boolean): void {
    this.accent = on;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
  }

  /** Also sends clicks to `node` (e.g. to mix them into a recording); null stops that. */
  setExtraOutput(node: AudioNode | null): void {
    this.extraOut = node;
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  /** Fires when a beat is scheduled (ahead of time); compare audioTime with ctx.currentTime to show it on time. */
  onBeat(cb: (beatIndex: number, audioTime: number) => void): () => void {
    this.beatListeners.add(cb);
    return () => this.beatListeners.delete(cb);
  }

  start(): void {
    if (this.timer !== null) return;
    this.step = 0;
    this.nextClickTime = this.ctx.currentTime + START_DELAY_SEC;
    this.timer = setInterval(() => this.tick(), SCHEDULER_INTERVAL_SEC * 1000);
    this.tick();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    const now = this.ctx.currentTime;
    // Background tabs throttle timers; skip missed clicks instead of bursting them.
    if (this.nextClickTime < now) this.nextClickTime = now + 0.01;

    const stepsPerBar = this.beatsPerBar * this.subdivision;
    while (this.nextClickTime < now + SCHEDULE_AHEAD_SEC) {
      this.step %= stepsPerBar;
      const onBeat = this.step % this.subdivision === 0;
      const beatIndex = Math.floor(this.step / this.subdivision);
      const time = this.nextClickTime;
      if (onBeat) {
        this.click(this.ctx, time, this.accent && beatIndex === 0, this.volume, this.extraOut ?? undefined);
        for (const cb of this.beatListeners) cb(beatIndex, time);
      } else {
        this.click(this.ctx, time, false, this.volume * SUBDIVISION_VOLUME_FACTOR, this.extraOut ?? undefined);
      }
      // Read the interval per click so tempo changes apply from the next one.
      this.nextClickTime += clickInterval(this.bpm, this.subdivision);
      this.step++;
    }
  }
}
