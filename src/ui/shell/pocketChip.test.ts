import { describe, expect, it } from "vitest";
import { pocketChipText } from "./pocketChip";

describe("Tools button live chip", () => {
  it("shows nothing when idle, the bpm while clicking, the time while recording", () => {
    expect(pocketChipText({ metronomeBpm: null, recordingSec: null })).toBeNull();
    expect(pocketChipText({ metronomeBpm: 100, recordingSec: null })).toBe("♩ 100");
    expect(pocketChipText({ metronomeBpm: 99.6, recordingSec: null })).toBe("♩ 100");
    expect(pocketChipText({ metronomeBpm: 100, recordingSec: 12.4 })).toBe("● 0:12");
    expect(pocketChipText({ metronomeBpm: null, recordingSec: 75 })).toBe("● 1:15");
  });
});
