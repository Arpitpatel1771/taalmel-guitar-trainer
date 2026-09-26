// Exercises screen (spec 12.1, 12.2): generator forms -> preview/practice ->
// "Save as song". Generated text goes through the normal parser/player, no
// special handling (spec 4.1).

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bug, Drum, Save, Waves } from "lucide-react";
import { Field, Segmented, Stepper } from "../components/Controls";
import { ProblemsPanel } from "../editor/ProblemsPanel";
import ex from "./Exercises.module.css";
import type { Settings, StringNumber } from "../../model";
import { parse } from "../../songFormat";
import {
  chromatic,
  rhythm,
  spider,
  DEFAULT_CHROMATIC_PARAMS,
  DEFAULT_RHYTHM_PARAMS,
  DEFAULT_SPIDER_PARAMS,
  type ChromaticDirection,
  type ChromaticGrid,
  type RhythmPresetName,
} from "../../exercises";
import { PracticeArea } from "./SongView";

export interface ExercisesProps {
  settings: Settings;
  onSaveAsSong: (text: string) => Promise<{ ok: true; id: string } | { ok: false; message: string }>;
  onSaved: (id: string) => void;
  onBack: () => void;
  onSettingsChange?: (next: Settings) => void;
}

type Kind = "chromatic" | "spider" | "rhythm";
const ALL_STRINGS: StringNumber[] = [1, 2, 3, 4, 5, 6];
const RHYTHM_PRESET_NAMES: RhythmPresetName[] = [
  "quarters",
  "eighths",
  "triplets",
  "sixteenths",
  "offbeatEighths",
  "gallop",
];

export function Exercises({ settings, onSaveAsSong, onSaved, onSettingsChange }: ExercisesProps) {
  const [kind, setKind] = useState<Kind>("chromatic");
  const [bpm, setBpm] = useState(DEFAULT_CHROMATIC_PARAMS.bpm);
  const [bars, setBars] = useState(DEFAULT_CHROMATIC_PARAMS.bars);
  const [grid, setGrid] = useState<ChromaticGrid>(DEFAULT_CHROMATIC_PARAMS.grid);

  const [startFret, setStartFret] = useState(DEFAULT_CHROMATIC_PARAMS.startFret);
  const [stringsLowToHigh, setStringsLowToHigh] = useState(true);
  const [pattern, setPattern] = useState(DEFAULT_CHROMATIC_PARAMS.pattern);
  const [direction, setDirection] = useState<ChromaticDirection>(DEFAULT_CHROMATIC_PARAMS.direction);

  const [startStringPair, setStartStringPair] = useState<1 | 2 | 3 | 4>(DEFAULT_SPIDER_PARAMS.startStringPair);

  const [rhythmString, setRhythmString] = useState<StringNumber>(DEFAULT_RHYTHM_PARAMS.string);
  const [rhythmFret, setRhythmFret] = useState(DEFAULT_RHYTHM_PARAMS.fret);
  const [rhythmMuted, setRhythmMuted] = useState(DEFAULT_RHYTHM_PARAMS.muted);
  const [rhythmPreset, setRhythmPreset] = useState<RhythmPresetName>("eighths");

  const [text, setText] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const parseResult = useMemo(() => (text !== null ? parse(text) : null), [text]);

  function generate() {
    setGenError(null);
    try {
      let result: string;
      if (kind === "chromatic") {
        const strings = stringsLowToHigh ? [...ALL_STRINGS].reverse() : ALL_STRINGS;
        result = chromatic({ bpm, startFret, strings, pattern, grid, bars, direction });
      } else if (kind === "spider") {
        result = spider({ bpm, startFret, startStringPair, grid, bars });
      } else {
        result = rhythm({ bpm, string: rhythmString, fret: rhythmFret, muted: rhythmMuted, pattern: rhythmPreset, bars });
      }
      setText(result);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err));
      setText(null);
    }
  }

  async function handleSaveAsSong() {
    if (!text) return;
    setSaving(true);
    setSaveError(null);
    const result = await onSaveAsSong(text);
    setSaving(false);
    if (result.ok) onSaved(result.id);
    else setSaveError(result.message);
  }

  // Live preview: regenerate shortly after any parameter changes (revamp 8).
  useEffect(() => {
    const t = window.setTimeout(generate, 150);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, bpm, bars, grid, startFret, stringsLowToHigh, pattern, direction, startStringPair, rhythmString, rhythmFret, rhythmMuted, rhythmPreset]);

  const KINDS: { id: Kind; name: string; desc: string; icon: ReactNode }[] = [
    { id: "chromatic", name: "Chromatic", desc: "Four-finger runs across the strings.", icon: <Waves size={16} /> },
    { id: "spider", name: "Spider", desc: "Alternating string pairs for finger independence.", icon: <Bug size={16} /> },
    { id: "rhythm", name: "Rhythm", desc: "One note on a rhythm pattern, to lock in timing.", icon: <Drum size={16} /> },
  ];
  const GRID_OPTIONS = [4, 8, 12, 16].map((g) => ({ value: g as ChromaticGrid, label: String(g) }));

  return (
    <div className="screen exercises-screen">
      <div className="screen-header">
        <h2>Exercises</h2>
        <button className="btn-primary" disabled={saving || !parseResult?.ok} onClick={() => void handleSaveAsSong()}>
          <Save size={15} /> {saving ? "Saving…" : "Save as song"}
        </button>
      </div>

      <div className={ex.picker} role="radiogroup" aria-label="Exercise type">
        {KINDS.map((k) => (
          <button
            key={k.id}
            role="radio"
            aria-checked={kind === k.id}
            className={`${ex.kind}${kind === k.id ? ` ${ex.kindOn}` : ""}`}
            onClick={() => setKind(k.id)}
          >
            <span className={ex.kindName}>
              {k.icon} {k.name}
            </span>
            <span className={ex.kindDesc}>{k.desc}</span>
          </button>
        ))}
      </div>

      {saveError && <div className="notice notice-error">{saveError}</div>}

      <div className={ex.body}>
        <div className={ex.panel}>
          <div className={ex.panelTitle}>Settings</div>
          <Field label="BPM">
            <Stepper label="BPM" value={bpm} onChange={setBpm} min={20} max={400} step={5} />
          </Field>
          <Field label="Bars">
            <Stepper label="Bars" value={bars} onChange={setBars} min={1} max={32} />
          </Field>
          {kind !== "rhythm" && (
            <Field label="Grid (notes per bar)">
              <Segmented label="Grid" value={grid} options={GRID_OPTIONS} onChange={setGrid} />
            </Field>
          )}
          {kind !== "rhythm" && (
            <Field label="Start fret">
              <Stepper label="Start fret" value={startFret} onChange={setStartFret} min={1} max={20} />
            </Field>
          )}
          {kind === "chromatic" && (
            <>
              <Field label="Finger pattern">
                <Segmented
                  label="Finger pattern"
                  value={["1234", "1324", "1243", "4321"].includes(pattern) ? pattern : "custom"}
                  options={[
                    { value: "1234", label: "1234" },
                    { value: "1324", label: "1324" },
                    { value: "1243", label: "1243" },
                    { value: "4321", label: "4321" },
                    { value: "custom", label: "Custom" },
                  ]}
                  onChange={(v) => setPattern(v === "custom" ? "2143" : v)}
                />
              </Field>
              {!["1234", "1324", "1243", "4321"].includes(pattern) && (
                <div className={ex.patternRow}>
                  <input value={pattern} onChange={(e) => setPattern(e.target.value)} aria-label="Custom finger pattern" maxLength={4} />
                  <span className="hint">any order of 1-4</span>
                </div>
              )}
              <Field label="String order">
                <Segmented
                  label="String order"
                  value={stringsLowToHigh ? "low" : "high"}
                  options={[
                    { value: "low", label: "Low → high" },
                    { value: "high", label: "High → low" },
                  ]}
                  onChange={(v) => setStringsLowToHigh(v === "low")}
                />
              </Field>
              <Field label="Direction">
                <Segmented
                  label="Direction"
                  value={direction}
                  options={[
                    { value: "ascending" as ChromaticDirection, label: "Up" },
                    { value: "descending" as ChromaticDirection, label: "Down" },
                    { value: "both" as ChromaticDirection, label: "Both" },
                  ]}
                  onChange={setDirection}
                />
              </Field>
            </>
          )}
          {kind === "spider" && (
            <Field label="Starting string pair">
              <Segmented
                label="Starting string pair"
                value={startStringPair}
                options={[
                  { value: 1 as const, label: "1&3" },
                  { value: 2 as const, label: "2&4" },
                  { value: 3 as const, label: "3&5" },
                  { value: 4 as const, label: "4&6" },
                ]}
                onChange={setStartStringPair}
              />
            </Field>
          )}
          {kind === "rhythm" && (
            <>
              <Field label="Pattern">
                <select value={rhythmPreset} onChange={(e) => setRhythmPreset(e.target.value as RhythmPresetName)}>
                  {RHYTHM_PRESET_NAMES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="String">
                <Segmented
                  label="String"
                  value={rhythmString}
                  options={ALL_STRINGS.map((st) => ({ value: st, label: String(st) }))}
                  onChange={setRhythmString}
                />
              </Field>
              <Field label="Fret">
                <Stepper label="Fret" value={rhythmFret} onChange={setRhythmFret} min={0} max={24} />
              </Field>
              <label className={ex.check}>
                <input type="checkbox" checked={rhythmMuted} onChange={(e) => setRhythmMuted(e.target.checked)} />
                Muted
              </label>
            </>
          )}
          {genError && <div className="notice notice-error">{genError}</div>}
        </div>

        <div className={ex.practice}>
          {parseResult && !parseResult.ok && <ProblemsPanel errors={parseResult.errors} onJump={() => {}} />}
          {parseResult && parseResult.ok && (
            <PracticeArea
              song={parseResult.song}
              settings={settings}
              onOffsetNudge={() => {}}
              onSetBar1Here={() => {}}
              onSettingsChange={onSettingsChange}
            />
          )}
        </div>
      </div>
    </div>
  );
}
