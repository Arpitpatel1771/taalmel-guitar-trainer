import { describe, expect, it } from "vitest";
import { docFromTab, emptyDoc, serializeDoc, type EdDoc } from "../../songEditor";
import type { EditorDraft } from "../../storage/importDrafts";
import { buildInit } from "./editorInit";

const tabDoc = (): EdDoc => {
  const r = docFromTab("e|--0----3----|\nB|--1----0----|\nG|--0----0----|\nD|--2----0----|\nA|--3----2----|\nE|-------3----|", { title: "Chords" });
  if (!r.ok) throw new Error("fixture");
  return r.doc;
};

const draftOf = (doc: EdDoc, over: Partial<EditorDraft> = {}): EditorDraft => ({
  id: "d1",
  version: 2,
  source: "tab",
  title: doc.header.title,
  songText: serializeDoc(doc),
  view: { zoom: 20, rowHeight: 14, snap: "1/8", view: "strings", scrollX: 10, scrollY: 20 },
  updatedAt: 1,
  ...over,
});

describe("editor start", () => {
  it("starts a new document with a fresh draft id", () => {
    const r = buildInit({ kind: "new", doc: emptyDoc({ title: "T" }), source: "scratch" });
    expect(r.ok && r.alwaysSave && r.source === "scratch").toBe(true);
  });

  it("opens a song from its text and keeps the song id", () => {
    const text = serializeDoc(tabDoc());
    const r = buildInit({ kind: "song", songId: "s1", songText: text });
    expect(r.ok && r.songId === "s1" && !r.alwaysSave && r.doc.notes.length > 0).toBe(true);
  });

  it("explains a song that does not parse", () => {
    const r = buildInit({ kind: "song", songId: "s1", songText: "nonsense" });
    expect(r.ok).toBe(false);
  });

  it("restores a draft from its text and view state", () => {
    const doc = tabDoc();
    const r = buildInit({ kind: "draft", draft: draftOf(doc) });
    expect(r.ok && r.doc.notes.length === doc.notes.length && r.view.view === "strings" && r.draftId === "d1").toBe(true);
  });

  it("prefers the stored document over the text", () => {
    const doc = tabDoc();
    const edited: EdDoc = { ...doc, header: { ...doc.header, title: "From JSON" } };
    const r = buildInit({ kind: "draft", draft: draftOf(doc, { songText: "", docJson: JSON.stringify(edited) }) });
    expect(r.ok && r.doc.header.title === "From JSON").toBe(true);
  });
});
