import { describe, expect, it } from "vitest";
import { hidesTabBar, tabForTarget } from "./TabBar";

describe("tab bar", () => {
  it("maps every target to a slot", () => {
    expect(tabForTarget("home")).toBe("home");
    expect(tabForTarget("library")).toBe("library");
    expect(tabForTarget("shared")).toBe("shared");
    expect(tabForTarget("chords")).toBe("chords");
    for (const t of ["exercises", "recorder", "settings"] as const) expect(tabForTarget(t)).toBe("more");
    expect(tabForTarget(null)).toBeNull();
  });
  it("hides on full-height screens only", () => {
    for (const k of ["song", "sample", "editor"]) expect(hidesTabBar(k)).toBe(true);
    for (const k of ["home", "library", "shared", "chords", "settings", "new-song"]) expect(hidesTabBar(k)).toBe(false);
  });
});
