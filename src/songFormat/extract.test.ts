import { describe, expect, it } from "vitest";
import { extractSong } from "./extract.js";

describe("extractSong (spec 11.1 step 5)", () => {
  it("uses a fenced block explicitly tagged `song`", () => {
    const reply = `Here you go:

\`\`\`song
title: T
time: 4/4
bpm: 100
unit: 8

[A]
Bar 1: {1} 1S0
\`\`\`

Let me know if you need changes.`;
    const result = extractSong(reply);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain("title: T");
    expect(result.text).not.toContain("```");
  });

  it("falls back to any fenced block containing a title: line when no `song` tag exists", () => {
    const reply = `\`\`\`
title: T
time: 4/4
bpm: 100
unit: 8

[A]
Bar 1: {1} 1S0
\`\`\``;
    const result = extractSong(reply);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain("title: T");
  });

  it("prefers the tagged `song` block over other fenced blocks", () => {
    const reply = `\`\`\`
title: WRONG
\`\`\`

\`\`\`song
title: RIGHT
time: 4/4
bpm: 100
unit: 8

[A]
Bar 1: {1} 1S0
\`\`\``;
    const result = extractSong(reply);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain("title: RIGHT");
    expect(result.text).not.toContain("WRONG");
  });

  it("falls back to slicing from the first title: line to the last Bar line when there is no fence", () => {
    const reply = `Sure, here is the transcription:
title: T
time: 4/4
bpm: 100
unit: 8

[A]
Bar 1: {1} 1S0
Bar 2: {1} 1S3
Hope that helps!`;
    const result = extractSong(reply);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text.startsWith("title: T")).toBe(true);
    expect(result.text.trim().endsWith("Bar 2: {1} 1S3")).toBe(true);
    expect(result.text).not.toContain("Hope that helps");
  });

  it("returns an error when no song can be found", () => {
    const result = extractSong("I could not read the notes in that photo, sorry.");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe("No song found in the reply.");
  });
});
