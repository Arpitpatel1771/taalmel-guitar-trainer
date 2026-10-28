// One-minute changes (chord practice spec section 1): count clean switches
// between two chords against a timer. Counting is manual.

import { useEffect, useRef, useState } from "react";
import { FREE_MAX_BPM, FREE_MIN_BPM, FreeMetronome, getAudioContext, resumeAudio } from "../../audio";
import { parseChordName } from "../../chords";
import { pairKey, perMinute, recordRun } from "../../chords/practice/changes";
import { ChordDiagram } from "../components/ChordDiagram";
import { Field, Segmented, Stepper } from "../components/Controls";
import { ChordPicker } from "./ChordPicker";
import { pickedDiagramInfo, pickedKey, pickedName, pickedVoicings, pretty, type PickedChord } from "./picked";
import type { PracticeModeProps } from "./ChordPractice";
import st from "./ChordPractice.module.css";
import cs from "./OneMinuteChanges.module.css";

const SUGGESTED = ["A-D", "D-E", "A-E", "G-C", "C-G7", "Am-E", "D-Am", "G-D", "C-F", "Em-D", "Am-Dm", "E-Am"];

function toPicked(name: string): PickedChord | null {
  const p = parseChordName(name);
  return p ? ("slash" in p ? { slash: p.slash } : { rootPc: p.rootPc, typeId: p.typeId, spelling: p.spelling }) : null;
}

const SUGGESTED_PAIRS = SUGGESTED.map((s) => {
  const [a, b] = s.split("-");
  const pa = toPicked(a);
  const pb = toPicked(b);
  return pa && pb ? { label: s.replace("-", " - "), a: pa, b: pb } : null;
}).filter((x): x is { label: string; a: PickedChord; b: PickedChord } => x !== null);

type Phase = "setup" | "countdown" | "running" | "done";
type Result = { count: number; seconds: number; rate: number; isBest: boolean; previousBest: number | null; key: string };

function ChordCard({ chord, on, settings }: { chord: PickedChord; on: boolean; settings: PracticeModeProps["settings"] }) {
  const v = pickedVoicings(chord)[0];
  const info = pickedDiagramInfo(chord);
  return (
    <div className={`${cs.target}${on ? ` ${cs.targetOn}` : ""}`} aria-current={on}>
      <span className={cs.targetName}>{pretty(pickedName(chord))}</span>
      {v && (
        <ChordDiagram
          voicing={v}
          rootPc={info.rootPc}
          typeId={info.typeId}
          spelling={info.spelling}
          bassPc={info.bassPc}
          labels={settings.chordView.labels}
          orientation={settings.chordView.orientation}
          leftHanded={settings.leftHanded}
          showNoteNames={settings.chordView.noteNames}
        />
      )}
    </div>
  );
}

export function OneMinuteChanges({ settings, onChange, initial }: PracticeModeProps) {
  const [a, setA] = useState<PickedChord>(initial?.chord ?? SUGGESTED_PAIRS[0]?.a ?? { rootPc: 9, typeId: "maj", spelling: "sharp" });
  const [b, setB] = useState<PickedChord>(SUGGESTED_PAIRS[0]?.b ?? { rootPc: 2, typeId: "maj", spelling: "sharp" });
  const [duration, setDuration] = useState(60);
  const [click, setClick] = useState(false);
  const [bpm, setBpm] = useState(60);
  const [phase, setPhase] = useState<Phase>("setup");
  const [countdown, setCountdown] = useState(3);
  const [remaining, setRemaining] = useState(60);
  const [count, setCount] = useState(0);
  const [result, setResult] = useState<Result | null>(null);

  const timers = useRef<{ tick?: ReturnType<typeof setInterval> }>({});
  const metro = useRef<FreeMetronome | null>(null);
  const countRef = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  function clearTimers() {
    clearInterval(timers.current.tick);
    timers.current.tick = undefined;
    metro.current?.stop();
  }
  useEffect(() => clearTimers, []);

  function reset() {
    clearTimers();
    setPhase("setup");
  }

  async function start() {
    clearTimers();
    countRef.current = 0;
    setCount(0);
    setResult(null);
    setCountdown(3);
    setRemaining(duration);
    setPhase("countdown");
    if (click) {
      await resumeAudio();
      if (!metro.current) metro.current = new FreeMetronome(getAudioContext());
      metro.current.setBpm(bpm);
      metro.current.setVolume(settings.metronomeVolume);
      metro.current.start();
    }
    let n = 3;
    timers.current.tick = setInterval(() => {
      n -= 1;
      if (n > 0) {
        setCountdown(n);
        return;
      }
      clearInterval(timers.current.tick);
      setPhase("running");
      const endAt = Date.now() + duration * 1000;
      timers.current.tick = setInterval(() => {
        const left = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
        setRemaining(left);
        if (left <= 0) finish();
      }, 200);
    }, 1000);
  }

  function finish() {
    clearTimers();
    const key = pairKey(pickedKey(a), pickedKey(b));
    const n = countRef.current;
    const r = recordRun(settingsRef.current.chordStats, key, { at: new Date().toISOString(), count: n, seconds: duration });
    onChangeRef.current({ ...settingsRef.current, chordStats: r.stats });
    setResult({ count: n, seconds: duration, rate: perMinute(n, duration), isBest: r.isBest, previousBest: r.previousBest, key });
    setPhase("done");
  }

  function change() {
    countRef.current += 1;
    setCount(countRef.current);
  }

  const changeRef = useRef(change);
  changeRef.current = change;
  useEffect(() => {
    if (phase !== "running") return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== " " && e.code !== "Space") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      e.preventDefault();
      if (e.repeat) return;
      changeRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  const mm = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const active = phase === "countdown" || phase === "running";
  const aIsTarget = count % 2 === 0;

  if (phase === "setup") {
    return (
      <div className={st.card}>
        <div className={cs.pairs}>
          <ChordPicker label="Chord A" value={a} onChange={setA} marks={settings.chordMarks} />
          <ChordPicker label="Chord B" value={b} onChange={setB} marks={settings.chordMarks} />
        </div>
        <div className={st.chips} aria-label="Suggested pairs">
          {SUGGESTED_PAIRS.map((p) => (
            <button
              key={p.label}
              type="button"
              className={`${st.chip}${pairKey(pickedKey(p.a), pickedKey(p.b)) === pairKey(pickedKey(a), pickedKey(b)) ? ` ${st.chipOn}` : ""}`}
              onClick={() => {
                setA(p.a);
                setB(p.b);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className={cs.options}>
          <Field label="Duration">
            <Segmented
              label="Duration"
              value={duration}
              options={[30, 60, 120].map((d) => ({ value: d, label: `${d} s` }))}
              onChange={setDuration}
            />
          </Field>
          <Field label="Click">
            <Segmented
              label="Click"
              value={click ? "on" : "off"}
              options={[{ value: "off", label: "Off" }, { value: "on", label: "On" }]}
              onChange={(v) => setClick(v === "on")}
            />
          </Field>
          {click && (
            <Field label="BPM">
              <Stepper label="BPM" value={bpm} onChange={setBpm} min={FREE_MIN_BPM} max={FREE_MAX_BPM} />
            </Field>
          )}
        </div>
        <div className={cs.diagrams}>
          <ChordCard chord={a} on settings={settings} />
          <ChordCard chord={b} on settings={settings} />
        </div>
        <div className={cs.actions}>
          <button type="button" className="primary" onClick={start}>Start</button>
        </div>
      </div>
    );
  }

  if (phase === "done" && result) {
    const history = settings.chordStats.changes[result.key]?.history.slice(-10) ?? [];
    const rates = history.map((h) => perMinute(h.count, h.seconds));
    const max = Math.max(1, ...rates);
    return (
      <div className={`${st.card} ${cs.result}`}>
        <span className={cs.big}>{result.count}</span>
        <span>changes in {result.seconds} s ({result.rate} per minute)</span>
        {result.isBest ? (
          <span className={cs.best}>New best!</span>
        ) : (
          <span className={cs.muted}>Best: {result.previousBest} per minute</span>
        )}
        <div className={cs.chart} aria-label="Last runs, changes per minute">
          {rates.map((r, i) => (
            <div key={i} className={cs.barCol}>
              <span>{r}</span>
              <div className={`${cs.bar}${i === rates.length - 1 ? ` ${cs.barLast}` : ""}`} style={{ height: `${(r / max) * 80}%` }} />
            </div>
          ))}
        </div>
        <div className={cs.actions}>
          <button type="button" className="primary" onClick={start}>Again</button>
          <button type="button" onClick={reset}>Done</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`${st.card} ${cs.run}`}>
      {phase === "countdown" ? (
        <div className={cs.countdown} role="timer" aria-live="polite">{countdown}</div>
      ) : (
        <>
          <div className={cs.timer} role="timer">{mm(remaining)}</div>
          <div className={cs.count}>{count} changes</div>
        </>
      )}
      <div className={cs.diagrams}>
        <ChordCard chord={a} on={phase === "running" ? aIsTarget : true} settings={settings} />
        <ChordCard chord={b} on={phase === "running" ? !aIsTarget : true} settings={settings} />
      </div>
      {phase === "running" && (
        <button type="button" className={`primary ${cs.changeBtn}`} onClick={change}>Change</button>
      )}
      <div className={cs.actions}>
        {active && <button type="button" onClick={reset}>Stop</button>}
      </div>
    </div>
  );
}
