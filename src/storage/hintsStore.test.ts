import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { HINTS_DB_NAME, _resetHintsDbForTests, clearHints, createHintsSaver, loadHints, saveHints } from "./hintsStore.js";
import { HINT_BINS } from "../audio/hints/constants";
import { emptyHints, setFrame } from "../audio/hints/types";

afterEach(async () => {
  await _resetHintsDbForTests();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(HINTS_DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
});

const frame = (v: number): Uint8Array => Uint8Array.from({ length: HINT_BINS }, (_, i) => (v + i) % 256);

describe("hints store", () => {
  it("round-trips sparse frames across chunks, with onsets", async () => {
    const h = emptyHints("vid1");
    for (let b = 10; b < 40; b++) setFrame(h, b, frame(0));
    for (let b = 40; b < 70; b++) setFrame(h, b, frame(200));
    setFrame(h, 1203, frame(5));
    await saveHints(h);
    expect(h.dirtyChunks.size).toBe(0);
    expect(h.onsets.length).toBeGreaterThan(0);
    const back = await loadHints("vid1");
    expect(back.frames.size).toBe(h.frames.size);
    expect(Array.from(back.frames.get(1203)!)).toEqual(Array.from(frame(5)));
    expect(back.frames.has(5)).toBe(false);
    expect(back.onsets).toEqual(h.onsets);
  });

  it("saves only dirty chunks and replaces re-recorded frames", async () => {
    const h = emptyHints("vid2");
    setFrame(h, 3, frame(1));
    await saveHints(h);
    const again = await loadHints("vid2");
    setFrame(again, 3, frame(9));
    setFrame(again, 700, frame(2));
    await saveHints(again);
    const back = await loadHints("vid2");
    expect(back.frames.get(3)![0]).toBe(9);
    expect(back.frames.size).toBe(2);
  });

  it("keeps videos apart and clears one", async () => {
    const a = emptyHints("a");
    const b = emptyHints("b");
    setFrame(a, 1, frame(1));
    setFrame(b, 1, frame(2));
    await saveHints(a);
    await saveHints(b);
    await clearHints("a");
    expect((await loadHints("a")).frames.size).toBe(0);
    expect((await loadHints("b")).frames.size).toBe(1);
  });

  it("debounces saves", async () => {
    const h = emptyHints("deb");
    const saver = createHintsSaver(h, 20);
    setFrame(h, 1, frame(1));
    saver.schedule();
    saver.schedule();
    expect((await loadHints("deb")).frames.size).toBe(0);
    await new Promise((r) => setTimeout(r, 80));
    expect((await loadHints("deb")).frames.size).toBe(1);
    setFrame(h, 2, frame(1));
    await saver.flush();
    expect((await loadHints("deb")).frames.size).toBe(2);
  });
});
