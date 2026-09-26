import { describe, expect, it } from "vitest";
import { parse } from "./parse.js";
import { parseYouTubeId, withYoutubeOffset } from "./youtube.js";

describe("parseYouTubeId", () => {
  it("parses youtu.be short links", () => {
    expect(parseYouTubeId("https://youtu.be/xxxxxxxxxxx")).toBe("xxxxxxxxxxx");
  });

  it("parses youtube.com/watch?v= links", () => {
    expect(parseYouTubeId("https://www.youtube.com/watch?v=xxxxxxxxxxx")).toBe("xxxxxxxxxxx");
  });

  it("parses youtube.com/watch?v= links with extra query params", () => {
    expect(parseYouTubeId("https://www.youtube.com/watch?v=xxxxxxxxxxx&t=30s")).toBe("xxxxxxxxxxx");
  });

  it("parses youtube.com/embed/ links", () => {
    expect(parseYouTubeId("https://www.youtube.com/embed/xxxxxxxxxxx")).toBe("xxxxxxxxxxx");
  });

  it("returns null for non-YouTube URLs", () => {
    expect(parseYouTubeId("https://vimeo.com/xxxxxxxxxxx")).toBeNull();
  });

  it("returns null for garbage input", () => {
    expect(parseYouTubeId("not a url")).toBeNull();
  });

  it("returns null when the video id is the wrong length", () => {
    expect(parseYouTubeId("https://youtu.be/short")).toBeNull();
  });
});

describe("withYoutubeOffset", () => {
  const song = () => {
    const r = parse(
      "title: T\ntime: 4/4\nbpm: 100\nunit: 8\nyoutube: https://youtu.be/xxxxxxxxxxx\noffset: 5\n\n[A]\nBar 1: {1} 1S0\n",
    );
    if (!r.ok) throw new Error("fixture failed to parse");
    return r.song;
  };

  it("returns a new song with the offset updated", () => {
    const updated = withYoutubeOffset(song(), 9.5);
    expect(updated.header.youtube?.offsetSec).toBe(9.5);
    expect(song().header.youtube?.offsetSec).toBe(5); // original untouched
  });

  it("clamps negative offsets to 0", () => {
    const updated = withYoutubeOffset(song(), -3);
    expect(updated.header.youtube?.offsetSec).toBe(0);
  });

  it("throws when the song has no youtube link", () => {
    const r = parse("title: T\ntime: 4/4\nbpm: 100\nunit: 8\n\n[A]\nBar 1: {1} 1S0\n");
    if (!r.ok) throw new Error("fixture failed to parse");
    expect(() => withYoutubeOffset(r.song, 5)).toThrow();
  });
});
