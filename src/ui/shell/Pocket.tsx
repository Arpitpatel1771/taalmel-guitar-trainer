// The pocket (specs/5-11-ui-redesign.md 3.2): a floating pill, bottom-right on
// every screen, with the always-available tools: tuner, metronome, mic level
// and quick record. Hidden chips: the one for the screen that is the tool.

import { useCallback, useEffect, useRef, useState } from "react";
import { Gauge, Metronome as MetronomeIcon, Minus, Pause, Play, Plus, Square } from "lucide-react";
import type { Settings } from "../../model";
import { FreeMetronome, FREE_MAX_BPM, FREE_MIN_BPM, clampFreeBpm, getAudioContext, resumeAudio, useInputLevel } from "../../audio";
import { ClipRecorder, defaultClipName, ensureClipGain, formatClipTime, openInput, saveClip, stopStream } from "../../recording";
import { Popover } from "../components/Popover";
import { TunerPanel } from "../components/TunerPanel";
import { Button, Meter, Slider } from "../components/kit";
import { LEVEL_TEXT } from "../components/levelText";
import { useMicRegistry, usePracticeInfo, useShell } from "./AppShellContext";
import styles from "./Pocket.module.css";

/** The screen that is itself the tool hides that chip. */
export type PocketHide = "tuner" | "metronome" | "recorder" | null;

type OpenId = "tuner" | "metro" | "mic" | null;

const TAP_RESET_MS = 2000;
const TAP_AVERAGE = 4;

/** True when keyboard focus is somewhere the user types. */
function typingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

export function Pocket({
  settings,
  onSettingsChange,
  hide,
  inPractice,
}: {
  settings: Settings;
  onSettingsChange: (next: Settings) => void;
  hide: PocketHide;
  /** Practice view: its own M key toggles the mic, so the pocket leaves M alone. */
  inPractice: boolean;
}) {
  const { toast } = useShell();
  const practice = usePracticeInfo();
  const { sources } = useMicRegistry();
  const [open, setOpen] = useState<OpenId>(null);

  // ---- Tuner ----
  const [tuned, setTuned] = useState<{ name: string; inTune: boolean } | null>(null);

  // ---- Metronome ----
  const [bpm, setBpm] = useState(100);
  const [metroRunning, setMetroRunning] = useState(false);
  const metroRef = useRef<FreeMetronome | null>(null);
  const tapsRef = useRef<number[]>([]);
  const metro = () => (metroRef.current ??= new FreeMetronome(getAudioContext()));

  useEffect(() => {
    metroRef.current?.setBpm(bpm);
  }, [bpm]);
  useEffect(() => {
    metroRef.current?.setVolume(settings.metronomeVolume);
  }, [settings.metronomeVolume]);
  useEffect(() => () => metroRef.current?.stop(), []);
  // The metronome screen has its own click; never run two.
  useEffect(() => {
    if (hide === "metronome" || hide === "recorder") {
      metroRef.current?.stop();
      setMetroRunning(false);
    }
  }, [hide]);

  async function toggleMetro() {
    const m = metro();
    if (m.isRunning()) {
      m.stop();
      setMetroRunning(false);
    } else {
      await resumeAudio();
      m.setBpm(bpm);
      m.setVolume(settings.metronomeVolume);
      m.start();
      setMetroRunning(true);
    }
  }

  function tap() {
    const now = performance.now();
    const taps = tapsRef.current;
    if (taps.length > 0 && now - taps[taps.length - 1] > TAP_RESET_MS) taps.length = 0;
    taps.push(now);
    if (taps.length > TAP_AVERAGE + 1) taps.shift();
    if (taps.length < 2) return;
    const avgMs = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
    setBpm(clampFreeBpm(Math.round(60000 / avgMs)));
  }

  // ---- Quick record (audio clip, saved like the Recorder screen does) ----
  const [quickStream, setQuickStream] = useState<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recRef = useRef<ClipRecorder | null>(null);
  const quickStreamRef = useRef<MediaStream | null>(null);

  const stopQuick = useCallback(async () => {
    const rec = recRef.current;
    const input = quickStreamRef.current;
    recRef.current = null;
    quickStreamRef.current = null;
    setRecording(false);
    setQuickStream(null);
    try {
      if (rec) {
        const result = await rec.stop();
        if (result.blob.size === 0) throw new Error("The recording was empty.");
        const saved = await saveClip({ name: defaultClipName(new Date()), createdAt: Date.now(), ...result, flags: [] });
        await ensureClipGain(saved).catch(() => null);
        toast("Recording saved.");
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      stopStream(input);
    }
  }, [toast]);

  const startQuick = useCallback(async () => {
    try {
      const input = await openInput(false);
      const rec = new ClipRecorder(input, false);
      rec.start();
      recRef.current = rec;
      quickStreamRef.current = input;
      setQuickStream(input);
      setElapsed(0);
      setRecording(true);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not open the microphone.", "error");
    }
  }, [toast]);

  const toggleQuick = useCallback(() => {
    if (recRef.current) void stopQuick();
    else void startQuick();
  }, [startQuick, stopQuick]);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setElapsed(recRef.current?.elapsedSec() ?? 0), 250);
    return () => clearInterval(id);
  }, [recording]);

  // Leaving while recording keeps the take.
  const stopQuickRef = useRef(stopQuick);
  stopQuickRef.current = stopQuick;
  useEffect(() => () => void (recRef.current && stopQuickRef.current()), []);
  // Opening the Recorder screen while a quick take runs: finish the take first.
  useEffect(() => {
    if (hide === "recorder" && recRef.current) void stopQuickRef.current();
  }, [hide]);

  // ---- Mic level: the first registered open mic, else our own recording ----
  const levelSource = quickStream ?? Object.values(sources)[0] ?? null;
  const level = useInputLevel(levelSource);
  const levelText = LEVEL_TEXT[level.state];
  // Practice listening at a too-quiet level: say so once per session (spec 5-11-recording-level 1.4).
  const quietToldRef = useRef(false);
  useEffect(() => {
    if (practice && level.state === "tooQuiet" && !quietToldRef.current) {
      quietToldRef.current = true;
      toast(`Too quiet. ${LEVEL_TEXT.tooQuiet.hint}`, "info");
    }
  }, [practice, level.state, toast]);

  // ---- Keyboard: T tuner, M metronome, R record ----
  const toggleOpen = useCallback((id: Exclude<OpenId, null>) => setOpen((cur) => (cur === id ? null : id)), []);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || typingTarget(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "t" && hide !== "tuner") toggleOpen("tuner");
      else if (k === "m" && hide !== "metronome" && hide !== "recorder" && !inPractice) toggleOpen("metro");
      else if (k === "r" && hide !== "recorder") toggleQuick();
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hide, inPractice, toggleOpen, toggleQuick]);

  // A popover whose chip is hidden must not stay open.
  useEffect(() => {
    if ((open === "tuner" && hide === "tuner") || (open === "metro" && hide === "metronome")) setOpen(null);
  }, [hide, open]);

  const bump = (d: number) => setBpm((b) => clampFreeBpm(b + d));
  const mm = (n: number) => formatClipTime(Math.floor(n));

  return (
    <div className={styles.pocket} role="toolbar" aria-label="Tools">
      {hide !== "tuner" && (
        <Popover
          label="Tuner"
          width={340}
          open={open === "tuner"}
          onOpenChange={(v) => {
            setOpen(v ? "tuner" : null);
            if (!v) setTuned(null);
          }}
          triggerClassName={`${styles.chip}${open === "tuner" ? ` ${styles.chipOn}` : ""}`}
          trigger={
            <>
              <Gauge size={18} />
              {tuned ? (
                <>
                  <span className={styles.mono}>{tuned.name}</span>
                  {tuned.inTune && <span className={styles.ok}>in tune</span>}
                </>
              ) : (
                "Tuner"
              )}
            </>
          }
        >
          <TunerPanel compact autoStart a4Hz={settings.a4Hz} onA4Change={(hz) => onSettingsChange({ ...settings, a4Hz: hz })} onReading={setTuned} />
        </Popover>
      )}

      {hide !== "metronome" && hide !== "recorder" && (
        <Popover
          label="Metronome"
          width={300}
          open={open === "metro"}
          onOpenChange={(v) => setOpen(v ? "metro" : null)}
          triggerClassName={`${styles.chip}${open === "metro" ? ` ${styles.chipOn}` : ""}`}
          trigger={
            <>
              <MetronomeIcon size={18} className={metroRunning ? styles.live : undefined} />
              <span className={styles.mono}>{practice ? Math.round(practice.bpm) : bpm}</span>
              <span className={styles.unit}>BPM</span>
            </>
          }
        >
          {practice ? (
            <div className={styles.panel}>
              <div className={styles.bigBpm}>
                <span className={styles.mono}>{Math.round(practice.bpm)}</span>
                <span className={styles.unit}>BPM</span>
              </div>
              <p className={styles.hint}>
                {practice.videoClock
                  ? "Video is the clock. The video sets the tempo, so there is no click."
                  : "This follows the song at the practice tempo. Change it with the transport."}
              </p>
            </div>
          ) : (
            <div className={styles.panel}>
              <div className={styles.bpmRow}>
                <Button variant="ghost" aria-label="Slower" onClick={() => bump(-1)}>
                  <Minus size={16} />
                </Button>
                <div className={styles.bigBpm}>
                  <span className={styles.mono}>{bpm}</span>
                  <span className={styles.unit}>BPM</span>
                </div>
                <Button variant="ghost" aria-label="Faster" onClick={() => bump(1)}>
                  <Plus size={16} />
                </Button>
              </div>
              <Slider min={FREE_MIN_BPM} max={FREE_MAX_BPM} value={bpm} label="BPM" onChange={setBpm} />
              <div className={styles.actions}>
                <Button variant="primary" icon={metroRunning ? <Pause size={16} /> : <Play size={16} />} onClick={() => void toggleMetro()}>
                  {metroRunning ? "Stop" : "Start"}
                </Button>
                <Button onClick={tap}>Tap tempo</Button>
              </div>
            </div>
          )}
        </Popover>
      )}

      {levelSource && (
        <Popover
          label="Microphone level"
          width={300}
          open={open === "mic"}
          onOpenChange={(v) => setOpen(v ? "mic" : null)}
          triggerClassName={`${styles.chip}${open === "mic" ? ` ${styles.chipOn}` : ""}`}
          trigger={
            <>
              <Meter bars={level.bars} tone={levelText.tone} label={levelText.word} />
              <span className={levelText.tone === "neutral" ? undefined : styles[`tone_${levelText.tone}`]}>{levelText.word}</span>
            </>
          }
        >
          <div className={styles.panel}>
            <Meter bars={level.bars} tone={levelText.tone} label={levelText.word} />
            <p className={styles.hint}>{levelText.hint}</p>
          </div>
        </Popover>
      )}

      {hide !== "recorder" && (
        <button
          type="button"
          className={`${styles.chip} ${styles.record}${recording ? ` ${styles.recording}` : ""}`}
          onClick={toggleQuick}
          title={recording ? "Stop and save (R)" : "Quick record (R)"}
          aria-pressed={recording}
        >
          {recording ? <Square size={14} fill="currentColor" /> : <span className={styles.dot} />}
          {recording ? <span className={styles.mono}>{mm(elapsed)}</span> : practice ? "Record this take" : "Record"}
        </button>
      )}
    </div>
  );
}
