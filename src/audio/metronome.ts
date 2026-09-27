// Metronome scheduler, spec 7.5. Standard lookahead pattern: a timer fires
// every 25 ms and schedules any clicks landing in the next 100 ms onto
// AudioContext time (spec 4.3 rule 5: never setTimeout-fired sound directly).
//
// Mapping song time to audio time: rather than depend on each Clock
// implementation's internal reference points, we resample the affine
// relationship `audioTime -> songSec` fresh on every scheduler tick, using
// only the base Clock contract (`positionSec()`, `speed()`). For GridClock
// this is exact (its songSec is itself an affine function of
// AudioContext.currentTime with no jitter); for VideoClock it tracks the
// interpolated position, which is the documented approximation for clicks in
// video mode (spec 7.4).

import { PPQ, type Bar, type Song, type TimeSignature } from "../model";
import type { Clock } from "../clock";
import type { TempoMap } from "../tempo";

const SCHEDULER_INTERVAL_SEC = 0.025;
const SCHEDULE_AHEAD_SEC = 0.1;
const SUBDIVISION_VOLUME_FACTOR = 0.5;
const ACCENT_FREQ_HZ = 1600;
const BEAT_FREQ_HZ = 1000;
const CLICK_DURATION_SEC = 0.03;

/**
 * Schedules a single short oscillator burst (spec 7.5: "~30 ms, exponential
 * decay"). Exported standalone so calibration can reuse the exact click
 * sound without going through a Metronome instance.
 */
export function scheduleClick(ctx: AudioContext, time: number, accent: boolean, volume: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = accent ? ACCENT_FREQ_HZ : BEAT_FREQ_HZ;

  const peak = Math.max(0, Math.min(1, volume));
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(peak, time + 0.001);
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001) * 0.001, time + CLICK_DURATION_SEC);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(time);
  osc.stop(time + CLICK_DURATION_SEC + 0.005);
}

interface ClickPoint {
  tick: number;
  accent: boolean;
  subdivision: boolean;
}

/** "Beat" tick spacing: quarter note, except x/8 signatures click each eighth (spec 7.5). */
function beatTickSpacing(time: TimeSignature): number {
  return time.denominator === 8 ? PPQ / 2 : PPQ;
}

function beatTicksForBar(bar: Bar, time: TimeSignature): number[] {
  const spacing = beatTickSpacing(time);
  const ticks: number[] = [];
  for (let t = 0; t < bar.lengthTicks; t += spacing) ticks.push(bar.startTick + t);
  return ticks;
}

function subdivisionTicksForBar(bar: Bar): number[] {
  const slotLen = bar.lengthTicks / bar.slots;
  const ticks: number[] = [];
  for (let s = 0; s < bar.slots; s++) ticks.push(bar.startTick + s * slotLen);
  return ticks;
}

/**
 * Builds the full song's click schedule (pure tick math, no audio calls), so
 * it is cheap to compute once per song and cheap to unit test. Also mirrors
 * bar 1's pattern into negative ticks for the optional count-in bar (spec
 * 7.3), since the count-in has no bar of its own in the song model.
 */
export function buildClickSchedule(song: Song): ClickPoint[] {
  const bars: Bar[] = song.sections.flatMap((s) => s.bars);
  const points: ClickPoint[] = [];
  const seen = new Set<number>();

  const addBar = (bar: Bar, tickOffset: number) => {
    const beatTicks = beatTicksForBar(bar, song.header.time);
    const beatSet = new Set(beatTicks);
    for (const t of beatTicks) {
      const tick = t + tickOffset;
      if (seen.has(tick)) continue;
      seen.add(tick);
      points.push({ tick, accent: t === bar.startTick, subdivision: false });
    }
    for (const t of subdivisionTicksForBar(bar)) {
      if (beatSet.has(t)) continue;
      const tick = t + tickOffset;
      if (seen.has(tick)) continue;
      seen.add(tick);
      points.push({ tick, accent: false, subdivision: true });
    }
  };

  for (const bar of bars) addBar(bar, 0);
  if (bars.length > 0) {
    const first = bars[0];
    addBar(first, -first.lengthTicks); // count-in: bar 1's pattern shifted before tick 0
  }

  points.sort((a, b) => a.tick - b.tick);
  return points;
}

/**
 * Lookahead click scheduler (spec 7.5). Reads its position from whichever
 * Clock it is attached to; does not compute musical position itself (spec
 * 4.3 rule 2).
 */
export class Metronome {
  private readonly clickSchedule: ClickPoint[];
  private clock: Clock | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeLoop: (() => void) | null = null;

  private volume = 0.7;
  private muted = false;
  private subdivisionOn = false;
  private enabled = true;
  private lastScheduledSongSec = -Infinity;

  constructor(
    private readonly ctx: AudioContext,
    song: Song,
    private readonly tempo: TempoMap
  ) {
    this.clickSchedule = buildClickSchedule(song);
  }

  /**
   * Attaches to a Clock and (re)subscribes to its loop wraps.
   *
   * Bug fixed here: `tick()` below stamps `lastScheduledSongSec` to
   * `songSecNow + lookahead` every call, assuming songSecNow only moves
   * forward. A loop wrap makes it jump BACKWARD (from the loop end back to
   * its start) inside a single tick(): the click(s) between the new,
   * smaller songSecNow and the stale, larger watermark from the tick just
   * before the wrap compare as "already scheduled" and are skipped -- an
   * audible dropped click right at the loop boundary every single pass.
   * Resetting the watermark on every `onLoop`, right as the wrap happens,
   * closes that gap so the loop's own clicks get scheduled on the very next
   * tick instead of one tick late.
   */
  attach(clock: Clock): void {
    this.unsubscribeLoop?.();
    this.clock = clock;
    this.unsubscribeLoop = clock.onLoop(() => {
      this.lastScheduledSongSec = clock.unclampedPositionSec() - 1e-6;
    });
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
  }

  setMuted(m: boolean): void {
    this.muted = m;
  }

  setSubdivision(on: boolean): void {
    this.subdivisionOn = on;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  start(): void {
    if (this.timer !== null) return;
    this.lastScheduledSongSec = this.clock ? this.clock.unclampedPositionSec() - 1e-6 : -Infinity;
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
    if (!this.clock || !this.enabled || this.muted) return;
    if (!this.clock.isPlaying()) return;

    const now = this.ctx.currentTime;
    // Unclamped (not positionSec()): keeps advancing through a loop's rest
    // period so clicks continue instead of freezing with the cursor.
    const songSecNow = this.clock.unclampedPositionSec();
    const speed = this.clock.speed();
    // Backward jump (Stop returns to the start, or a seek) without a loop
    // event: resync the watermark, or clicks stay silent until playback
    // catches back up to where it was.
    if (songSecNow < this.lastScheduledSongSec - SCHEDULE_AHEAD_SEC * speed - 0.05) {
      this.lastScheduledSongSec = songSecNow - 1e-6;
    }
    const windowEndSongSec = songSecNow + SCHEDULE_AHEAD_SEC * speed;

    for (const click of this.clickSchedule) {
      if (click.subdivision && !this.subdivisionOn) continue;
      const sec = this.tempo.ticksToSec(click.tick);
      if (sec <= this.lastScheduledSongSec) continue;
      if (sec > windowEndSongSec) break; // tempo is monotonic, so tick order implies sec order
      const audioTime = now + (sec - songSecNow) / speed;
      if (audioTime < now) continue;
      const volume = this.volume * (click.subdivision ? SUBDIVISION_VOLUME_FACTOR : 1);
      scheduleClick(this.ctx, audioTime, click.accent, volume);
    }

    this.lastScheduledSongSec = windowEndSongSec;
  }
}
