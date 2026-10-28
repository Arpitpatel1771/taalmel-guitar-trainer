// Display-only chord diagram as SVG (chord library spec section 2).

import { checkVoicing, chordType, type ChordTypeId, type Spelling, type Voicing } from "../../chords";
import { rootName } from "../../chords/theory";
import st from "./ChordDiagram.module.css";

export interface ChordDiagramProps {
  voicing: Voicing;
  rootPc: number;
  typeId: ChordTypeId;
  /** Spelling of the root; decides sharp or flat note names. */
  spelling?: Spelling;
  /** Pitch class of the bass for slash chords. */
  bassPc?: number;
  /** Accessible name; defaults to "<root> <type name>". */
  title?: string;
  labels: "fingers" | "intervals";
  orientation: "vertical" | "horizontal";
  leftHanded: boolean;
  showNoteNames: boolean;
  /** Distance between strings and frets in px. Default 22. */
  size?: number;
}

const FRETS = 5;

export function frettedAria(v: Voicing): string {
  return v.frets.map((f) => (f === null ? "x" : String(f))).join(v.frets.some((f) => f !== null && f > 9) ? "-" : "");
}

export function ChordDiagram({
  voicing,
  rootPc,
  typeId,
  spelling = "sharp",
  bassPc,
  title,
  labels,
  orientation,
  leftHanded,
  showNoteNames,
  size = 22,
}: ChordDiagramProps) {
  const s = size;
  const horizontal = orientation === "horizontal";
  const check = checkVoicing(voicing, rootPc, typeId, { spelling, bassPc });
  const name = title ?? `${rootName(rootPc, spelling)} ${chordType(typeId).name}`;
  const showNut = voicing.baseFret === 1;
  const r = s * 0.38;

  // Margins: near = nut side (markers), far = past the last fret (note names).
  const near = s * 1.4;
  const far = showNoteNames && horizontal ? s * 1.3 : s * 0.5;
  const side = s * 0.6; // across the strings
  let W: number;
  let H: number;
  if (horizontal) {
    W = near + FRETS * s + far;
    H = (voicing.baseFret > 1 ? s * 1.1 : s * 0.6) + 5 * s + s * 0.6;
  } else {
    W = s * 1.4 + 5 * s + side;
    H = near + FRETS * s + (showNoteNames ? s * 1.1 : s * 0.5);
  }
  const posTop = horizontal ? (voicing.baseFret > 1 ? s * 1.1 : s * 0.6) : near;

  // a: distance along the strings from the nut edge. i: string index 0 (low E) .. 5.
  function pt(i: number, a: number): [number, number] {
    if (horizontal) {
      const x = leftHanded ? W - near - a : near + a;
      return [x, posTop + (5 - i) * s];
    }
    const col = leftHanded ? 5 - i : i;
    return [s * 1.4 + col * s, near + a];
  }
  const rowA = (row: number) => (row + 0.5) * s;

  const lines: React.ReactNode[] = [];
  for (let i = 0; i < 6; i++) {
    const [x1, y1] = pt(i, 0);
    const [x2, y2] = pt(i, FRETS * s);
    lines.push(<line key={`s${i}`} className={st.string} x1={x1} y1={y1} x2={x2} y2={y2} />);
  }
  for (let f = showNut ? 1 : 0; f <= FRETS; f++) {
    const [x1, y1] = pt(0, f * s);
    const [x2, y2] = pt(5, f * s);
    lines.push(<line key={`f${f}`} className={st.fret} x1={x1} y1={y1} x2={x2} y2={y2} />);
  }
  const [nx1, ny1] = pt(0, 0);
  const [nx2, ny2] = pt(5, 0);

  const markers: React.ReactNode[] = [];
  const dots: React.ReactNode[] = [];
  const names: React.ReactNode[] = [];
  const fs = s * 0.42;

  voicing.frets.forEach((fret, i) => {
    const info = check.strings[i];
    const [mx, my] = pt(i, -s * 0.6);
    if (fret === null) {
      const d = s * 0.2;
      markers.push(
        <path
          key={`m${i}`}
          data-kind="muted"
          data-string={i}
          className={st.mark}
          d={`M${mx - d} ${my - d}L${mx + d} ${my + d}M${mx - d} ${my + d}L${mx + d} ${my - d}`}
        />,
      );
      return;
    }
    const isRoot = info?.pc === ((rootPc % 12) + 12) % 12;
    if (fret === 0) {
      markers.push(
        <circle
          key={`m${i}`}
          data-kind={isRoot ? "open-root" : "open"}
          data-string={i}
          className={`${st.mark}${isRoot ? ` ${st.markRoot}` : ""}`}
          cx={mx}
          cy={my}
          r={s * 0.2}
        />,
      );
    } else {
      const [cx, cy] = pt(i, rowA(fret - voicing.baseFret));
      const text = labels === "fingers" ? voicing.fingers[i] : info?.interval;
      dots.push(
        <g key={`d${i}`} data-kind={isRoot ? "root" : "dot"} data-string={i}>
          <circle className={isRoot ? st.dotRoot : st.dot} cx={cx} cy={cy} r={r} />
          {text != null && (
            <text className={`${st.label}${isRoot ? ` ${st.labelRoot}` : ""}`} x={cx} y={cy} fontSize={fs}>
              {text}
            </text>
          )}
        </g>,
      );
    }
    if (showNoteNames && info) {
      const [tx, ty] = pt(i, FRETS * s + s * 0.6);
      names.push(
        <text key={`n${i}`} data-kind="note" data-string={i} x={tx} y={ty} fontSize={s * 0.4} className={st.noteName}>
          {info.note}
        </text>,
      );
    }
  });

  let barre: React.ReactNode = null;
  if (voicing.barre) {
    const b = voicing.barre;
    const a = rowA(b.fret - voicing.baseFret);
    const [x1, y1] = pt(6 - b.fromString, a);
    const [x2, y2] = pt(6 - b.toString, a);
    barre = (
      <rect
        data-kind="barre"
        className={st.barre}
        x={Math.min(x1, x2) - r}
        y={Math.min(y1, y2) - r}
        width={Math.abs(x2 - x1) + 2 * r}
        height={Math.abs(y2 - y1) + 2 * r}
        rx={r}
      />
    );
  }

  let posLabel: React.ReactNode = null;
  if (!showNut) {
    const [px, py] = pt(0, rowA(0));
    posLabel = horizontal ? (
      <text className={st.text} x={px} y={s * 0.45} fontSize={s * 0.5}>
        {voicing.baseFret}fr
      </text>
    ) : (
      <text className={`${st.text} ${st.textEnd}`} x={s * 1.4 - s * 0.55} y={py} fontSize={s * 0.5}>
        {voicing.baseFret}fr
      </text>
    );
  }

  return (
    <svg
      className={st.svg}
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`${name}, ${frettedAria(voicing)}`}
      data-orientation={orientation}
      data-left-handed={leftHanded ? "true" : "false"}
    >
      {lines}
      {showNut && <line data-kind="nut" className={st.nut} x1={nx1} y1={ny1} x2={nx2} y2={ny2} />}
      {posLabel}
      {barre}
      {dots}
      {markers}
      {names}
    </svg>
  );
}
