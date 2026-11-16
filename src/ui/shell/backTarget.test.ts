import { describe, expect, it } from "vitest";
import { nextBackTarget } from "./backTarget";

describe("nextBackTarget", () => {
  const lib = { kind: "library" };
  const home = { kind: "home" };
  const song = { kind: "song" };
  const editor = { kind: "editor" };

  it("remembers the top-level screen left for a song", () => {
    expect(nextBackTarget(lib, home, song)).toBe(home);
  });

  it("keeps the target through practice and the editor", () => {
    let t = nextBackTarget(lib, home, song);
    t = nextBackTarget(t, song, editor);
    t = nextBackTarget(t, editor, song);
    expect(t).toBe(home);
  });

  it("ignores a re-render of the same kind", () => {
    expect(nextBackTarget(lib, home, { kind: "home" })).toBe(lib);
  });
});
