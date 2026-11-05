// The inspector (spec 3.5): one note, several notes, or (with nothing selected) the Song panel.

import { useEffect, useState } from "react";
import { Minus, Plus, Trash2, Volume2 } from "lucide-react";
import {
  LENGTH_VALUES,
  checkInto,
  checkModifier,
  cutShort,
  deleteNotes,
  isBlackKey,
  lengthTicks,
  moveNotes,
  moveToString,
  noteById,
  noteMidi,
  noteName,
  playOptions,
  positionText,
  ringUntilNext,
  setInto,
  setLength,
  setOffsetMs,
  toggleModifier,
  transposeOctave,
  type EdDoc,
  type EdNote,
  type IntoKind,
  type LengthId,
  type ModifierKey,
  type OpResult,
} from "../../songEditor";
import { STRING_LETTERS } from "./rollDraw";
import { Group, IconButton, Toggle, cx } from "./bits";
import s from "./songEditor.module.css";

export interface InspectorProps {
  doc: EdDoc;
  selected: readonly number[];
  snapTicks: number;
  onEdit: (res: OpResult, preview?: boolean) => void;
  onHear: (midi: number) => void;
}

const LENGTH_IDS = Object.keys(LENGTH_VALUES) as LengthId[];
const BEND_STEPS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
const STRING_NAMES = ["high e", "B", "G", "D", "A", "low E"];

function intoOf(n: EdNote): IntoKind {
  const c = n.meta.connection;
  return c ? (c.kind === "bend" ? { kind: "bend", semitones: c.semitones } : { kind: c.kind }) : { kind: "none" };
}

export function Inspector({ doc, selected, snapTicks, onEdit, onHear }: InspectorProps) {
  const notes = selected.map((id) => noteById(doc, id)).filter((n): n is EdNote => !!n);
  const ids = notes.map((n) => n.id);
  const [dotted, setDotted] = useState(false);
  const [bendBy, setBendBy] = useState(1);
  const first = notes[0];

  useEffect(() => {
    if (!first) return;
    const dottedMatch = LENGTH_IDS.some((id) => lengthTicks(id, true) === first.durationTicks);
    const plainMatch = LENGTH_IDS.some((id) => lengthTicks(id, false) === first.durationTicks);
    if (dottedMatch) setDotted(true);
    else if (plainMatch) setDotted(false);
  }, [first?.id, first?.durationTicks]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const c = first?.meta.connection;
    if (c?.kind === "bend" && c.semitones > 0) setBendBy(c.semitones);
  }, [first?.id, first?.meta.connection]);

  if (notes.length === 0 || !first) return null;
  const single = notes.length === 1 ? first : null;
  const midi = noteMidi(doc, first);
  const lengthOn = (id: LengthId): boolean => notes.every((n) => n.durationTicks === lengthTicks(id, dotted));

  const intoReason = (into: IntoKind): string | null => {
    const reasons = ids.map((id) => checkInto(doc, id, into));
    return reasons.every((r) => r !== null) ? reasons[0]! : null;
  };
  const modReason = (key: ModifierKey): string | null => {
    if (notes.every((n) => n.meta[key])) return null;
    const reasons = ids.map((id) => checkModifier(doc, id, key));
    return reasons.every((r) => r !== null) ? reasons[0]! : null;
  };
  const intoKind = (n: EdNote): string => intoOf(n).kind;
  const sameInto = (kind: string): boolean => notes.every((n) => intoKind(n) === kind);

  const intoButtons: { label: string; into: IntoKind; kind: string }[] = [
    { label: "None", into: { kind: "none" }, kind: "none" },
    { label: "Hammer-on", into: { kind: "hammer" }, kind: "hammer" },
    { label: "Pull-off", into: { kind: "pull" }, kind: "pull" },
    { label: "Slide", into: { kind: "slide" }, kind: "slide" },
    { label: "Bend", into: { kind: "bend", semitones: bendBy }, kind: "bend" },
  ];
  const modifiers: { label: string; key: ModifierKey }[] = [
    { label: "Vibrato", key: "vibrato" },
    { label: "Muted", key: "muted" },
    { label: "Slide in", key: "slideIn" },
    { label: "Slide out", key: "slideOut" },
  ];
  const showFlat = notes.some((n) => isBlackKey(noteMidi(doc, n)));
  const options = single ? playOptions(doc, single.id) : [];
  const bend = single?.meta.connection?.kind === "bend" ? single.meta.connection.semitones : null;

  return (
    <div className={s.inspectorBody}>
      <div className={s.noteHead}>
        {single ? (
          <>
            <div className={s.noteName}>{noteName(midi, !!single.meta.flat)}</div>
            <div className={s.noteWhere}>
              {STRING_NAMES[single.string - 1]} string · fret {single.fret}
            </div>
            <IconButton label="Hear this note" onClick={() => onHear(midi)}>
              <Volume2 size={16} aria-hidden />
            </IconButton>
          </>
        ) : (
          <div className={s.noteName}>{notes.length} notes</div>
        )}
      </div>

      <Group title="Pitch">
        <div className={s.row}>
          <button type="button" className={s.wide} onClick={() => onEdit(moveNotes(doc, ids, { dSemis: -1 }), true)}>
            <Minus size={14} aria-hidden /> Semitone
          </button>
          <button type="button" className={s.wide} onClick={() => onEdit(moveNotes(doc, ids, { dSemis: 1 }), true)}>
            <Plus size={14} aria-hidden /> Semitone
          </button>
        </div>
        <div className={s.row}>
          <button type="button" className={s.wide} onClick={() => onEdit(transposeOctave(doc, ids, -1), true)}>
            <Minus size={14} aria-hidden /> Octave
          </button>
          <button type="button" className={s.wide} onClick={() => onEdit(transposeOctave(doc, ids, 1), true)}>
            <Plus size={14} aria-hidden /> Octave
          </button>
        </div>
      </Group>

      {single && (
        <Group title="Play it on">
          <div className={s.chips} role="group" aria-label="String and fret">
            {options.map((o) => (
              <button
                key={o.string}
                type="button"
                className={cx(s.chip, o.current && s.chipOn)}
                aria-pressed={o.current}
                disabled={o.taken && !o.current}
                title={o.taken && !o.current ? "Another note starts on this string at the same moment." : undefined}
                onClick={() => onEdit(moveToString(doc, single.id, o.string))}
              >
                {STRING_LETTERS[o.string - 1]} · fret {o.fret}
              </button>
            ))}
          </div>
        </Group>
      )}

      {single && (
        <Group title="Starts">
          <div className={s.row}>
            <IconButton label="Move earlier" onClick={() => onEdit(moveNotes(doc, ids, { dTicks: -snapTicks }))}>
              ←
            </IconButton>
            <div className={s.startText}>{positionText(doc, single.startTick)}</div>
            <IconButton label="Move later" onClick={() => onEdit(moveNotes(doc, ids, { dTicks: snapTicks }))}>
              →
            </IconButton>
          </div>
          <div className={s.fine}>
            <label htmlFor="fine-ms">Fine timing</label>
            <IconButton label="5 ms earlier" onClick={() => onEdit(setOffsetMs(doc, ids, single.offsetMs - 5))}>
              <Minus size={14} aria-hidden />
            </IconButton>
            <input
              id="fine-ms"
              type="number"
              min={-500}
              max={500}
              step={5}
              value={single.offsetMs}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) onEdit(setOffsetMs(doc, ids, v));
              }}
            />
            <span className={s.unit}>ms</span>
            <IconButton label="5 ms later" onClick={() => onEdit(setOffsetMs(doc, ids, single.offsetMs + 5))}>
              <Plus size={14} aria-hidden />
            </IconButton>
          </div>
        </Group>
      )}

      <Group title="Length">
        <div className={s.seg} role="group" aria-label="Length">
          {LENGTH_IDS.map((id) => (
            <button key={id} type="button" className={cx(s.segBtn, lengthOn(id) && s.segOn)} aria-pressed={lengthOn(id)} onClick={() => onEdit(setLength(doc, ids, lengthTicks(id, dotted)))}>
              {id}
            </button>
          ))}
        </div>
        <div className={s.row}>
          <Toggle on={dotted} onClick={() => {
            const next = !dotted;
            setDotted(next);
            const cur = LENGTH_IDS.find((id) => notes.every((n) => n.durationTicks === lengthTicks(id, dotted)));
            if (cur) onEdit(setLength(doc, ids, lengthTicks(cur, next)));
          }}>
            Dotted
          </Toggle>
          <button type="button" className={s.wide} onClick={() => onEdit(ringUntilNext(doc, ids))} title="Stretch to the next note, or the end of the bar">
            Ring until next
          </button>
          <button type="button" className={s.wide} onClick={() => onEdit(cutShort(doc, ids))} title="Half the length">
            Cut short
          </button>
        </div>
      </Group>

      <Group title="Into this note from the last">
        <div className={s.chips} role="group" aria-label="Technique into this note">
          {intoButtons.map((b) => {
            const reason = b.kind === "none" ? null : intoReason(b.into);
            const on = sameInto(b.kind);
            return (
              <button key={b.kind} type="button" className={cx(s.chip, on && s.chipOn)} aria-pressed={on} disabled={!!reason} title={reason ?? undefined} onClick={() => onEdit(setInto(doc, ids, b.into))}>
                {b.label}
              </button>
            );
          })}
        </div>
        {bend !== null && single && (
          <div className={s.fine}>
            <label htmlFor="bend-by">Bend by</label>
            <select
              id="bend-by"
              value={bend}
              onChange={(e) => {
                const v = Number(e.target.value);
                setBendBy(v > 0 ? v : bendBy);
                onEdit(setInto(doc, ids, { kind: "bend", semitones: v }));
              }}
            >
              {BEND_STEPS.map((v) => (
                <option key={v} value={v}>
                  {v === 0 ? "0 (release)" : `${v} semitone${v === 1 ? "" : "s"}`}
                </option>
              ))}
            </select>
          </div>
        )}
      </Group>

      <Group title="On this note">
        <div className={s.chips} role="group" aria-label="Technique on this note">
          {modifiers.map((m) => {
            const on = notes.every((n) => n.meta[m.key]);
            const reason = modReason(m.key);
            return (
              <button key={m.key} type="button" className={cx(s.chip, on && s.chipOn)} aria-pressed={on} disabled={!!reason} title={reason ?? undefined} onClick={() => onEdit(toggleModifier(doc, ids, m.key))}>
                {m.label}
              </button>
            );
          })}
          {showFlat && (
            <button
              type="button"
              className={cx(s.chip, notes.every((n) => n.meta.flat) && s.chipOn)}
              aria-pressed={notes.every((n) => n.meta.flat)}
              disabled={!!modReason("flat")}
              title={modReason("flat") ?? "Write this note as a flat (Db) instead of a sharp (C#)"}
              onClick={() => onEdit(toggleModifier(doc, ids, "flat"))}
            >
              Spell as flat
            </button>
          )}
        </div>
      </Group>

      <button type="button" className={s.dangerBtn} onClick={() => onEdit(deleteNotes(doc, ids))}>
        <Trash2 size={15} aria-hidden /> Delete {single ? "note" : `${notes.length} notes`}
      </button>
    </div>
  );
}
