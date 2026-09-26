// Wires a Song's Clock, Metronome, mic pipeline (matcher/pitch) and the
// render/PlaybackController rAF loop together for the Song view (spec 7-10,
// 12.2). All per-frame work stays inside PlaybackController; this hook only
// updates React state on discrete events (play/pause/row change/loop/stop),
// per spec 4.3 rule 3.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LaneId, PracticeMode, Settings, Song, Verdict } from "../model";
import { TempoMap } from "../tempo";
import {
  GridClock,
  MAX_SPEED,
  MIN_SPEED,
  VideoClock,
  createYouTubePlayer,
  type LoopRange,
  type YTPlayerLike,
} from "../clock";
import {
  Matcher,
  MicError,
  MicInput,
  Metronome,
  PitchDetector,
  buildExpectedEvents,
  getAudioContext,
  resumeAudio,
  summarize,
  type SessionSummary,
} from "../audio";
import type { Layout } from "../layout";
import { computeLayout } from "../layout";
import { PlaybackController, buildSongIndex, type SheetHandle } from "../render";

type EngineClock = GridClock | VideoClock;

function toOutputTimestampSource(ctx: AudioContext): { getOutputTimestamp(): { contextTime: number; performanceTime: number } } {
  return {
    getOutputTimestamp: () => {
      const ts = ctx.getOutputTimestamp();
      return {
        contextTime: ts.contextTime ?? ctx.currentTime,
        performanceTime: ts.performanceTime ?? performance.now(),
      };
    },
  };
}

function audioTimeToSongSec(clock: EngineClock, ctx: AudioContext, audioTime: number): number {
  if (clock.kind === "grid") return clock.audioTimeToSongSec(audioTime);
  return clock.audioTimeToSongSec(audioTime, toOutputTimestampSource(ctx));
}

export interface BpmRampConfig {
  enabled: boolean;
  startBpm: number;
  stepBpm: number;
  maxBpm: number | null;
  condition: { kind: "passes"; count: number } | { kind: "accuracy"; count: number; minOnTimePct: number };
}

export const DEFAULT_BPM_RAMP: BpmRampConfig = {
  enabled: false,
  startBpm: 80,
  stepBpm: 4,
  maxBpm: null,
  condition: { kind: "passes", count: 4 },
};

/** A user-chosen bar range (spec 10.2), inclusive bar numbers. `null`
 * (no range chosen) means "loop the whole song/exercise" whenever looping is
 * enabled. Sections are no longer a loop source -- the user picks bars
 * directly, by number or by dragging across bar headers on the sheet. */
export interface LoopBars {
  start: number;
  end: number;
}

/** 0, 1, 2 or 4 bars of rest held at the loop end before wrapping back to the
 * start (spec 10.2). */
export type RestBars = 0 | 1 | 2 | 4;

export interface PlaybackEngineOptions {
  song: Song;
  settings: Settings;
  onVideoOffsetNudge?: (deltaMs: number) => void;
  onSetBar1Here?: (videoSec: number) => void;
  /** Persists a settings change (spec 11.4). Used so toggling the mic in the
   * transport updates `settings.micEnabled` for next time. */
  onSettingsChange?: (next: Settings) => void;
}

export interface PlaybackEngine {
  mode: PracticeMode;
  setMode: (m: PracticeMode) => void;
  hasVideo: boolean;
  videoNotice: string | null;
  playing: boolean;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  stop: () => void;

  baseBpm: number;
  currentBpm: number;
  speedPercent: number;
  setSpeedPercent: (p: number) => void;
  setBpmField: (bpm: number) => void;
  bpmRampActive: boolean;

  videoRate: number;
  availableVideoRates: number[];
  setVideoRate: (r: number) => void;

  countIn: boolean;
  setCountIn: (v: boolean) => void;

  metronomeVolume: number;
  setMetronomeVolume: (v: number) => void;
  metronomeMuted: boolean;
  setMetronomeMuted: (v: boolean) => void;
  subdivisionOn: boolean;
  setSubdivisionOn: (v: boolean) => void;

  micOn: boolean;
  micAvailable: boolean;
  micErrorMessage: string | null;
  micListening: boolean;
  micNotCalibrated: boolean;
  toggleMic: () => void;

  /** Loop on/off (spec 10.1/10.2). With no range chosen, loops the whole
   * song/exercise; with a range, loops exactly those bars. */
  loopEnabled: boolean;
  setLoopEnabled: (v: boolean) => void;
  /** The user-chosen bar range, or null for "whole song/exercise". */
  loopRange: LoopBars | null;
  firstBarNumber: number;
  lastBarNumber: number;
  setLoopRangeFrom: (bar: number) => void;
  setLoopRangeTo: (bar: number) => void;
  clearLoopRange: () => void;
  /** Mouse-down/enter on a bar header (spec 10.2: click, shift-click to
   * extend, or click-and-drag across bar headers). */
  onBarMouseDown: (barNumber: number, shiftKey: boolean) => void;
  onBarMouseEnter: (barNumber: number) => void;
  /** Rest between loop passes, in bars (spec 10.2). Only meaningful in grid
   * mode; shown in the transport whenever looping is on in grid mode. */
  restBars: RestBars;
  setRestBars: (n: RestBars) => void;

  lanes: Record<LaneId, boolean>;
  setLanes: (l: Record<LaneId, boolean>) => void;
  zoom: number;
  setZoom: (z: number) => void;

  layout: Layout;
  songIndex: ReturnType<typeof buildSongIndex>;
  sheetOnReady: (handle: SheetHandle) => void;
  videoMountRef: (el: HTMLDivElement | null) => void;
  setViewportWidth: (w: number) => void;

  following: boolean;
  resumeFollow: () => void;

  sessionSummary: { lastPass: SessionSummary; allPasses: SessionSummary | null } | null;
  closeSessionSummary: () => void;

  nudgeVideoOffset: (deltaMs: number) => void;
  setBar1Here: () => void;

  bpmRamp: BpmRampConfig;
  setBpmRamp: (c: BpmRampConfig) => void;
}

function songBars(song: Song) {
  return song.sections.flatMap((s) => s.bars);
}

/** Bar numbers -> tick range (spec 10.2). Replaces the old section-based
 * lookup: the caller always supplies explicit bar numbers now, whether they
 * came from the From/To inputs, a click, or a drag across bar headers. */
function computeLoopTicks(song: Song, fromBar: number, toBar: number): { startTick: number; endTick: number } {
  const bars = songBars(song);
  const start = bars.find((b) => b.number === fromBar);
  const end = bars.find((b) => b.number === toBar);
  const startTick = start ? start.startTick : 0;
  const endTick = end ? end.startTick + end.lengthTicks : song.totalTicks;
  return { startTick, endTick };
}

/** The tick length of the bar starting at `tick` (falls back to the song's
 * first bar, or a default 4/4 bar) -- used to turn "N bars of rest" into
 * ticks at the loop's own tempo. */
function barLengthAtTick(song: Song, tick: number): number {
  const bars = songBars(song);
  const bar = bars.find((b) => b.startTick === tick);
  return bar ? bar.lengthTicks : (bars[0]?.lengthTicks ?? 3840);
}

/** Single source of truth for "what should the clock's loop be right now",
 * given the on/off toggle, the user's chosen range (or null = whole song),
 * and the rest-bars setting. Used both when the clock is (re)created and
 * every time any of these three inputs change, so there is exactly one place
 * that can get this wrong. */
function effectiveLoopRange(
  song: Song,
  loopEnabled: boolean,
  range: LoopBars | null,
  restBars: RestBars,
): LoopRange | null {
  if (!loopEnabled) return null;
  const bars = songBars(song);
  if (bars.length === 0) return null;
  const firstBar = bars[0].number;
  const lastBar = bars[bars.length - 1].number;
  const fromBar = range ? range.start : firstBar;
  const toBar = range ? range.end : lastBar;
  const { startTick, endTick } = computeLoopTicks(song, fromBar, toBar);
  const restTicks = restBars > 0 ? restBars * barLengthAtTick(song, startTick) : 0;
  return { startTick, endTick, restTicks };
}

export function usePlaybackEngine(opts: PlaybackEngineOptions): PlaybackEngine {
  const { song, settings } = opts;

  const initialMode: PracticeMode = settings.defaultMode === "video" && song.header.youtube ? "video" : "grid";
  const [mode, setModeRaw] = useState<PracticeMode>(initialMode);
  const hasVideo = !!song.header.youtube;
  const [videoNotice, setVideoNotice] = useState<string | null>(null);

  const [playing, setPlaying] = useState(false);
  const [speedPercent, setSpeedPercentState] = useState(100);
  const [videoRate, setVideoRateState] = useState(1);
  const [availableVideoRates, setAvailableVideoRates] = useState<number[]>([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]);
  const [countIn, setCountIn] = useState(settings.countIn);
  const [metronomeVolume, setMetronomeVolumeState] = useState(settings.metronomeVolume);
  const [metronomeMuted, setMetronomeMutedState] = useState(settings.metronomeMuted || initialMode === "video");
  const [subdivisionOn, setSubdivisionOnState] = useState(settings.subdivisionClicks);
  const [lanes, setLanes] = useState<Record<LaneId, boolean>>(settings.lanes);
  const [zoom, setZoom] = useState(settings.zoom);

  const [loopEnabled, setLoopEnabledState] = useState(false);
  const [loopRange, setLoopRangeState] = useState<LoopBars | null>(null);
  const [restBars, setRestBarsState] = useState<RestBars>(0);
  const dragAnchorRef = useRef<number | null>(null);

  const [following, setFollowing] = useState(true);
  const [viewportWidth, setViewportWidth] = useState(900);
  const [bpmRamp, setBpmRamp] = useState<BpmRampConfig>(DEFAULT_BPM_RAMP);
  const [rampBpmOverride, setRampBpmOverride] = useState<number | null>(null);

  const [micOn, setMicOn] = useState(false);
  const [micErrorMessage, setMicErrorMessage] = useState<string | null>(null);
  const [micListening, setMicListening] = useState(false);
  const [sessionSummary, setSessionSummary] = useState<{ lastPass: SessionSummary; allPasses: SessionSummary | null } | null>(
    null,
  );
  const micAutoStartTriedRef = useRef(false);

  const tempo = useMemo(() => new TempoMap(song), [song]);
  const songIndex = useMemo(() => buildSongIndex(song), [song]);
  const layout = useMemo(
    () => computeLayout(song, { viewportWidth, zoom, lanes }),
    [song, viewportWidth, zoom, lanes],
  );
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  const bars = useMemo(() => songBars(song), [song]);
  const firstBarNumber = bars[0]?.number ?? 1;
  const lastBarNumber = bars[bars.length - 1]?.number ?? 1;

  const clockRef = useRef<EngineClock | null>(null);
  const metronomeRef = useRef<Metronome | null>(null);
  const controllerRef = useRef<PlaybackController | null>(null);
  const sheetHandleRef = useRef<SheetHandle | null>(null);
  const ytPlayerRef = useRef<YTPlayerLike | null>(null);
  const matcherRef = useRef<Matcher | null>(null);
  const allPassVerdictsRef = useRef<Verdict[]>([]);
  const micRef = useRef<MicInput | null>(null);
  const pitchDetectorRef = useRef<PitchDetector | null>(null);
  const pendingVerdictByFrame = useRef<Map<number, Verdict>>(new Map());
  const passesSinceRampRef = useRef(0);
  const [videoMountEl, setVideoMountEl] = useState<HTMLDivElement | null>(null);

  const baseBpm = song.header.bpm;
  const effectiveSpeedPercent = speedPercent;
  const currentBpm = rampBpmOverride ?? Math.round((baseBpm * effectiveSpeedPercent) / 100);

  const micNotCalibrated = settings.calibration === null;
  const latencySec = (settings.calibration?.latencyMs ?? 0) / 1000;

  /** Pushes the current loop settings onto the live clock, right now,
   * without waiting for an effect. Called both from the loop-state setters
   * (so a user action takes effect immediately) and from the clock-creation
   * effect below (so a freshly (re)created clock starts with the right
   * loop). Single source of truth: effectiveLoopRange(). */
  const applyLoopNow = useCallback(
    (nextEnabled: boolean, nextRange: LoopBars | null, nextRestBars: RestBars) => {
      clockRef.current?.setLoop(effectiveLoopRange(song, nextEnabled, nextRange, nextRestBars));
    },
    [song],
  );

  const rebuildController = useCallback(() => {
    controllerRef.current?.dispose();
    controllerRef.current = null;
    const clock = clockRef.current;
    const handle = sheetHandleRef.current;
    if (!clock || !handle) return;
    const controller = new PlaybackController({
      clock,
      tempo,
      getLayout: () => layoutRef.current,
      container: handle.container,
      cursorEl: handle.cursor,
      getRowCanvas: handle.getRowCanvas,
      onFollowChange: setFollowing,
    });
    controller.start();
    controllerRef.current = controller;
  }, [tempo]);

  const finalizeSession = useCallback(() => {
    const matcher = matcherRef.current;
    if (!matcher) return;
    const lastPassVerdicts = matcher.verdicts();
    const combined = [...allPassVerdictsRef.current, ...lastPassVerdicts];
    const combinedSummary = summarize(combined);
    // Spec 9.6: show a summary once the session (across all loop passes) has
    // seen at least 4 expected events, not just the final/incomplete pass.
    if (combinedSummary.totalExpected < 4) return;
    const lastPassSummary = summarize(lastPassVerdicts);
    const allSummary = allPassVerdictsRef.current.length > 0 ? combinedSummary : null;
    setSessionSummary({ lastPass: lastPassSummary, allPasses: allSummary });
  }, []);

  const handleLoopPass = useCallback(() => {
    const matcher = matcherRef.current;
    if (matcher) {
      allPassVerdictsRef.current = [...allPassVerdictsRef.current, ...matcher.verdicts()];
      matcher.reset();
    }
    passesSinceRampRef.current += 1;
    if (bpmRamp.enabled && mode === "grid") {
      let shouldStep = false;
      if (bpmRamp.condition.kind === "passes") {
        shouldStep = passesSinceRampRef.current >= bpmRamp.condition.count;
      } else {
        const summary = matcher ? summarize(matcher.verdicts()) : null;
        const onTimePct = summary && summary.totalExpected > 0 ? (summary.onTime / summary.totalExpected) * 100 : 0;
        shouldStep =
          passesSinceRampRef.current >= bpmRamp.condition.count &&
          onTimePct >= bpmRamp.condition.minOnTimePct &&
          (summary?.missed ?? 1) === 0;
      }
      if (shouldStep) {
        passesSinceRampRef.current = 0;
        setRampBpmOverride((prev) => {
          const base = prev ?? bpmRamp.startBpm;
          const next = base + bpmRamp.stepBpm;
          const clamped = bpmRamp.maxBpm !== null ? Math.min(bpmRamp.maxBpm, next) : next;
          const factor = Math.max(MIN_SPEED, Math.min(MAX_SPEED, clamped / baseBpm));
          clockRef.current?.setSpeed(factor);
          setSpeedPercentState(Math.round(factor * 100));
          return clamped;
        });
      }
    }
  }, [bpmRamp, mode, baseBpm]);

  // Build (or rebuild) the active clock whenever the song, mode, or the
  // video mount point changes.
  useEffect(() => {
    let cancelled = false;

    async function setup() {
      metronomeRef.current?.stop();
      clockRef.current?.dispose();
      clockRef.current = null;

      if (mode === "video" && song.header.youtube) {
        if (!videoMountEl) return;
        try {
          const player = await createYouTubePlayer(videoMountEl, song.header.youtube.videoId);
          if (cancelled) return;
          ytPlayerRef.current = player;
          setAvailableVideoRates(player.getAvailablePlaybackRates());
          const clock = new VideoClock({ player, tempo, offsetSec: song.header.youtube.offsetSec });
          clockRef.current = clock;
          clock.onStateChange((s) => setPlaying(s.playing));
          clock.onLoop(() => handleLoopPass());
          setVideoNotice(null);
        } catch (err) {
          if (cancelled) return;
          setVideoNotice(err instanceof Error ? err.message : String(err));
          setModeRaw("grid");
          return;
        }
      } else {
        const ctx = getAudioContext();
        const clock = new GridClock({ ctx, tempo, song, countIn });
        clockRef.current = clock;
        clock.onStateChange((s) => setPlaying(s.playing));
        clock.onLoop(() => handleLoopPass());
        clock.setSpeed(effectiveSpeedPercent / 100);
      }

      const ctx = getAudioContext();
      const metronome = new Metronome(ctx, song, tempo);
      metronome.setVolume(metronomeVolume);
      metronome.setMuted(metronomeMuted);
      metronome.setSubdivision(subdivisionOn);
      if (clockRef.current) metronome.attach(clockRef.current);
      metronome.start();
      metronomeRef.current = metronome;

      matcherRef.current = new Matcher(buildExpectedEvents(song, tempo), settings.tiers);
      allPassVerdictsRef.current = [];
      passesSinceRampRef.current = 0;
      setRampBpmOverride(null);

      applyLoopNow(loopEnabled, loopRange, restBars);

      rebuildController();
    }

    void setup();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song, mode, videoMountEl, tempo]);

  useEffect(() => {
    metronomeRef.current?.setVolume(metronomeVolume);
  }, [metronomeVolume]);
  useEffect(() => {
    metronomeRef.current?.setMuted(metronomeMuted);
  }, [metronomeMuted]);
  useEffect(() => {
    metronomeRef.current?.setSubdivision(subdivisionOn);
  }, [subdivisionOn]);

  useEffect(() => {
    if (clockRef.current?.kind === "grid") {
      clockRef.current.setSpeed(effectiveSpeedPercent / 100);
    }
  }, [effectiveSpeedPercent]);

  // Safety net for the imperative applyLoopNow() calls in the setters below:
  // re-applies whenever loop state changes, so the live clock never drifts
  // out of sync with loopEnabled/loopRange/restBars (spec 10.2).
  useEffect(() => {
    applyLoopNow(loopEnabled, loopRange, restBars);
  }, [loopEnabled, loopRange, restBars, applyLoopNow]);

  const sheetOnReady = useCallback(
    (handle: SheetHandle) => {
      sheetHandleRef.current = handle;
      rebuildController();
    },
    [rebuildController],
  );

  const videoMountRef = useCallback((el: HTMLDivElement | null) => {
    setVideoMountEl(el);
  }, []);

  const startMic = useCallback(async (): Promise<boolean> => {
    try {
      await resumeAudio();
      const ctx = getAudioContext();
      const mic = await MicInput.start(ctx);
      micRef.current = mic;
      pitchDetectorRef.current = new PitchDetector();
      setMicErrorMessage(null);
      setMicListening(true);
      window.setTimeout(() => setMicListening(false), 1000);

      mic.onEnvelope((batch) => {
        const clock = clockRef.current;
        const controller = controllerRef.current;
        if (!clock || !controller) return;
        for (let i = 0; i < batch.rms.length; i++) {
          const frame = batch.frameStart + i * 128;
          const audioTimeSec = frame / mic.sampleRate;
          const songSec = audioTimeToSongSec(clock, ctx, audioTimeSec - latencySec);
          controller.pushEnvelopePoint(songSec, batch.rms[i]);
        }
      });

      mic.onOnset((frame) => {
        const clock = clockRef.current;
        const matcher = matcherRef.current;
        const controller = controllerRef.current;
        if (!clock || !matcher || !controller) return;
        const audioTimeSec = frame / mic.sampleRate;
        const songSec = audioTimeToSongSec(clock, ctx, audioTimeSec - latencySec);
        const verdict = matcher.addOnset(songSec);
        pendingVerdictByFrame.current.set(frame, verdict);
        controller.pushVerdict(verdict);
      });

      mic.onSlice((onsetFrame, samples) => {
        pitchDetectorRef.current?.detect(samples, mic.sampleRate).then((result) => {
          const verdict = pendingVerdictByFrame.current.get(onsetFrame);
          const matcher = matcherRef.current;
          if (!verdict || !matcher) return;
          matcher.attachPitch(verdict, result?.freq ?? null, result?.confidence ?? 0);
          controllerRef.current?.pushVerdict(verdict);
          pendingVerdictByFrame.current.delete(onsetFrame);
        });
      });

      setMicOn(true);
      return true;
    } catch (err) {
      if (err instanceof MicError) {
        setMicErrorMessage(
          err.kind === "denied"
            ? "Microphone permission was denied. Enable it in your browser's site settings."
            : err.kind === "nodevice"
              ? "No microphone was found."
              : err.message,
        );
      } else {
        setMicErrorMessage(err instanceof Error ? err.message : String(err));
      }
      return false;
    }
  }, [latencySec]);

  const stopMic = useCallback(() => {
    micRef.current?.stop();
    micRef.current = null;
    pitchDetectorRef.current?.dispose();
    pitchDetectorRef.current = null;
    pendingVerdictByFrame.current.clear();
    setMicOn(false);
  }, []);

  const play = useCallback(() => {
    void (async () => {
      await resumeAudio();
      // Spec: start the mic automatically on the first Play press (a user
      // gesture, needed for AudioContext resume + the permission prompt),
      // unless the user turned it off, and never retry within this session
      // once we've tried (denied permission shouldn't re-prompt every play).
      if (!micOn && settings.micEnabled && !micAutoStartTriedRef.current) {
        micAutoStartTriedRef.current = true;
        await startMic();
      }
      await clockRef.current?.play();
      controllerRef.current?.resumeFollow();
    })();
  }, [micOn, settings.micEnabled, startMic]);

  const pause = useCallback(() => {
    clockRef.current?.pause();
  }, []);

  const togglePlay = useCallback(() => {
    if (playing) pause();
    else play();
  }, [playing, play, pause]);

  const stop = useCallback(() => {
    clockRef.current?.pause();
    const effective = effectiveLoopRange(song, loopEnabled, loopRange, restBars);
    clockRef.current?.seekTick(effective ? effective.startTick : 0);
    finalizeSession();
    matcherRef.current?.reset();
    allPassVerdictsRef.current = [];
    passesSinceRampRef.current = 0;
    controllerRef.current?.clearAllCanvases(layoutRef.current.rows.length);
    controllerRef.current?.resumeFollow();
  }, [loopEnabled, loopRange, restBars, song, finalizeSession]);

  const toggleMic = useCallback(() => {
    if (micOn) {
      stopMic();
      opts.onSettingsChange?.({ ...settings, micEnabled: false });
      return;
    }
    opts.onSettingsChange?.({ ...settings, micEnabled: true });
    void startMic();
  }, [micOn, stopMic, startMic, opts, settings]);

  // Periodically advance the matcher so unmatched expected events age into
  // "missed" verdicts even without a new onset (spec 9.4). While a loop's
  // rest is in effect, clock.positionSec() is held at the loop end (spec
  // 10.2), so nothing new ages into "missed" during the rest.
  useEffect(() => {
    const id = window.setInterval(() => {
      const clock = clockRef.current;
      const matcher = matcherRef.current;
      const controller = controllerRef.current;
      if (!clock || !matcher || !controller || !clock.isPlaying()) return;
      const missed = matcher.advance(clock.positionSec());
      for (const v of missed) controller.pushVerdict(v);
    }, 100);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    return () => {
      clockRef.current?.dispose();
      metronomeRef.current?.stop();
      controllerRef.current?.dispose();
      micRef.current?.stop();
      pitchDetectorRef.current?.dispose();
    };
  }, []);

  const setLoopRange = useCallback(
    (next: LoopBars | null) => {
      setLoopRangeState(next);
      // Choosing a range signals intent to loop it (spec 10.2).
      setLoopEnabledState(true);
      applyLoopNow(true, next, restBars);
    },
    [applyLoopNow, restBars],
  );

  const setLoopEnabled = useCallback(
    (v: boolean) => {
      setLoopEnabledState(v);
      applyLoopNow(v, loopRange, restBars);
    },
    [applyLoopNow, loopRange, restBars],
  );

  const setRestBars = useCallback(
    (n: RestBars) => {
      setRestBarsState(n);
      applyLoopNow(loopEnabled, loopRange, n);
    },
    [applyLoopNow, loopEnabled, loopRange],
  );

  const clampBar = useCallback(
    (bar: number) => Math.max(firstBarNumber, Math.min(lastBarNumber, Math.round(bar))),
    [firstBarNumber, lastBarNumber],
  );

  const setLoopRangeFrom = useCallback(
    (bar: number) => {
      const clamped = clampBar(bar);
      const currentEnd = loopRange?.end ?? lastBarNumber;
      setLoopRange({ start: Math.min(clamped, currentEnd), end: Math.max(clamped, currentEnd) });
    },
    [clampBar, loopRange, lastBarNumber, setLoopRange],
  );

  const setLoopRangeTo = useCallback(
    (bar: number) => {
      const clamped = clampBar(bar);
      const currentStart = loopRange?.start ?? firstBarNumber;
      setLoopRange({ start: Math.min(currentStart, clamped), end: Math.max(currentStart, clamped) });
    },
    [clampBar, loopRange, firstBarNumber, setLoopRange],
  );

  const clearLoopRange = useCallback(() => {
    dragAnchorRef.current = null;
    setLoopRangeState(null);
    applyLoopNow(loopEnabled, null, restBars);
  }, [applyLoopNow, loopEnabled, restBars]);

  // Click, shift-click, or click-and-drag across bar headers (spec 10.2). A
  // plain mouse-down starts a drag anchored on that bar (and, with no further
  // movement, behaves like a single-bar click); mouse-enter while a drag is
  // active extends the range live; a global mouseup ends the drag gesture
  // (the committed range is whatever was last set, no extra action needed).
  const onBarMouseDown = useCallback(
    (barNumber: number, shiftKey: boolean) => {
      if (shiftKey) {
        const anchor = dragAnchorRef.current ?? loopRange?.start ?? barNumber;
        setLoopRange({ start: Math.min(anchor, barNumber), end: Math.max(anchor, barNumber) });
        dragAnchorRef.current = null;
        return;
      }
      dragAnchorRef.current = barNumber;
      setLoopRange({ start: barNumber, end: barNumber });
    },
    [loopRange, setLoopRange],
  );

  const onBarMouseEnter = useCallback(
    (barNumber: number) => {
      const anchor = dragAnchorRef.current;
      if (anchor === null) return;
      setLoopRange({ start: Math.min(anchor, barNumber), end: Math.max(anchor, barNumber) });
    },
    [setLoopRange],
  );

  useEffect(() => {
    const onUp = () => {
      dragAnchorRef.current = null;
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, []);

  const setMode = useCallback((m: PracticeMode) => {
    setModeRaw((prev) => {
      if (m === "video" && prev !== "video") setMetronomeMutedState(true);
      return m;
    });
    setVideoNotice(null);
  }, []);

  const setBpmField = useCallback(
    (bpm: number) => {
      if (!Number.isFinite(bpm) || bpm <= 0) return;
      const pct = Math.max(MIN_SPEED, Math.min(MAX_SPEED, bpm / baseBpm)) * 100;
      setSpeedPercentState(Math.round(pct));
      setRampBpmOverride(null);
    },
    [baseBpm],
  );

  const setVideoRate = useCallback((r: number) => {
    setVideoRateState(r);
    clockRef.current?.setSpeed(r);
  }, []);

  const nudgeVideoOffset = useCallback(
    (deltaMs: number) => {
      opts.onVideoOffsetNudge?.(deltaMs);
    },
    [opts],
  );

  const setBar1Here = useCallback(() => {
    const player = ytPlayerRef.current;
    if (player) opts.onSetBar1Here?.(player.getCurrentTime());
  }, [opts]);

  const resumeFollow = useCallback(() => {
    controllerRef.current?.resumeFollow();
  }, []);

  const closeSessionSummary = useCallback(() => setSessionSummary(null), []);

  return {
    mode,
    setMode,
    hasVideo,
    videoNotice,
    playing,
    play,
    pause,
    togglePlay,
    stop,

    baseBpm,
    currentBpm,
    speedPercent,
    setSpeedPercent: (p: number) => {
      setSpeedPercentState(p);
      setRampBpmOverride(null);
    },
    setBpmField,
    bpmRampActive: bpmRamp.enabled,

    videoRate,
    availableVideoRates,
    setVideoRate,

    countIn,
    setCountIn,

    metronomeVolume,
    setMetronomeVolume: setMetronomeVolumeState,
    metronomeMuted,
    setMetronomeMuted: setMetronomeMutedState,
    subdivisionOn,
    setSubdivisionOn: setSubdivisionOnState,

    micOn,
    micAvailable: typeof navigator !== "undefined" && !!navigator.mediaDevices,
    micErrorMessage,
    micListening,
    micNotCalibrated,
    toggleMic,

    loopEnabled,
    setLoopEnabled,
    loopRange,
    firstBarNumber,
    lastBarNumber,
    setLoopRangeFrom,
    setLoopRangeTo,
    clearLoopRange,
    onBarMouseDown,
    onBarMouseEnter,
    restBars,
    setRestBars,

    lanes,
    setLanes,
    zoom,
    setZoom,

    layout,
    songIndex,
    sheetOnReady,
    videoMountRef,
    setViewportWidth,

    following,
    resumeFollow,

    sessionSummary,
    closeSessionSummary,

    nudgeVideoOffset,
    setBar1Here,

    bpmRamp,
    setBpmRamp,
  };
}
