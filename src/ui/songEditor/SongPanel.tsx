// The Song panel: shown when no note is selected (spec 3.5): title, tempo, time, capo, video, bar 1,
// sections, bars and the keys list.

import { useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { tapTempo } from "../../importTab";
import {
  addBars,
  addSection,
  capoOfBar,
  removeLastBars,
  removeSection,
  renameSection,
  setHeader,
  setSection,
  setTime,
  setVideoOffset,
  setYoutube,
  type EdDoc,
  type OpResult,
} from "../../songEditor";
import { Button } from "../components/kit";
import { EditableText, Group, IconButton } from "./bits";
import { flagText } from "./rollDraw";
import s from "./songEditor.module.css";

export interface SongPanelProps {
  doc: EdDoc;
  /** 0-based bar the playhead is in (default for a new section). */
  playheadBar: number;
  getVideoTime: () => number | null;
  onEdit: (res: OpResult) => void;
  onToast: (message: string) => void;
}

const KEYS: [string, string][] = [
  ["D / V", "Draw / select"],
  ["Double-click", "Add a note"],
  ["Right-click", "Delete a note"],
  ["← →", "Move by one snap step"],
  ["↑ ↓", "Semitone (Shift: octave)"],
  ["Shift + ← →", "Change length"],
  ["Delete", "Remove the selected notes"],
  ["Ctrl + C / V", "Copy / paste at the playhead"],
  ["Ctrl + D", "Duplicate the selected bars"],
  ["Ctrl + Z / Shift + Z", "Undo / redo"],
  ["Ctrl + A", "Select all notes"],
  ["Space", "Play / pause"],
  ["N", "Live record: tap each note as you hear it"],
  ["Alt + drag", "Move or resize without snapping"],
  ["Ctrl + wheel", "Zoom"],
];

export function SongPanel({ doc, playheadBar, getVideoTime, onEdit, onToast }: SongPanelProps) {
  const h = doc.header;
  const taps = useRef<number[]>([]);
  const [tapInfo, setTapInfo] = useState("");
  const [timeText, setTimeText] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [newBar, setNewBar] = useState<string>("");
  const offset = h.youtube?.offsetSec;

  const tap = (): void => {
    const now = performance.now() / 1000;
    const last = taps.current[taps.current.length - 1];
    if (last !== undefined && now - last > 2.5) taps.current = [];
    taps.current.push(now);
    const r = tapTempo(taps.current);
    if (!r) {
      setTapInfo("Keep tapping on the beat");
      return;
    }
    const bpm = Math.round(r.bpm);
    setTapInfo(`${bpm} BPM from ${r.used} taps`);
    if (taps.current.length >= 3) onEdit(setHeader(doc, { bpm }));
  };

  const commitTime = (text: string): void => {
    const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(text);
    setTimeText(null);
    if (!m) return onToast("Write the time signature like 4/4 or 6/8.");
    onEdit(setTime(doc, { numerator: Number(m[1]), denominator: Number(m[2]) }));
  };

  const nudge = (ms: number): void => {
    if (offset === undefined) return;
    onEdit(setVideoOffset(doc, offset + ms / 1000));
  };

  const barsText = (i: number): string => {
    const from = doc.sections[i]!.startBar + 1;
    const to = (doc.sections[i + 1]?.startBar ?? doc.bars.length);
    return from === to ? `bar ${from}` : `bars ${from}–${to}`;
  };

  return (
    <div className={s.inspectorBody}>
      <h2 className={s.panelTitle}>Song</h2>
      <div className={s.grid2}>
        <label className={s.field}>
          Title
          <EditableText value={h.title} label="Title" onCommit={(v) => onEdit(setHeader(doc, { title: v }))} />
        </label>
        <label className={s.field}>
          Artist
          <EditableText value={h.artist ?? ""} label="Artist" placeholder="Optional" onCommit={(v) => onEdit(setHeader(doc, { artist: v }))} />
        </label>
        <label className={s.field}>
          Tempo (BPM)
          <EditableText value={String(h.bpm)} label="Tempo in BPM" inputMode="numeric" onCommit={(v) => onEdit(setHeader(doc, { bpm: Number(v) }))} />
        </label>
        <label className={s.field}>
          Time
          <input
            value={timeText ?? `${h.time.numerator}/${h.time.denominator}`}
            aria-label="Time signature"
            onChange={(e) => setTimeText(e.target.value)}
            onBlur={() => timeText !== null && commitTime(timeText)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        </label>
        <label className={s.field}>
          Capo
          <select value={h.capo ?? 0} aria-label="Capo" onChange={(e) => onEdit(setHeader(doc, { capo: Number(e.target.value) }))}>
            {Array.from({ length: 13 }, (_, i) => (
              <option key={i} value={i}>
                {i === 0 ? "No capo" : `Fret ${i}`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={s.row}>
        <Button onClick={tap} title="Tap along with the song to find its tempo">
          Tap the tempo
        </Button>
        <span className={s.hint}>{tapInfo || "Optional helper"}</span>
      </div>

      <Group title="YouTube video">
        <div className={s.row}>
          <input
            className={s.grow}
            aria-label="YouTube link"
            placeholder="Paste a YouTube link"
            value={url ?? h.youtube?.url ?? ""}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => {
              if (url !== null && url.trim() !== (h.youtube?.url ?? "")) onEdit(setYoutube(doc, url));
              setUrl(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        </div>
      </Group>

      {offset !== undefined && (
        <Group title="Bar 1 in the video">
          <div className={s.flagLine}>{flagText(offset)}</div>
          <div className={s.hint}>Drag the green flag in the ruler onto the first downbeat, or nudge it here.</div>
          <div className={s.row}>
            {[-100, -10, 10, 100].map((ms) => (
              <button key={ms} type="button" className={s.wide} onClick={() => nudge(ms)} aria-label={`Bar 1 ${ms < 0 ? "earlier" : "later"} by ${Math.abs(ms)} milliseconds`}>
                {ms > 0 ? "+" : "−"}
                {Math.abs(ms)} ms
              </button>
            ))}
          </div>
          <Button
            onClick={() => {
              const t = getVideoTime();
              if (t === null) onToast("The video isn't ready yet.");
              else onEdit(setVideoOffset(doc, t));
            }}
            title="Pause the video on the first downbeat, then press this"
          >
            Bar 1 is here
          </Button>
        </Group>
      )}

      <Group title="Sections">
        <div className={s.sections}>
          {doc.sections.map((sec, i) => (
            <div key={`${sec.startBar}-${i}`} className={s.sectionRow}>
              <div className={s.sectionTop}>
                <EditableText className={s.grow} value={sec.name} label={`Name of section ${i + 1}`} onCommit={(v) => onEdit(renameSection(doc, i, v))} />
                <span className={s.hint}>{barsText(i)}</span>
                {i > 0 && (
                  <IconButton label={`Remove section ${sec.name}`} onClick={() => onEdit(removeSection(doc, i))}>
                    <Trash2 size={14} aria-hidden />
                  </IconButton>
                )}
              </div>
              <div className={s.sectionOpts}>
                <label>
                  BPM
                  <EditableText
                    value={sec.bpm === undefined ? "" : String(sec.bpm)}
                    label={`Tempo override for ${sec.name}`}
                    placeholder={String(h.bpm)}
                    inputMode="numeric"
                    onCommit={(v) => onEdit(setSection(doc, i, { bpm: v.trim() === "" ? null : Number(v) }))}
                  />
                </label>
                <label>
                  Capo
                  <select
                    value={sec.capo ?? ""}
                    aria-label={`Capo for ${sec.name}`}
                    onChange={(e) => onEdit(setSection(doc, i, { capo: e.target.value === "" ? null : Number(e.target.value) }))}
                  >
                    <option value="">Song ({h.capo ?? 0})</option>
                    {Array.from({ length: 13 }, (_, c) => (
                      <option key={c} value={c}>
                        {c === 0 ? "None" : c}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          ))}
        </div>
        <div className={s.row}>
          <label className={s.inline}>
            New section at bar
            <input
              type="number"
              min={2}
              max={doc.bars.length}
              value={newBar || playheadBar + 1}
              aria-label="Bar where the new section starts"
              onChange={(e) => setNewBar(e.target.value)}
            />
          </label>
          <Button
            icon={<Plus size={14} aria-hidden />}
            onClick={() => {
              const bar = Number(newBar || playheadBar + 1) - 1;
              onEdit(addSection(doc, `Section ${doc.sections.length + 1}`, bar));
              setNewBar("");
            }}
          >
            Add
          </Button>
        </div>
      </Group>

      <Group title="Bars">
        <div className={s.row}>
          <span className={s.hint}>
            {doc.bars.length} bars{capoOfBar(doc, 0) > 0 ? ` · capo ${capoOfBar(doc, 0)}` : ""}
          </span>
          <button type="button" className={s.wide} onClick={() => onEdit(addBars(doc, 1))}>
            Add a bar
          </button>
          <button type="button" className={s.wide} onClick={() => onEdit(addBars(doc, 4))}>
            Add 4
          </button>
          <button type="button" className={s.wide} onClick={() => onEdit(removeLastBars(doc, 1))} title="Removes the last bar and the notes in it">
            Remove last
          </button>
        </div>
      </Group>

      <Group title="Keys">
        <dl className={s.keys}>
          {KEYS.map(([k, v]) => (
            <div key={k} className={s.keyRow}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </Group>
    </div>
  );
}
