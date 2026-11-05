// Collapsible plain-tab view of the song (spec 3.7). Click a fret number to select that note.

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { tabView, type EdDoc } from "../../songEditor";
import s from "./songEditor.module.css";

export function TabViewPanel({
  doc,
  selected,
  range,
  onSelect,
}: {
  doc: EdDoc;
  selected: readonly number[];
  /** 0-based inclusive bars, e.g. the loop; absent = the whole song. */
  range: { fromBar: number; toBar: number } | null;
  onSelect: (id: number) => void;
}) {
  const [open, setOpen] = useState(true);
  const view = useMemo(() => (open ? tabView(doc, range ?? {}) : null), [doc, open, range]);
  const sel = new Set(selected);
  const byRow = new Map<number, { col: number; length: number; id: number }[]>();
  for (const c of view?.cells ?? []) {
    const list = byRow.get(c.row) ?? [];
    list.push({ col: c.col, length: c.length, id: c.noteId });
    byRow.set(c.row, list);
  }
  return (
    <div className={s.tabPanel}>
      <button type="button" className={s.tabToggle} aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        Tab view{range ? ` (loop: bars ${range.fromBar + 1}–${range.toBar + 1})` : " (updates as you edit)"}
      </button>
      {view && (
        <pre className={s.tabPre} aria-label="The song as tab">
          {view.lines.map((line, r) => {
            const cells = (byRow.get(r) ?? []).sort((a, b) => a.col - b.col);
            const parts: React.ReactNode[] = [];
            let at = 0;
            for (const c of cells) {
              if (c.col > at) parts.push(line.slice(at, c.col));
              parts.push(
                <button key={`${c.id}`} type="button" className={sel.has(c.id) ? s.tabCellOn : s.tabCell} onClick={() => onSelect(c.id)} aria-label={`Select note, fret ${line.slice(c.col, c.col + c.length)}`}>
                  {line.slice(c.col, c.col + c.length)}
                </button>,
              );
              at = c.col + c.length;
            }
            parts.push(line.slice(at));
            return (
              <div key={r} className={s.tabLine}>
                {parts.length ? parts : " "}
              </div>
            );
          })}
        </pre>
      )}
    </div>
  );
}
