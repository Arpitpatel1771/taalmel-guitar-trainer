import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../model/index.js";
import {
  applyImport,
  exportLibrary,
  exportSongFile,
  parseImportFile,
  slugify,
} from "./exportImport.js";
import { getSong, listSongs, saveSong } from "./songs.js";
import { loadSettings, saveSettings } from "./settings.js";
import { resetTaalmelDb } from "./testSetup.js";

afterEach(async () => {
  await resetTaalmelDb();
});

const SONG_A = `title: Song A
time: 4/4
bpm: 100
unit: 8

[Verse]
Bar 1: {1} 1S0 {2} 1S1
`;

const SONG_B = `title: Song B
time: 4/4
bpm: 120
unit: 4

[Verse]
Bar 1: {1} 6S0(muted)
`;

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("My Cool Song!")).toBe("my-cool-song");
  });

  it("strips accents", () => {
    expect(slugify("Café del Mar")).toBe("cafe-del-mar");
  });

  it("falls back to 'untitled' for a title with no alphanumerics", () => {
    expect(slugify("*** !!!")).toBe("untitled");
  });
});

describe("exportSongFile", () => {
  it("names the file after the slugified title and uses the canonical text", async () => {
    const record = await saveSong(SONG_A);
    const file = exportSongFile(record);
    expect(file.filename).toBe("song-a.txt");
    expect(file.text).toBe(record.text);
  });
});

describe("exportLibrary", () => {
  it("produces formatVersion 1 with all songs and current settings", async () => {
    await saveSong(SONG_A);
    await saveSong(SONG_B);
    await saveSettings({ ...DEFAULT_SETTINGS, zoom: 500 });

    const { filename, json } = await exportLibrary();
    expect(filename).toMatch(/^taalmel-library-\d{4}-\d{2}-\d{2}\.json$/);

    const parsed = JSON.parse(json);
    expect(parsed.formatVersion).toBe(1);
    expect(typeof parsed.exportedAt).toBe("string");
    expect(parsed.songs).toHaveLength(2);
    expect(parsed.settings.zoom).toBe(500);
  });
});

describe("parseImportFile", () => {
  it("validates a .txt file and returns its canonical text", async () => {
    const plan = await parseImportFile("song.txt", SONG_A);
    expect(plan.kind).toBe("song");
    if (plan.kind === "song") {
      expect(plan.text.startsWith("title: Song A\n")).toBe(true);
    }
  });

  it("rejects an invalid .txt file", async () => {
    const broken = SONG_A.replace("Bar 1:", "Bar 2:");
    const plan = await parseImportFile("song.txt", broken);
    expect(plan.kind).toBe("error");
  });

  it("classifies a valid library file and reports no conflicts on an empty db", async () => {
    const lib = {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      songs: [{ id: "id-1", text: SONG_A, createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z" }],
      settings: DEFAULT_SETTINGS,
    };
    const plan = await parseImportFile("lib.json", JSON.stringify(lib));
    expect(plan.kind).toBe("library");
    if (plan.kind === "library") {
      expect(plan.songs).toHaveLength(1);
      expect(plan.conflicts).toEqual([]);
      expect(plan.settings).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("reports ids that already exist in the db as conflicts", async () => {
    const existing = await saveSong(SONG_A, "existing-id");
    const lib = {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      songs: [{ id: existing.id, text: SONG_B, createdAt: "x", updatedAt: "y" }],
    };
    const plan = await parseImportFile("lib.json", JSON.stringify(lib));
    expect(plan.kind).toBe("library");
    if (plan.kind === "library") {
      expect(plan.conflicts).toEqual([existing.id]);
    }
  });

  it("rejects a future formatVersion clearly", async () => {
    const lib = { formatVersion: 2, exportedAt: "", songs: [] };
    const plan = await parseImportFile("lib.json", JSON.stringify(lib));
    expect(plan.kind).toBe("error");
    if (plan.kind === "error") {
      expect(plan.message).toMatch(/newer version/i);
    }
  });

  it("rejects malformed JSON", async () => {
    const plan = await parseImportFile("lib.json", "{ not json");
    expect(plan.kind).toBe("error");
  });

  it("rejects an unrecognized extension", async () => {
    const plan = await parseImportFile("song.pdf", "whatever");
    expect(plan.kind).toBe("error");
  });
});

describe("applyImport", () => {
  it("throws for an error plan", async () => {
    await expect(
      applyImport({ kind: "error", message: "boom" }, { onConflict: "skip", importSettings: false }),
    ).rejects.toThrow("boom");
  });

  it("imports a single song plan under a new id", async () => {
    const plan = await parseImportFile("song.txt", SONG_A);
    const summary = await applyImport(plan, { onConflict: "skip", importSettings: false });
    expect(summary.imported).toBe(1);
    const all = await listSongs();
    expect(all).toHaveLength(1);
    expect(all[0]!.title).toBe("Song A");
  });

  it("inserts non-conflicting library songs directly under their original id", async () => {
    const lib = {
      formatVersion: 1,
      exportedAt: "",
      songs: [{ id: "keep-id", text: SONG_A, createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z" }],
    };
    const plan = await parseImportFile("lib.json", JSON.stringify(lib));
    const summary = await applyImport(plan, { onConflict: "skip", importSettings: false });
    expect(summary.imported).toBe(1);
    const record = await getSong("keep-id");
    expect(record?.title).toBe("Song A");
    expect(record?.createdAt).toBe("2020-01-01T00:00:00Z");
  });

  it("resolves conflicts via a fixed decision: replace", async () => {
    const existing = await saveSong(SONG_A, "conflict-id");
    const lib = {
      formatVersion: 1,
      exportedAt: "",
      songs: [{ id: existing.id, text: SONG_B, createdAt: "later", updatedAt: "later" }],
    };
    const plan = await parseImportFile("lib.json", JSON.stringify(lib));
    const summary = await applyImport(plan, { onConflict: "replace", importSettings: false });
    expect(summary.replaced).toBe(1);
    const record = await getSong(existing.id);
    expect(record?.title).toBe("Song B");
  });

  it("resolves conflicts via a fixed decision: skip", async () => {
    const existing = await saveSong(SONG_A, "conflict-id");
    const lib = {
      formatVersion: 1,
      exportedAt: "",
      songs: [{ id: existing.id, text: SONG_B, createdAt: "later", updatedAt: "later" }],
    };
    const plan = await parseImportFile("lib.json", JSON.stringify(lib));
    const summary = await applyImport(plan, { onConflict: "skip", importSettings: false });
    expect(summary.skipped).toBe(1);
    const record = await getSong(existing.id);
    expect(record?.title).toBe("Song A");
  });

  it("resolves conflicts via a fixed decision: keepBoth, assigning a new id", async () => {
    const existing = await saveSong(SONG_A, "conflict-id");
    const lib = {
      formatVersion: 1,
      exportedAt: "",
      songs: [{ id: existing.id, text: SONG_B, createdAt: "later", updatedAt: "later" }],
    };
    const plan = await parseImportFile("lib.json", JSON.stringify(lib));
    const summary = await applyImport(plan, { onConflict: "keepBoth", importSettings: false });
    expect(summary.keptBoth).toBe(1);
    const all = await listSongs();
    expect(all).toHaveLength(2);
    const titles = all.map((r) => r.title).sort();
    expect(titles).toEqual(["Song A", "Song B"]);
  });

  it("resolves conflicts via a per-id callback", async () => {
    const a = await saveSong(SONG_A, "id-a");
    const b = await saveSong(SONG_B, "id-b");
    const lib = {
      formatVersion: 1,
      exportedAt: "",
      songs: [
        { id: a.id, text: SONG_A.replace("Song A", "Song A2"), createdAt: "x", updatedAt: "x" },
        { id: b.id, text: SONG_B.replace("Song B", "Song B2"), createdAt: "x", updatedAt: "x" },
      ],
    };
    const plan = await parseImportFile("lib.json", JSON.stringify(lib));
    const summary = await applyImport(plan, {
      onConflict: (id) => (id === a.id ? "replace" : "skip"),
      importSettings: false,
    });
    expect(summary.replaced).toBe(1);
    expect(summary.skipped).toBe(1);
    expect((await getSong(a.id))?.title).toBe("Song A2");
    expect((await getSong(b.id))?.title).toBe("Song B");
  });

  it("stores a song that fails to parse rather than dropping it, with best-effort fields", async () => {
    const broken = SONG_A.replace("Bar 1:", "Bar 2:");
    const lib = {
      formatVersion: 1,
      exportedAt: "",
      songs: [{ id: "broken-id", text: broken, createdAt: "x", updatedAt: "x" }],
    };
    const plan = await parseImportFile("lib.json", JSON.stringify(lib));
    const summary = await applyImport(plan, { onConflict: "skip", importSettings: false });
    expect(summary.imported).toBe(1);
    const record = await getSong("broken-id");
    expect(record?.text).toBe(broken);
    expect(record?.title).toBe("Song A");
  });

  it("imports settings only when importSettings is true", async () => {
    const lib = {
      formatVersion: 1,
      exportedAt: "",
      songs: [],
      settings: { ...DEFAULT_SETTINGS, zoom: 777 },
    };
    const plan = await parseImportFile("lib.json", JSON.stringify(lib));

    const skipped = await applyImport(plan, { onConflict: "skip", importSettings: false });
    expect(skipped.settingsImported).toBe(false);
    expect((await loadSettings()).zoom).toBe(DEFAULT_SETTINGS.zoom);

    const applied = await applyImport(plan, { onConflict: "skip", importSettings: true });
    expect(applied.settingsImported).toBe(true);
    expect((await loadSettings()).zoom).toBe(777);
  });
});
