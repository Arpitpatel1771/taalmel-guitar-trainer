// Standalone metronome screen: independent of songs and exercises, 20-999 BPM.

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import type { Settings } from "../../model";
import {
  FreeMetronome,
  FREE_MAX_BPM,
  FREE_MIN_BPM,
  MAX_BEATS_PER_BAR,
  clampFreeBpm,
  getAudioContext,
  resumeAudio,
  type Subdivision,
} from "../../audio";
import { Field, Segmented, Stepper } from "../components/Controls";
import st from "./MetronomeScreen.module.css";

const SUBDIVISIONS: { value: Subdivision; label: string }[] = [
  { value: 1, label: "Quarter" },
  { value: 2, label: "Eighths" },
  { value: 3, label: "Triplets" },
  { value: 4, label: "Sixteenths" },
];

const TAP_RESET_MS = 2000;
const TAP_AVERAGE = 4;

export function MetronomeScreen({ settings, onChange }: { settings: Settings; onChange: (next: Settings) => void }) {
  const [bpm, setBpm] = useState(120);
  const [beatsPerBar, setBeatsPerBar] = useState(4);
  const [subdivision, setSubdivision] = useState<Subdivision>(1);
  const [accent, setAccent] = useState(true);
  const [running, setRunning] = useState(false);
  const [activeBeat, setActiveBeat] = useState<number | null>(null);
  const metroRef = useRef<FreeMetronome | null>(null);
  const tapsRef = useRef<number[]>([]);

  function metro(): FreeMetronome {
    if (!metroRef.current) metroRef.current = new FreeMetronome(getAudioContext());
    return metroRef.current;
  }

  useEffect(() => metro().setBpm(bpm), [bpm]);
  useEffect(() => metro().setBeatsPerBar(beatsPerBar), [beatsPerBar]);
  useEffect(() => metro().setSubdivision(subdivision), [subdivision]);
  useEffect(() => metro().setAccent(accent), [accent]);
  useEffect(() => metro().setVolume(settings.metronomeVolume), [settings.metronomeVolume]);

  // Beats are scheduled ~100 ms ahead; delay the flash to when each is heard.
  useEffect(() => {
    const m = metro();
    const pending = new Set<ReturnType<typeof setTimeout>>();
    const off = m.onBeat((beat, audioTime) => {
      const delayMs = Math.max(0, (audioTime - getAudioContext().currentTime) * 1000);
      const id = setTimeout(() => {
        pending.delete(id);
        setActiveBeat(beat);
      }, delayMs);
      pending.add(id);
    });
    return () => {
      off();
      pending.forEach(clearTimeout);
      m.stop();
    };
  }, []);

  async function toggle() {
    const m = metro();
    if (m.isRunning()) {
      m.stop();
      setRunning(false);
      setActiveBeat(null);
    } else {
      await resumeAudio();
      m.start();
      setRunning(true);
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

  // Space toggles start/stop unless typing in a field.
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code !== "Space" || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "BUTTON" || el.isContentEditable)) return;
      e.preventDefault();
      void toggleRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="screen">
      <div className="screen-header">
        <h2>Metronome</h2>
      </div>
      <div className={st.card}>
        <div className={st.dots} aria-hidden>
          {Array.from({ length: beatsPerBar }, (_, i) => (
            <span
              key={i}
              className={`${st.dot}${i === 0 && accent ? ` ${st.dotAccent}` : ""}${activeBeat === i ? ` ${st.dotOn}` : ""}`}
            />
          ))}
        </div>

        <div className={st.bpm}>
          <span className={st.bpmValue}>{bpm}</span>
          <span className={st.bpmUnit}>BPM</span>
        </div>

        <input
          className={st.slider}
          type="range"
          min={FREE_MIN_BPM}
          max={FREE_MAX_BPM}
          value={bpm}
          aria-label="BPM"
          onChange={(e) => setBpm(Number(e.target.value))}
        />

        <div className={st.row}>
          <Stepper label="BPM" value={bpm} onChange={setBpm} min={FREE_MIN_BPM} max={FREE_MAX_BPM} />
          <button type="button" onClick={tap}>
            Tap tempo
          </button>
        </div>

        <button type="button" className={`btn-primary ${st.start}`} onClick={() => void toggle()}>
          {running ? <Pause size={18} /> : <Play size={18} />}
          {running ? "Stop" : "Start"}
        </button>
        <span className={st.hint}>Space to start/stop</span>

        <div className={st.options}>
          <Field label="Beats per bar">
            <Stepper label="Beats per bar" value={beatsPerBar} onChange={setBeatsPerBar} min={1} max={MAX_BEATS_PER_BAR} />
          </Field>
          <Field label="Subdivision">
            <Segmented label="Subdivision" value={subdivision} options={SUBDIVISIONS} onChange={setSubdivision} />
          </Field>
          <Field label="Accent first beat">
            <input type="checkbox" aria-label="Accent first beat" checked={accent} onChange={(e) => setAccent(e.target.checked)} />
          </Field>
          <Field label="Volume">
            <div className={st.row}>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                aria-label="Volume"
                value={settings.metronomeVolume}
                onChange={(e) => onChange({ ...settings, metronomeVolume: Number(e.target.value) })}
              />
              <span className={st.volume}>{Math.round(settings.metronomeVolume * 100)}%</span>
            </div>
          </Field>
        </div>
      </div>
    </div>
  );
}
