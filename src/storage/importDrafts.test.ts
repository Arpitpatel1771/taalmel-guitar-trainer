import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  DRAFTS_DB_NAME,
  _resetDraftsDbForTests,
  deleteEditorDraft,
  getEditorDraft,
  listEditorDrafts,
  newDraftId,
  saveEditorDraft,
  type EditorDraft,
} from "./importDrafts.js";

afterEach(async () => {
  await _resetDraftsDbForTests();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DRAFTS_DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
});

const draft = (over: Partial<EditorDraft> = {}): EditorDraft => ({
  id: newDraftId(),
  version: 2,
  source: "tab",
  title: "T",
  songText: "title: T",
  view: { zoom: 18, rowHeight: 16, snap: "1/16", view: "pitch", scrollX: 0, scrollY: 120 },
  updatedAt: 0,
  ...over,
});

describe("editor drafts", () => {
  it("saves, reads back, lists newest first and deletes", async () => {
    const a = draft({ docJson: "{}" });
    await saveEditorDraft(a);
    await new Promise((r) => setTimeout(r, 3));
    const b = draft({ source: "song", songId: "s1" });
    await saveEditorDraft(b);
    expect((await getEditorDraft(a.id))?.view.scrollY).toBe(120);
    expect((await getEditorDraft(a.id))?.docJson).toBe("{}");
    expect((await listEditorDrafts()).map((d) => d.id)).toEqual([b.id, a.id]);
    expect((await listEditorDrafts())[0]?.songId).toBe("s1");
    await deleteEditorDraft(a.id);
    expect(await getEditorDraft(a.id)).toBeUndefined();
  });

  it("drops version-1 drafts when the database upgrades", async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(DRAFTS_DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("drafts", { keyPath: "id" }).createIndex("updatedAt", "updatedAt");
      };
      req.onsuccess = () => {
        const tx = req.result.transaction("drafts", "readwrite");
        tx.objectStore("drafts").put({ id: "old", kind: "tab", updatedAt: 1 });
        tx.oncomplete = () => {
          req.result.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
    expect(await listEditorDrafts()).toEqual([]);
  });
});
