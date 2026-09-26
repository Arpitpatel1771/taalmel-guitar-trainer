// Exercises screen (spec 12.1, 12.2): generator forms -> preview/practice ->
// "Save as song". Generated text goes through the normal parser/player, no
// special handling (spec 4.1).

import { useMemo, useState } from "react";
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
import { ErrorList } from "../components/ErrorList";
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

export function Exercises({ settings, onSaveAsSong, onSaved, onBack, onSettingsChange }: ExercisesProps) {
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

  return (
    <div className="screen exercises-screen">
      <div className="screen-header">
        <h2>Exercises</h2>
        <button onClick={onBack}>Back to library</button>
      </div>

      <div className="exercise-kind-tabs">
        {(["chromatic", "spider", "rhythm"] as Kind[]).map((k) => (
          <button key={k} className={kind === k ? "active" : ""} onClick={() => setKind(k)}>
            {k[0].toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>

      <div className="exercise-form">
        <label>
          BPM
          <input type="number" value={bpm} onChange={(e) => setBpm(Number(e.target.value))} />
        </label>
        <label>
          Bars
          <input type="number" min={1} max={32} value={bars} onChange={(e) => setBars(Number(e.target.value))} />
        </label>
        {kind !== "rhythm" && (
          <label>
            Grid
            <select value={grid} onChange={(e) => setGrid(Number(e.target.value) as ChromaticGrid)}>
              {[4, 8, 12, 16].map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
        )}

        {kind === "chromatic" && (
          <>
            <label>
              Start fret
              <input type="number" min={1} max={20} value={startFret} onChange={(e) => setStartFret(Number(e.target.value))} />
            </label>
            <label>
              String order
              <select value={stringsLowToHigh ? "low" : "high"} onChange={(e) => setStringsLowToHigh(e.target.value === "low")}>
                <option value="low">Low to high (6 → 1)</option>
                <option value="high">High to low (1 → 6)</option>
              </select>
            </label>
            <label>
              Finger pattern
              <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="1234" />
            </label>
            <label>
              Direction
              <select value={direction} onChange={(e) => setDirection(e.target.value as ChromaticDirection)}>
                <option value="ascending">Ascending across strings</option>
                <option value="descending">Descending across strings</option>
                <option value="both">Both</option>
              </select>
            </label>
          </>
        )}

        {kind === "spider" && (
          <>
            <label>
              Start fret
              <input type="number" min={1} max={20} value={startFret} onChange={(e) => setStartFret(Number(e.target.value))} />
            </label>
            <label>
              Starting string pair
              <select value={startStringPair} onChange={(e) => setStartStringPair(Number(e.target.value) as 1 | 2 | 3 | 4)}>
                <option value={1}>1 &amp; 3</option>
                <option value={2}>2 &amp; 4</option>
                <option value={3}>3 &amp; 5</option>
                <option value={4}>4 &amp; 6</option>
              </select>
            </label>
          </>
        )}

        {kind === "rhythm" && (
          <>
            <label>
              String
              <select value={rhythmString} onChange={(e) => setRhythmString(Number(e.target.value) as StringNumber)}>
                {ALL_STRINGS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Fret
              <input type="number" min={0} max={24} value={rhythmFret} onChange={(e) => setRhythmFret(Number(e.target.value))} />
            </label>
            <label className="checkbox">
              <input type="checkbox" checked={rhythmMuted} onChange={(e) => setRhythmMuted(e.target.checked)} />
              Muted
            </label>
            <label>
              Pattern
              <select value={rhythmPreset} onChange={(e) => setRhythmPreset(e.target.value as RhythmPresetName)}>
                {RHYTHM_PRESET_NAMES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        <button className="btn-primary" onClick={generate}>
          Generate
        </button>
      </div>

      {genError && <div className="notice notice-error">{genError}</div>}

      {parseResult && !parseResult.ok && <ErrorList errors={parseResult.errors} onJump={() => {}} />}

      {parseResult && parseResult.ok && (
        <>
          <div className="exercise-save-bar">
            <button className="btn-primary" disabled={saving} onClick={() => void handleSaveAsSong()}>
              {saving ? "Saving…" : "Save as song"}
            </button>
            {saveError && <div className="notice notice-error">{saveError}</div>}
          </div>
          <PracticeArea
            song={parseResult.song}
            settings={settings}
            onOffsetNudge={() => {}}
            onSetBar1Here={() => {}}
            onSettingsChange={onSettingsChange}
          />
        </>
      )}
    </div>
  );
}
