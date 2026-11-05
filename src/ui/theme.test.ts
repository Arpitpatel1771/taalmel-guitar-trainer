import { describe, expect, it } from "vitest";
import { nextThemePref, parseThemeCache, resolveTheme } from "./theme";

describe("theme", () => {
  it("resolves system from the OS", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("toggles to an explicit opposite mode", () => {
    expect(nextThemePref("dark", false)).toBe("light");
    expect(nextThemePref("system", true)).toBe("light");
    expect(nextThemePref("system", false)).toBe("dark");
  });

  it("reads the first-paint cache defensively", () => {
    expect(parseThemeCache('{"theme":"light","accent":"teal"}')).toEqual({ theme: "light", accent: "teal" });
    expect(parseThemeCache('{"theme":"neon","accent":3}')).toEqual({ theme: "system", accent: "saffron" });
    expect(parseThemeCache("not json")).toEqual({ theme: "system", accent: "saffron" });
    expect(parseThemeCache(null)).toEqual({ theme: "system", accent: "saffron" });
  });
});
