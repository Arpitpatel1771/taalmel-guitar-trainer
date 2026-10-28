// String-by-string mic check (chord practice spec section 4). The state
// machine lives in chords/practice/micCheck.ts; this wires it to the mic.

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, RotateCcw, SkipForward, ChevronRight } from "lucide-react";
import { getAudioContext, MicError, resumeAudio, TunerInput } from "../../audio";
import {
  createCheck,
  currentExpected,
  feed,
  retry,
  skip,
  summary,
  type CheckState,
  type StringResult,
} from "../../chords/practice/micCheck";
import { ChordDiagram } from "../components/ChordDiagram";
import type { PracticeModeProps } from "./ChordPractice";
import { ChordPicker } from "./ChordPicker";
import { markedChords, pickedDiagramInfo, pickedKey, pickedName, pickedVoicings, pretty, type PickedChord } from "./picked";
import st from "./ChordPractice.module.css";
import mc from "./MicCheck.module.css";

declare global {
  interface Window {
    /** Dev-only: feeds the mic check as if from the mic (null = silence). */
    __taalmelMicFeed?: (freq: number | null) => void;
  }
}

const DEFAULT_CHORD: PickedChord = { rootPc: 0, typeId: "maj", spelling: "sharp" };
const MARK: Record<StringResult, string> = { pending: "·", ok: "✓", wrong: "✗", skipped: "skipped", muted: "don't play" };

function micErrorText(err: unknown): string {
  return err instanceof MicError
    ? err.kind === "denied"
      ? "Microphone permission was denied."
      : err.kind === "nodevice"
        ? "No microphone was found."
        : err.message
    : err instanceof Error
      ? err.message
      : String(err);
}

export function MicCheck({ settings, initial }: PracticeModeProps) {
  const [chord, setChord] = useState<PickedChord>(initial?.chord ?? DEFAULT_CHORD);
  const [voicingId, setVoicingId] = useState<string | undefined>(initial?.voicingId);
  const [check, setCheck] = useState<CheckState | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checkRef = useRef<CheckState | null>(null);
  const inputRef = useRef<TunerInput | null>(null);
  const a4Ref = useRef(settings.a4Hz);
  a4Ref.current = settings.a4Hz;

  const voicings = pickedVoicings(chord);
  const voicing = voicings.find((v) => v.id === voicingId) ?? voicings[0];
  const voicingRef = useRef(voicing);
  voicingRef.current = voicing;

  function apply(next: CheckState | null) {
    checkRef.current = next;
    setCheck(next);
  }

  function stopMic() {
    inputRef.current?.stop();
    inputRef.current = null;
    setRunning(false);
  }

  function onSample(freq: number | null) {
    const cur = checkRef.current;
    if (!cur || cur.done) return;
    const r = feed(cur, freq, performance.now());
    if (r.state !== cur) apply(r.state);
    if (r.state.done) stopMic();
  }

  async function begin() {
    if (!voicing) return;
    setError(null);
    stopMic();
    apply(createCheck(voicing, a4Ref.current));
    try {
      await resumeAudio();
      inputRef.current = await TunerInput.start(getAudioContext(), (f) => onSample(f));
      setRunning(true);
      if (checkRef.current?.done) stopMic();
    } catch (err) {
      apply(null);
      setError(micErrorText(err));
    }
  }

  function reset() {
    stopMic();
    apply(null);
    setError(null);
  }

  useEffect(() => {
    if (import.meta.env.DEV) {
      window.__taalmelMicFeed = (freq) => {
        if (!checkRef.current && voicingRef.current) apply(createCheck(voicingRef.current, a4Ref.current));
        onSample(freq);
      };
    }
    return () => {
      if (import.meta.env.DEV) delete window.__taalmelMicFeed;
      inputRef.current?.stop();
      inputRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function doSkip() {
    const cur = checkRef.current;
    if (!cur) return;
    const r = skip(cur);
    apply(r.state);
    if (r.state.done) stopMic();
  }

  function doRetry() {
    if (checkRef.current) apply(retry(checkRef.current));
  }

  const mine = markedChords(settings.chordMarks);
  const idx = mine.findIndex((p) => pickedKey(p) === pickedKey(chord));
  const next = mine.length > 0 ? mine[(idx + 1) % mine.length] : null;
  const nextUseful = next && pickedKey(next) !== pickedKey(chord) ? next : null;

  function goNext() {
    if (!nextUseful) return;
    reset();
    setChord(nextUseful);
    setVoicingId(undefined);
  }

  const info = pickedDiagramInfo(chord);
  const cur = check ? currentExpected(check) : null;
  const rows = check ? summary(check) : null;

  return (
    <div className={st.card}>
      <ChordPicker
        label="Chord"
        value={chord}
        marks={settings.chordMarks}
        onChange={(p) => {
          reset();
          setChord(p);
          setVoicingId(undefined);
        }}
      />
      {voicings.length > 1 && (
        <label className={mc.voicing}>
          <span className={st.pickerLabel}>Voicing</span>
          <select
            aria-label="Voicing"
            value={voicing?.id ?? ""}
            onChange={(e) => {
              reset();
              setVoicingId(e.target.value);
            }}
          >
            {voicings.map((v, i) => (
              <option key={v.id} value={v.id}>
                Shape {i + 1}: {v.frets.map((x) => (x === null ? "x" : x)).join(" ")}
              </option>
            ))}
          </select>
        </label>
      )}

      {voicing && (
        <div className={mc.body}>
          <ChordDiagram
            voicing={voicing}
            rootPc={info.rootPc}
            typeId={info.typeId}
            spelling={info.spelling}
            bassPc={info.bassPc}
            title={pretty(pickedName(chord))}
            labels={settings.chordView.labels}
            orientation={settings.chordView.orientation}
            leftHanded={settings.leftHanded}
            showNoteNames={settings.chordView.noteNames}
          />
          <div className={mc.side}>
            <ol className={mc.strings} aria-label="Strings">
              {voicing.frets.map((fret, i) => {
                const result = rows?.[i].result ?? (fret === null ? "muted" : "pending");
                const isCur = !!cur && cur.string === 6 - i;
                return (
                  <li
                    key={i}
                    className={`${mc.pill} ${mc[result]}${isCur ? ` ${mc.current}` : ""}`}
                    data-string={6 - i}
                    data-result={result}
                    aria-current={isCur ? "step" : undefined}
                  >
                    <span className={mc.num}>{6 - i}</span>
                    <span className={mc.mark}>{isCur ? "now" : MARK[result]}</span>
                  </li>
                );
              })}
            </ol>

            {!check && <p className={st.pickerLabel}>Strum nothing: pick each string one at a time, low to high.</p>}
            {check && !check.done && cur && (
              <>
                <p className={mc.prompt} aria-live="polite">
                  Pick string {cur.string} ({cur.name})
                </p>
                {check.hint?.kind === "wrong" && (
                  <div className="notice notice-error" role="status">
                    Heard {check.hint.heard}, expected {check.hint.expected}:{" "}
                    {check.hint.fret === 0 ? "play the string open" : `check your finger on fret ${check.hint.fret}`}
                  </div>
                )}
                {check.hint?.kind === "nothing" && (
                  <div className="notice" role="status">
                    Nothing clear: muted, or buzzing against a finger?
                  </div>
                )}
                <div className={mc.row}>
                  <button type="button" onClick={doRetry}>
                    <RotateCcw size={15} /> Retry
                  </button>
                  <button type="button" onClick={doSkip}>
                    <SkipForward size={15} /> Skip
                  </button>
                </div>
              </>
            )}
            {check?.done && rows && (
              <>
                <p className={mc.prompt}>Done</p>
                <ul className={mc.summary}>
                  {rows.map((r) => (
                    <li key={r.index} data-result={r.result}>
                      String {r.string}
                      {r.expected ? ` (${r.expected})` : ""}:{" "}
                      {r.result === "ok" ? "✓" : r.result === "wrong" ? "wrong note" : r.result === "skipped" ? "skipped" : "don't play"}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>
      )}

      <div className={mc.row}>
        {check?.done ? (
          <>
            <button type="button" className="btn-primary" onClick={() => void begin()}>
              <RotateCcw size={15} /> Again
            </button>
            {nextUseful && (
              <button type="button" onClick={goNext}>
                Next chord: {pretty(pickedName(nextUseful))} <ChevronRight size={15} />
              </button>
            )}
          </>
        ) : running ? (
          <button type="button" onClick={reset}>
            <MicOff size={15} /> Stop
          </button>
        ) : (
          <button type="button" className="btn-primary" onClick={() => void begin()} disabled={!voicing}>
            <Mic size={15} /> Start
          </button>
        )}
      </div>
      {error && <div className="notice notice-error">{error}</div>}
    </div>
  );
}
