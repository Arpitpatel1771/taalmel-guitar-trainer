import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "../songFormat/index.js";
import { deleteSong, getSong, listSongs, saveSong } from "./songs.js";
import { resetTaalmelDb } from "./testSetup.js";

afterEach(async () => {
  await resetTaalmelDb();
});

const VALID_SONG = `title: Test Song
time: 4/4
bpm: 100
unit: 8

[Verse]
Bar 1: {1} 1S0 {2} 1S1
`;

const INVALID_SONG = `title: Broken
time: 4/4
bpm: 100
unit: 8

[Verse]
Bar 2: {1} 1S0
`;

describe("saveSong", () => {
  it("stores the canonical (serialize(parse(text))) form and denormalized fields", async () => {
    const record = await saveSong(VALID_SONG);
    expect(record.title).toBe("Test Song");
    expect(record.bpm).toBe(100);
    expect(record.hasVideo).toBe(false);
    // The stored text is the canonical serialize(parse(text)) form: re-parsing it
    // must reproduce the same song (round-trip guarantee, spec 5.7).
    const reparsed = parse(record.text);
    expect(reparsed.ok).toBe(true);
    expect(record.text.startsWith("title: Test Song\n")).toBe(true);
    expect(record.id).toBeTruthy();
    expect(record.createdAt).toBe(record.updatedAt);

    const fetched = await getSong(record.id);
    expect(fetched).toEqual(record);
  });

  it("throws on invalid song text and saves nothing", async () => {
    await expect(saveSong(INVALID_SONG)).rejects.toThrow(/invalid song text/i);
    expect(await listSongs()).toEqual([]);
  });

  it("updates an existing record in place, preserving createdAt", async () => {
    const created = await saveSong(VALID_SONG);
    await new Promise((r) => setTimeout(r, 2));
    const updatedText = VALID_SONG.replace("Test Song", "Renamed Song");
    const updated = await saveSong(updatedText, created.id);

    expect(updated.id).toBe(created.id);
    expect(updated.title).toBe("Renamed Song");
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).not.toBe(created.updatedAt);

    const all = await listSongs();
    expect(all).toHaveLength(1);
  });

  it("with an explicit but unknown id, creates a new record using that id", async () => {
    const record = await saveSong(VALID_SONG, "brand-new-id");
    expect(record.id).toBe("brand-new-id");
    expect(record.createdAt).toBe(record.updatedAt);
  });
});

describe("listSongs", () => {
  it("returns songs most recently updated first", async () => {
    const a = await saveSong(VALID_SONG.replace("Test Song", "A"));
    await new Promise((r) => setTimeout(r, 2));
    const b = await saveSong(VALID_SONG.replace("Test Song", "B"));
    await new Promise((r) => setTimeout(r, 2));
    await saveSong(VALID_SONG.replace("Test Song", "A2"), a.id); // touch A again

    const titles = (await listSongs()).map((r) => r.title);
    expect(titles).toEqual(["A2", "B"]);
    void b;
  });
});

describe("deleteSong", () => {
  it("removes a song", async () => {
    const record = await saveSong(VALID_SONG);
    await deleteSong(record.id);
    expect(await getSong(record.id)).toBeUndefined();
    expect(await listSongs()).toEqual([]);
  });

  it("does not throw for an id that does not exist", async () => {
    await expect(deleteSong("nope")).resolves.toBeUndefined();
  });
});
