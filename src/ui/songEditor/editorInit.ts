// Where the editor starts from: a new document, an existing song's text, or a saved draft.

import { parse } from "../../songFormat";
import { docFromSong, type EdDoc } from "../../songEditor";
import { newDraftId, type EditorDraft, type EditorViewState } from "../../storage/importDrafts";

export type EditorStart =
  | { kind: "new"; doc: EdDoc; source: "tab" | "scratch" }
  | { kind: "song"; songId: string; songText: string }
  | { kind: "draft"; draft: EditorDraft };

export interface EditorInit {
  doc: EdDoc;
  draftId: string;
  source: EditorDraft["source"];
  songId?: string;
  view: Partial<EditorViewState>;
  /** New and resumed drafts are always kept; an opened song only once it has been edited. */
  alwaysSave: boolean;
}

export type InitResult = ({ ok: true } & EditorInit) | { ok: false; message: string };

export function buildInit(start: EditorStart): InitResult {
  if (start.kind === "new") {
    return { ok: true, doc: start.doc, draftId: newDraftId(), source: start.source, view: {}, alwaysSave: true };
  }
  if (start.kind === "song") {
    const p = parse(start.songText);
    if (!p.ok) return { ok: false, message: `This song can't be opened in the editor yet: ${p.errors[0]?.message ?? "it has errors"}. Fix it with "Edit text" first.` };
    return { ok: true, doc: docFromSong(p.song), draftId: newDraftId(), source: "song", songId: start.songId, view: {}, alwaysSave: false };
  }
  const d = start.draft;
  let doc: EdDoc | null = null;
  if (d.docJson) {
    try {
      const parsed = JSON.parse(d.docJson) as EdDoc;
      if (parsed && Array.isArray(parsed.notes) && Array.isArray(parsed.bars) && parsed.header) doc = parsed;
    } catch {
      doc = null;
    }
  }
  if (!doc) {
    const p = parse(d.songText);
    if (!p.ok) return { ok: false, message: "This draft can't be opened: its text has errors." };
    doc = docFromSong(p.song);
  }
  return { ok: true, doc, draftId: d.id, source: d.source, songId: d.songId, view: d.view, alwaysSave: true };
}
