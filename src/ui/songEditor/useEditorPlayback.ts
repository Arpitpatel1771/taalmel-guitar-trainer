// Listening in the song editor: the player for the song as it is now (rebuilt a moment after each
// edit; playback resumes from where it was), the transport state and the mix between the video and
// the synth notes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Settings } from "../../model";
import { TempoMap } from "../../tempo";
import { YT_PLAYER_STATE } from "../../clock";
import { docToSong, emptyDoc, type EdDoc } from "../../songEditor";
import type { VideoState } from "../../audio/hints";
import { useDraftPlayer, type DraftPlayer } from "./useDraftPlayer";

export interface LoopSpan {
  startTick: number;
  endTick: number;
}

export const SPEEDS = [0.25, 0.5, 0.75, 1] as const;

function safeSong(doc: EdDoc) {
  try {
    return docToSong(doc);
  } catch {
    return null;
  }
}

export function formatClock(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

/** `freeze` keeps the player as it is while edits arrive (Live record), so tapping doesn't restart playback. */
export function useEditorPlayback(doc: EdDoc, settings: Settings, freeze = false, onSettingsChange?: (next: Settings) => void) {
  const [settled, setSettled] = useState(doc);
  useEffect(() => {
    if (freeze) return;
    const id = setTimeout(() => setSettled(doc), 150);
    return () => clearTimeout(id);
  }, [doc, freeze]);
  const song = useMemo(() => safeSong(settled), [settled]);
  const [linked, setLinked] = useState(true);
  const handle = useDraftPlayer(song, true, linked);
  const { player, yt } = handle;

  const lastTempo = useRef<TempoMap | null>(null);
  const tempo = useMemo(() => {
    const s = safeSong(doc);
    if (s) lastTempo.current = new TempoMap(s);
    return lastTempo.current ?? new TempoMap(docToSong(emptyDoc({ title: "" })));
  }, [doc]);

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [loopOn, setLoopOn] = useState(false);
  const [loopRange, setLoopRange] = useState<LoopSpan | null>(null);
  // Metronome, Follow and the balance are saved settings, so they stay as last set.
  const listen = settings.editorListen;
  const [clickOn, setClickOnState] = useState(listen?.click ?? !doc.header.youtube);
  const [followOn, setFollowOnState] = useState(listen?.follow ?? true);
  const [balance, setBalanceState] = useState(listen?.balance ?? 50);
  const [timeLabel, setTimeLabel] = useState("0:00.0");

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const saveListen = useCallback(
    (patch: NonNullable<Settings["editorListen"]>) => {
      const s = settingsRef.current;
      const next = { ...s, editorListen: { ...s.editorListen, ...patch } };
      settingsRef.current = next;
      onSettingsChange?.(next);
    },
    [onSettingsChange],
  );
  const setClickOn = useCallback((v: boolean) => (setClickOnState(v), saveListen({ click: v })), [saveListen]);
  const setFollowOn = useCallback((v: boolean) => (setFollowOnState(v), saveListen({ follow: v })), [saveListen]);
  const setBalance = useCallback((v: number) => (setBalanceState(v), saveListen({ balance: v })), [saveListen]);

  const cursor = useRef(0);
  const want = useRef(false);
  const playerRef = useRef<DraftPlayer | null>(null);
  playerRef.current = player;
  const latest = useRef({ speed, loopOn, loopRange, clickOn, balance, settings });
  latest.current = { speed, loopOn, loopRange, clickOn, balance, settings };
  const ytRef = useRef(yt);
  ytRef.current = yt;
  // Unlinked, the video runs on its own: the time label and the hints follow the roll or the video separately.
  const linkedRef = useRef(linked);
  linkedRef.current = linked;

  const loopArg = useCallback((): LoopSpan | null => {
    const { loopOn: on, loopRange: r } = latest.current;
    return on && r && r.endTick > r.startTick ? r : null;
  }, []);

  const applyMix = useCallback((p: DraftPlayer | null) => {
    const { balance: b, clickOn: c, settings: s } = latest.current;
    if (p) {
      p.guitar.setEnabled(b > 0);
      p.guitar.setVolume(s.playNotesVolume * Math.min(1, b / 50));
      p.metronome.setVolume(s.metronomeVolume);
      p.metronome.setMuted(!c);
      p.metronome.setSubdivision(false);
    }
    const y = ytRef.current as unknown as { setVolume?: (v: number) => void } | null;
    y?.setVolume?.(Math.round(Math.min(100, (100 - b) * 2)));
  }, []);

  // A new player (after an edit, or when the video is ready): bring it up to date and carry on.
  useEffect(() => {
    if (!player) return;
    player.clock.setSpeed(latest.current.speed);
    applyMix(player);
    let idle: ReturnType<typeof setTimeout> | undefined;
    const off = player.clock.onStateChange((s) => {
      const on = s.playing || (!!s.buffering && want.current);
      setPlaying(on);
      clearTimeout(idle);
      if (!on) {
        // Playback stopped by itself (the video ended): don't restart it after the next edit.
        idle = setTimeout(() => {
          if (!playerRef.current?.clock.isPlaying()) want.current = false;
        }, 500);
      }
    });
    if (want.current) void player.playFrom(cursor.current, loopArg(), latest.current.speed).catch(() => undefined);
    return () => {
      clearTimeout(idle);
      off();
    };
  }, [player, applyMix, loopArg]);

  useEffect(() => applyMix(player), [player, balance, clickOn, settings.playNotesVolume, settings.metronomeVolume, yt, applyMix]);
  useEffect(() => {
    player?.clock.setSpeed(speed);
  }, [player, speed]);
  useEffect(() => {
    const r = loopOn && loopRange && loopRange.endTick > loopRange.startTick ? loopRange : null;
    player?.setLoop(r);
  }, [player, loopOn, loopRange]);

  // Position and the time label while playing.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const p = playerRef.current;
      if (!p || !p.clock.isPlaying()) return;
      cursor.current = p.clock.positionTick();
      const y = ytRef.current;
      setTimeLabel(formatClock(y && linkedRef.current ? y.getCurrentTime() : p.clock.positionSec()));
    }, 120);
    return () => clearInterval(id);
  }, [playing]);

  const getPlayhead = useCallback((): number => {
    const p = playerRef.current;
    return p && p.clock.isPlaying() ? p.clock.positionTick() : cursor.current;
  }, []);

  const seek = useCallback((tick: number) => {
    cursor.current = Math.max(0, tick);
    const p = playerRef.current;
    if (p) {
      p.clock.seekTick(cursor.current);
      // Seeking a video that isn't playing must not start it.
      if (!want.current) p.clock.pause();
    }
    const y = ytRef.current;
    setTimeLabel(formatClock(y && linkedRef.current ? y.getCurrentTime() : p?.clock.positionSec() ?? 0));
  }, []);

  const play = useCallback(async () => {
    const p = playerRef.current;
    if (!p) return;
    const loop = loopArg();
    let from = getPlayhead();
    if (loop && (from < loop.startTick || from >= loop.endTick)) from = loop.startTick;
    cursor.current = from;
    want.current = true;
    setPlaying(true);
    try {
      await p.playFrom(from, loop, latest.current.speed);
    } catch {
      want.current = false;
      setPlaying(false);
    }
  }, [getPlayhead, loopArg]);

  const pause = useCallback(() => {
    const p = playerRef.current;
    want.current = false;
    if (p) {
      cursor.current = p.clock.positionTick();
      p.stop();
    }
    setPlaying(false);
  }, []);

  const togglePlay = useCallback(() => {
    if (want.current || playerRef.current?.clock.isPlaying()) pause();
    else void play();
  }, [pause, play]);

  const toggleLoop = useCallback(
    (fallback: LoopSpan | null) => {
      if (loopOn) {
        setLoopOn(false);
        return;
      }
      if (!loopRange && fallback) setLoopRange(fallback);
      if (loopRange || fallback) setLoopOn(true);
    },
    [loopOn, loopRange],
  );

  const getVideoState = useCallback((): VideoState => {
    const y = ytRef.current;
    const playing = y && !linkedRef.current ? y.getPlayerState() === YT_PLAYER_STATE.PLAYING : !!playerRef.current?.clock.isPlaying();
    return { timeSec: y ? y.getCurrentTime() : 0, playing, rate: y ? y.getPlaybackRate() : 1 };
  }, []);

  const getVideoTime = useCallback((): number | null => (ytRef.current ? ytRef.current.getCurrentTime() : null), []);

  const ownSoundsAudible = useCallback((): boolean => latest.current.balance > 0 || latest.current.clickOn, []);

  const listenToVideoOnly = useCallback(() => {
    setBalance(0);
    setClickOn(false);
  }, []);

  return {
    ...handle,
    tempo,
    linked,
    setLinked,
    playing,
    togglePlay,
    play,
    pause,
    seek,
    getPlayhead,
    speed,
    setSpeed,
    loopOn,
    loopRange,
    setLoopRange,
    setLoopOn,
    toggleLoop,
    clickOn,
    setClickOn,
    followOn,
    setFollowOn,
    balance,
    setBalance,
    timeLabel,
    getVideoState,
    getVideoTime,
    ownSoundsAudible,
    listenToVideoOnly,
  };
}
