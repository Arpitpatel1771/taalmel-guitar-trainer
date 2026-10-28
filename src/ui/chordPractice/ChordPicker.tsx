// Compact chord chooser shared by the practice modes: root + type selects,
// plus quick-pick chips for the chords marked in the library.

import { CHORD_TYPES, type ChordTypeId, type Spelling } from "../../chords";
import { markedChords, pickedKey, pickedName, pretty, type PickedChord } from "./picked";
import st from "./ChordPractice.module.css";

const ROOT_OPTIONS: { value: string; label: string; pc: number; spelling: Spelling }[] = [
  ["C", 0], ["C#", 1], ["Db", 1], ["D", 2], ["D#", 3], ["Eb", 3], ["E", 4], ["F", 5], ["F#", 6], ["Gb", 6],
  ["G", 7], ["G#", 8], ["Ab", 8], ["A", 9], ["A#", 10], ["Bb", 10], ["B", 11],
].map(([name, pc]) => ({
  value: name as string,
  label: pretty(name as string),
  pc: pc as number,
  spelling: (name as string).endsWith("b") ? "flat" : "sharp",
}));

function rootValue(p: PickedChord): string {
  if ("slash" in p) return "";
  const opt = ROOT_OPTIONS.find((o) => o.pc === p.rootPc && (o.value.length === 1 || o.spelling === p.spelling));
  return opt?.value ?? "C";
}

export function ChordPicker({
  label,
  value,
  onChange,
  marks,
}: {
  label: string;
  value: PickedChord;
  onChange: (p: PickedChord) => void;
  marks: Record<string, "learning" | "known">;
}) {
  const mine = markedChords(marks);
  const isSlash = "slash" in value;
  return (
    <div className={st.picker}>
      <span className={st.pickerLabel}>{label}</span>
      <div className={st.pickerRow}>
        <select
          aria-label={`${label} root`}
          value={isSlash ? "" : rootValue(value)}
          onChange={(e) => {
            const o = ROOT_OPTIONS.find((r) => r.value === e.target.value)!;
            onChange({ rootPc: o.pc, spelling: o.spelling, typeId: isSlash ? "maj" : value.typeId });
          }}
        >
          {isSlash && <option value="">{value.slash}</option>}
          {ROOT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          aria-label={`${label} type`}
          value={isSlash ? "" : value.typeId}
          onChange={(e) =>
            onChange(isSlash ? { rootPc: 0, spelling: "sharp", typeId: e.target.value as ChordTypeId } : { ...value, typeId: e.target.value as ChordTypeId })
          }
        >
          {isSlash && <option value="">slash</option>}
          {CHORD_TYPES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.suffix ? `${t.suffix} · ${t.name}` : t.name}
            </option>
          ))}
        </select>
      </div>
      {mine.length > 0 && (
        <div className={st.chips} aria-label={`${label}: my chords`}>
          {mine.slice(0, 12).map((p) => (
            <button
              key={pickedKey(p)}
              type="button"
              className={`${st.chip}${pickedKey(p) === pickedKey(value) ? ` ${st.chipOn}` : ""}`}
              onClick={() => onChange(p)}
            >
              {pretty(pickedName(p))}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
