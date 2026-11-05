// Playback for the song editor: a clock (the YouTube video when there is one, else the metronome grid),
// the metronome clicks and the synth notes, all built from existing engine parts (src/clock, src/audio).

import { useCallback, useEffect, useRef, useState } from "react";
import type { Song } from "../../model";
import { GridClock, VideoClock, createYouTubePlayer, type Clock, type LoopRange, type YTPlayerLike } from "../../clock";
import { GuitarPlayer, Metronome, getAudioContext, resumeAudio, scheduleClick } from "../../audio";
import { TempoMap } from "../../tempo";

export class DraftPlayer {
  readonly clock: Clock;
  readonly metronome: Metronome;
  readonly guitar: GuitarPlayer;
  readonly tempo: TempoMap;
  private countTimer: ReturnType<typeof setTimeout> | null = null;
  private loop: LoopRange | null = null;
  private offLoop: () => void;

  constructor(
    readonly song: Song,
    player: YTPlayerLike | null,
    /** False keeps the video out of the clock: the roll plays on its own grid and never touches the video. */
    linked = true,
  ) {
    const ctx = getAudioContext();
    this.tempo = new TempoMap(song);
    const yt = song.header.youtube;
    this.clock = linked && player && yt ? new VideoClock({ player, tempo: this.tempo, offsetSec: yt.offsetSec }) : new GridClock({ ctx, tempo: this.tempo, song, countIn: false });
    this.metronome = new Metronome(ctx, song, this.tempo);
    this.metronome.attach(this.clock);
    this.metronome.start();
    this.guitar = new GuitarPlayer(ctx, song, this.tempo);
    this.guitar.attach(this.clock);
    this.guitar.setEnabled(false);
    this.guitar.start();
    // After each wrap the note on the loop start must sound even if the scheduler finds it late.
    this.offLoop = this.clock.onLoop(() => {
      if (this.loop) this.guitar.armFrom(this.tempo.ticksToSec(this.loop.startTick));
    });
  }

  setLoop(loop: LoopRange | null): void {
    this.loop = loop;
    this.clock.setLoop(loop);
  }

  get isVideo(): boolean {
    return this.clock.kind === "video";
  }

  /** Plays from a tick, optionally looping a tick range. */
  async playFrom(tick: number, loop: LoopRange | null = null, speed?: number): Promise<void> {
    await resumeAudio();
    this.cancelCountIn();
    if (speed !== undefined) this.clock.setSpeed(speed);
    this.setLoop(loop);
    this.guitar.armFrom(this.tempo.ticksToSec(tick));
    this.clock.seekTick(tick);
    await this.clock.play();
  }

  stop(): void {
    this.cancelCountIn();
    this.setLoop(null);
    this.clock.pause();
  }

  /** One bar of clicks at the given speed (accent on the first), resolving when it ends. */
  countIn(beats: number, beatSec: number, speed: number): Promise<void> {
    const ctx = getAudioContext();
    const gap = beatSec / speed;
    const t0 = ctx.currentTime + 0.08;
    for (let i = 0; i < beats; i++) scheduleClick(ctx, t0 + i * gap, i === 0, 0.8);
    return new Promise((resolve) => {
      this.countTimer = setTimeout(resolve, (0.08 + beats * gap) * 1000);
    });
  }

  cancelCountIn(): void {
    if (this.countTimer !== null) clearTimeout(this.countTimer);
    this.countTimer = null;
  }

  dispose(): void {
    this.cancelCountIn();
    this.offLoop();
    this.metronome.stop();
    this.guitar.stop();
    this.clock.dispose();
  }
}

export interface DraftPlayerHandle {
  player: DraftPlayer | null;
  /** The YouTube player once it is ready (for volume and the video time). */
  yt: YTPlayerLike | null;
  /** Attach to the element that should hold the video; render it only when the song has a video. */
  videoMountRef: (el: HTMLDivElement | null) => void;
  videoStatus: "none" | "loading" | "ready" | "error";
  videoError: string | null;
}

/**
 * Builds a DraftPlayer for `song` and rebuilds it when the song changes. The YouTube player is created
 * once per video and reused, so editing notes (or unlinking the video) does not reload it.
 */
export function useDraftPlayer(song: Song | null, wantVideo: boolean, linked = true): DraftPlayerHandle {
  const [mountEl, setMountEl] = useState<HTMLDivElement | null>(null);
  const [yt, setYt] = useState<YTPlayerLike | null>(null);
  const [videoStatus, setVideoStatus] = useState<DraftPlayerHandle["videoStatus"]>("none");
  const [videoError, setVideoError] = useState<string | null>(null);
  const [player, setPlayer] = useState<DraftPlayer | null>(null);
  const videoId = wantVideo ? song?.header.youtube?.videoId : undefined;

  const videoMountRef = useCallback((el: HTMLDivElement | null) => setMountEl(el), []);

  useEffect(() => {
    if (!videoId) {
      setYt(null);
      setVideoStatus("none");
      return;
    }
    if (!mountEl) return;
    let cancelled = false;
    const host = document.createElement("div");
    mountEl.appendChild(host);
    setVideoStatus("loading");
    setVideoError(null);
    createYouTubePlayer(host, videoId).then(
      (p) => {
        if (cancelled) return;
        setYt(p);
        setVideoStatus("ready");
      },
      (err) => {
        if (cancelled) return;
        setYt(null);
        setVideoStatus("error");
        setVideoError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      cancelled = true;
      setYt(null);
      host.remove();
    };
  }, [videoId, mountEl]);

  // Do not build a video clock until the player is ready; fall back to the grid on error.
  const waiting = !!videoId && videoStatus === "loading";
  const songRef = useRef(song);
  songRef.current = song;
  useEffect(() => {
    if (!song || waiting) {
      setPlayer(null);
      return;
    }
    const dp = new DraftPlayer(song, videoStatus === "ready" ? yt : null, linked);
    setPlayer(dp);
    return () => dp.dispose();
  }, [song, yt, waiting, videoStatus, linked]);

  return { player, yt, videoMountRef, videoStatus, videoError };
}
