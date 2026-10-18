import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { CLIPS_DB_NAME, _resetClipsDbForTests, deleteClip, listClips, renameClip, saveClip, updateClipFlags } from "./clipStore";

afterEach(async () => {
  await _resetClipsDbForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(CLIPS_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
});

const clip = (name: string, createdAt: number) => ({
  name,
  createdAt,
  mimeType: "audio/webm",
  hasVideo: false,
  durationSec: 3,
  blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }),
});

describe("clipStore", () => {
  it("saves, lists newest first, renames and deletes", async () => {
    const a = await saveClip(clip("A", 1));
    const b = await saveClip(clip("B", 2));
    expect(a.size).toBe(3);
    expect((await listClips()).map((c) => c.name)).toEqual(["B", "A"]);

    await renameClip(a.id, "A2");
    expect((await listClips()).find((c) => c.id === a.id)?.name).toBe("A2");

    await deleteClip(b.id);
    expect((await listClips()).map((c) => c.id)).toEqual([a.id]);
  });

  it("stores flags sorted by time; older clips have none", async () => {
    const a = await saveClip(clip("A", 1));
    expect(a.flags).toBeUndefined();
    await updateClipFlags(a.id, [
      { id: "2", timeSec: 9, label: "Late" },
      { id: "1", timeSec: 2, label: "Early" },
    ]);
    expect((await listClips())[0].flags?.map((f) => f.id)).toEqual(["1", "2"]);
    await expect(updateClipFlags("missing", [])).rejects.toThrow();
  });
});
