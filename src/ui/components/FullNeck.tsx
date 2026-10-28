// Display-only full fretboard (15 frets plus the open column) showing every chord tone.

import { checkVoicing, chordType, type ChordTypeId, type Spelling, type Voicing } from "../../chords";
import { mod12, pcName, spellingFamily } from "../../chords/theory";
import { OPEN_STRING_MIDI } from "../../audio/tuner";
import type { StringNumber } from "../../model";
import st from "./ChordDiagram.module.css";

export interface FullNeckProps {
  rootPc: number;
  typeId: ChordTypeId;
  spelling?: Spelling;
  bassPc?: number;
  /** The selected voicing; its positions are outlined. */
  voicing?: Voicing;
  /** Label dots with note names instead of intervals. */
  showNoteNames: boolean;
  leftHanded: boolean;
  frets?: number;
}

const STRINGS: StringNumber[] = [6, 5, 4, 3, 2, 1];
const MARKERS = [3, 5, 7, 9, 12, 15];

export function FullNeck({ rootPc, typeId, spelling = "sharp", bassPc, voicing, showNoteNames, leftHanded, frets = 15 }: FullNeckProps) {
  const cw = 44;
  const rh = 26;
  const top = 14;
  const W = (frets + 1) * cw;
  const H = top + 5 * rh + 34;
  const root = mod12(rootPc);
  const type = chordType(typeId);
  const family = spellingFamily(root, typeId, spelling);
  const mx = (x: number) => (leftHanded ? W - x : x);
  const cx = (f: number) => mx((f + 0.5) * cw);
  const cy = (i: number) => top + (5 - i) * rh;
  const check = voicing ? checkVoicing(voicing, rootPc, typeId, { spelling, bassPc }) : null;

  const out: React.ReactNode[] = [];
  const grid: React.ReactNode[] = [];
  for (let i = 0; i < 6; i++) {
    grid.push(<line key={`s${i}`} className={st.string} x1={0} y1={cy(i)} x2={W} y2={cy(i)} />);
  }
  for (let f = 1; f <= frets; f++) {
    grid.push(
      <line key={`f${f}`} className={f === 1 ? st.nut : st.fret} x1={mx(f * cw)} y1={top} x2={mx(f * cw)} y2={top + 5 * rh} />,
    );
  }
  for (const f of MARKERS) {
    if (f > frets) continue;
    grid.push(
      <text key={`n${f}`} className={st.fretNum} x={cx(f)} y={top + 5 * rh + 18} fontSize={11}>
        {f}
      </text>,
    );
  }

  for (let i = 0; i < 6; i++) {
    for (let f = 0; f <= frets; f++) {
      const midi = OPEN_STRING_MIDI[STRINGS[i]] + f;
      const pc = mod12(midi);
      const tone = type.tones.find((t) => t.semi === mod12(pc - root));
      const chosen = voicing?.frets[i] === f;
      if (!tone && !chosen) continue;
      const isRoot = pc === root;
      const text = showNoteNames ? pcName(pc, family) : (tone?.label ?? check?.strings[i]?.interval ?? "");
      out.push(
        <g key={`${i}-${f}`} data-kind={isRoot ? "root" : "tone"} data-selected={chosen ? "true" : undefined}>
          <circle className={isRoot ? st.dotRoot : st.dot} cx={cx(f)} cy={cy(i)} r={10} />
          {chosen && <circle data-kind="outline" className={st.dotOutline} cx={cx(f)} cy={cy(i)} r={12.5} />}
          <text className={`${st.label}${isRoot ? ` ${st.labelRoot}` : ""}`} x={cx(f)} y={cy(i)} fontSize={10}>
            {text}
          </text>
        </g>,
      );
    }
  }

  return (
    <svg
      className={st.svg}
      style={{ width: "100%", maxWidth: W }}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Full fretboard, ${chordType(typeId).name}`}
      data-left-handed={leftHanded ? "true" : "false"}
    >
      {grid}
      {out}
    </svg>
  );
}
