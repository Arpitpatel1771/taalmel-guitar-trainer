// Strum-along progressions (chord practice spec 3): pick or type a progression,
// then strum along to a click and synthetic strums scheduled on audio time.

import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { FreeMetronome, getAudioContext, resumeAudio, scheduleChord } from "../../audio";
import { STRUM_PATTERNS, type StrumPatternName } from "../../exercises/strumming";
import { chordType, type Spelling } from "../../chords";
import {
  PROGRESSION_PRESETS,
  buildTimeline,
  parseCustomProgression,
  resolveNumerals,
  type KeyMode,
  type ProgChord,
} from "../../chords/practice/progressions";
import { ChordDiagram } from "../components/ChordDiagram";
import { Field, Segmented, Stepper } from "../components/Controls";
import { pickedDiagramInfo, pickedName, pickedVoicings, pretty } from "./picked";
import type { PracticeModeProps } from "./ChordPractice";
import st from "./ChordPractice.module.css";
import ps from "./Progressions.module.css";

const KEYS: { pc: number; spelling: Spelling; label: string }[] = [
  { pc: 0, spelling: "sharp", label: "C" },
  { pc: 1, spelling: "flat", label: "Db" },
  { pc: 2, spelling: "sharp", label: "D" },
  { pc: 3, spelling: "flat", label: "Eb" },
  { pc: 4, spelling: "sharp", label: "E" },
  { pc: 5, spelling: "flat", label: "F" },
  { pc: 6, spelling: "sharp", label: "F#" },
  { pc: 7, spelling: "sharp", label: "G" },
  { pc: 8, spelling: "flat", label: "Ab" },
  { pc: 9, spelling: "sharp", label: "A" },
  { pc: 10, spelling: "flat", label: "Bb" },
  { pc: 11, spelling: "sharp", label: "B" },
];

const BEATS = 4;
type Pos = { bar: number; beat: number }; // bar -1 = count-in

export function Progressions({ settings, initial }: PracticeModeProps) {
  const [presetId, setPresetId] = useState("I-V-vi-IV");
  const [keyPc, setKeyPc] = useState(7);
  const [mode, setMode] = useState<KeyMode>("major");
  const [custom, setCustom] = useState("G C D Em");
  const [barsPer, setBarsPer] = useState<1 | 2>(1);
  const [bpm, setBpm] = useState(80);
  const [pattern, setPattern] = useState<StrumPatternName>("downEighths");
  const [synth, setSynth] = useState(true);
  const [click, setClick] = useState(true);
  const [loop, setLoop] = useState(true);
  const [countIn, setCountIn] = useState(true);
  const [pos, setPos] = useState<Pos | null>(null);

  const preset = PROGRESSION_PRESETS.find((p) => p.id === presetId);
  const key = KEYS.find((k) => k.pc === keyPc)!;
  const bars = preset?.fixedBars ?? barsPer;

  const { chords, errors } = useMemo(
    () => (preset ? resolveNumerals(preset.tokens, { rootPc: key.pc, spelling: key.spelling }, mode) : parseCustomProgression(custom)),
    [preset, key, mode, custom],
  );
  const voicings = useMemo(() => chords.map((c) => pickedVoicings(c)[0]), [chords]);
  const timeline = useMemo(() => buildTimeline(chords.length, bars, STRUM_PATTERNS[pattern], BEATS), [chords.length, bars, pattern]);

  // Live values for the audio scheduler.
  const live = useRef({ timeline, voicings, bpm, synth, click, loop, countIn, settings });
  live.current = { timeline, voicings, bpm, synth, click, loop, countIn, settings };

  const metroRef = useRef<FreeMetronome | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const sources = useRef<AudioBufferSourceNode[]>([]);
  const offBeat = useRef<(() => void) | null>(null);

  function halt() {
    metroRef.current?.stop();
    offBeat.current?.();
    offBeat.current = null;
    for (const t of timers.current) clearTimeout(t);
    timers.current.clear();
    for (const s of sources.current) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    sources.current = [];
    setPos(null);
  }
  useEffect(() => halt, []);
  useEffect(() => {
    metroRef.current?.setBpm(bpm);
  }, [bpm]);

  async function start() {
    halt();
    await resumeAudio();
    const ctx = getAudioContext();
    const m = (metroRef.current ??= new FreeMetronome(ctx));
    m.setBeatsPerBar(BEATS);
    m.setBpm(live.current.bpm);
    m.setVolume(live.current.click ? live.current.settings.metronomeVolume : 0);
    const countBeats = live.current.countIn ? BEATS : 0;
    let n = 0;
    offBeat.current = m.onBeat((_b, time) => {
      const L = live.current;
      const total = L.timeline.length;
      if (total === 0) return;
      const rel = n - countBeats;
      n++;
      const barRaw = Math.floor(rel / BEATS);
      const beat = ((rel % BEATS) + BEATS) % BEATS;
      const lastBeat = !L.loop && barRaw === total - 1 && beat === BEATS - 1;
      if (barRaw >= total && !L.loop) {
        halt();
        return;
      }
      const bar = rel < 0 ? -1 : barRaw % total;
      const shown: Pos = rel < 0 ? { bar: -1, beat: n - 1 } : { bar, beat };
      const id = setTimeout(() => {
        timers.current.delete(id);
        setPos(shown);
      }, Math.max(0, (time - ctx.currentTime) * 1000));
      timers.current.add(id);
      m.setVolume(L.click && !lastBeat ? L.settings.metronomeVolume : 0);
      if (lastBeat) {
        const stopId = setTimeout(halt, Math.max(0, (time - ctx.currentTime) * 1000) + 60000 / L.bpm);
        timers.current.add(stopId);
      }
      if (bar < 0 || !L.synth) return;
      const spb = 60 / L.bpm;
      const tb = L.timeline[bar];
      const v = L.voicings[tb.chordIndex];
      if (!v) return;
      for (const s of tb.strums) {
        if (s.beat < beat || s.beat >= beat + 1) continue;
        sources.current.push(
          ...scheduleChord(v.frets, {
            when: time + (s.beat - beat) * spb,
            direction: s.direction,
            volume: L.settings.playNotesVolume,
            a4Hz: L.settings.a4Hz,
          }),
        );
      }
      if (sources.current.length > 200) sources.current = sources.current.slice(-100);
    });
    m.start();
    setPos({ bar: -1, beat: 0 });
  }

  const running = pos !== null;
  const chordIdx = pos && pos.bar >= 0 && timeline[pos.bar] ? timeline[pos.bar].chordIndex : 0;
  const nextIdx = chords.length ? (chordIdx + 1) % chords.length : 0;

  function diagram(c: ProgChord | undefined, size: number) {
    if (!c) return null;
    const v = pickedVoicings(c)[0];
    if (!v) return <span className={st.placeholder}>No shape</span>;
    const info = pickedDiagramInfo(c);
    return (
      <ChordDiagram
        voicing={v}
        rootPc={info.rootPc}
        typeId={info.typeId}
        spelling={info.spelling}
        bassPc={info.bassPc}
        title={`${pickedName(c)} (${chordType(info.typeId).name})`}
        labels={settings.chordView.labels}
        orientation={settings.chordView.orientation}
        leftHanded={settings.leftHanded}
        showNoteNames={settings.chordView.noteNames}
        size={size}
      />
    );
  }

  void initial;
  return (
    <div className={st.wrap}>
      <div className={st.card}>
        <Field label="Progression">
          <div className={st.chips}>
            {PROGRESSION_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`${st.chip}${presetId === p.id ? ` ${st.chipOn}` : ""}`}
                onClick={() => {
                  setPresetId(p.id);
                  setMode(p.mode);
                }}
              >
                {p.label}
              </button>
            ))}
            <button type="button" className={`${st.chip}${presetId === "custom" ? ` ${st.chipOn}` : ""}`} onClick={() => setPresetId("custom")}>
              Custom
            </button>
          </div>
        </Field>
        {preset ? (
          <div className={ps.opts}>
            <Field label="Key">
              <div className={st.chips}>
                {KEYS.map((k) => (
                  <button key={k.pc} type="button" className={`${st.chip}${keyPc === k.pc ? ` ${st.chipOn}` : ""}`} onClick={() => setKeyPc(k.pc)}>
                    {pretty(k.label)}
                  </button>
                ))}
              </div>
            </Field>
            <Segmented
              label="Mode"
              value={mode}
              options={[
                { value: "major", label: "Major" },
                { value: "minor", label: "Minor" },
              ]}
              onChange={setMode}
            />
          </div>
        ) : (
          <Field label="Chords (e.g. G C D Em)">
            <input className={ps.custom} type="text" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Custom chords" />
          </Field>
        )}
        {errors.length > 0 && <p className={ps.err}>Not recognised: {errors.join(", ")}</p>}

        <div className={ps.opts}>
          {!preset?.fixedBars && (
            <Field label="Bars per chord">
              <Segmented
                label="Bars per chord"
                value={barsPer}
                options={[
                  { value: 1, label: "1" },
                  { value: 2, label: "2" },
                ]}
                onChange={setBarsPer}
              />
            </Field>
          )}
          <Field label="BPM">
            <Stepper label="BPM" value={bpm} onChange={setBpm} min={40} max={200} />
          </Field>
          <Field label="Strum pattern">
            <select value={pattern} onChange={(e) => setPattern(e.target.value as StrumPatternName)} aria-label="Strum pattern">
              {(Object.keys(STRUM_PATTERNS) as StrumPatternName[]).map((k) => (
                <option key={k} value={k}>
                  {STRUM_PATTERNS[k].label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className={ps.toggles}>
          {(
            [
              ["Synth strums", synth, setSynth],
              ["Click", click, setClick],
              ["Loop", loop, setLoop],
              ["Count-in", countIn, setCountIn],
            ] as const
          ).map(([label, on, set]) => (
            <button key={label} type="button" aria-pressed={on} className={`${st.chip}${on ? ` ${st.chipOn}` : ""}`} onClick={() => set(!on)}>
              {label}
            </button>
          ))}
        </div>
        <div>
          {running ? (
            <button type="button" onClick={halt}>
              <Square size={14} /> Stop
            </button>
          ) : (
            <button type="button" onClick={() => void start()} disabled={chords.length === 0}>
              <Play size={14} /> Start
            </button>
          )}
        </div>
      </div>

      {chords.length > 0 && (
        <div className={st.card}>
          <div className={ps.stage}>
            <div className={ps.current}>
              <span className={ps.tag}>{pos && pos.bar < 0 ? "Count-in" : "Now"}</span>
              {diagram(chords[chordIdx], 28)}
              <span className={ps.cname}>{pretty(pickedName(chords[chordIdx]))}</span>
            </div>
            {chords.length > 1 && (
              <div className={ps.next}>
                <span className={ps.tag}>Next</span>
                {diagram(chords[nextIdx], 14)}
                <span className={ps.nname}>{pretty(pickedName(chords[nextIdx]))}</span>
              </div>
            )}
          </div>
          <div className={ps.strip} aria-label="Beat and bar position">
            <div className={ps.beats}>
              {Array.from({ length: BEATS }, (_, i) => (
                <span key={i} className={`${ps.beat}${pos && (pos.bar < 0 ? pos.beat % BEATS : pos.beat) === i ? ` ${ps.beatOn}` : ""}`} />
              ))}
            </div>
            <div className={ps.bars}>
              {timeline.map((_, i) => (
                <span key={i} className={`${ps.bar}${pos && pos.bar === i ? ` ${ps.barOn}` : ""}`} />
              ))}
            </div>
            {pos && pos.bar < 0 && <span className={ps.countIn}>{(pos.beat % BEATS) + 1}</span>}
          </div>
          <div className={st.chips}>
            {chords.map((c, i) => (
              <span key={i} className={`${st.chip}${running && pos && pos.bar >= 0 && i === chordIdx ? ` ${ps.chipCur}` : ""}`}>
                {pretty(pickedName(c))}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
