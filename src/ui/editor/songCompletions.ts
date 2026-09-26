// Autocomplete for the song format (spec 5): header keys at line start,
// metadata flags inside a note's "(...)" block, and values after strum/bend.

import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";

const HEADER_KEYS: Completion[] = [
  { label: "title: ", detail: "song title", type: "property" },
  { label: "time: ", detail: "time signature, e.g. 4/4", type: "property" },
  { label: "bpm: ", detail: "tempo in quarter-note beats", type: "property" },
  { label: "unit: ", detail: "default slots per bar", type: "property" },
  { label: "youtube: ", detail: "reference video link", type: "property" },
  { label: "offset: ", detail: "video seconds where bar 1 starts", type: "property" },
  { label: "Bar ", detail: "Bar <n>: {slot} notes…", type: "keyword" },
  { label: "[Section]", detail: "start a section", type: "keyword" },
];

export const META_FLAGS: { key: string; value?: string; info: string }[] = [
  { key: "hammer", info: "Hammer-on, not picked. No previous note needed." },
  { key: "pull", info: "Pull-off from the previous (higher) note on this string." },
  { key: "slide", info: "Slide from the previous note on this string." },
  { key: "bend", value: "0-4 (step 0.5)", info: "Bend to N semitones above the fret; 0 = release." },
  { key: "slide_in", info: "Slide into the note from below (still picked)." },
  { key: "slide_out", info: "Slide away at the end of the note." },
  { key: "vibrato", info: "Held with vibrato." },
  { key: "muted", info: "Palm-muted or dead note." },
  { key: "strum", value: "up | down", info: "Strum direction for the whole slot." },
  { key: "flat", info: "Spell the letter as a flat (Db) instead of a sharp (C#)." },
];

const META_COMPLETIONS: Completion[] = META_FLAGS.map((f) => ({
  label: f.value ? `${f.key}: ` : f.key,
  displayLabel: f.key,
  detail: f.value,
  info: f.info,
  type: "variable",
}));

const VALUE_COMPLETIONS: Record<string, Completion[]> = {
  strum: [
    { label: "down", type: "constant" },
    { label: "up", type: "constant" },
  ],
  bend: ["0", "0.5", "1", "1.5", "2", "2.5", "3", "3.5", "4"].map((v) => ({
    label: v,
    detail: v === "0" ? "release" : v === "1" ? "½ step" : v === "2" ? "full" : undefined,
    type: "constant",
  })),
};

export function songCompletions(ctx: CompletionContext): CompletionResult | null {
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = line.text.slice(0, ctx.pos - line.from);

  // Inside an open "(" metadata block on this line?
  const open = before.lastIndexOf("(");
  if (open !== -1 && before.lastIndexOf(")") < open && /[1-6]S\d+(\[[^\]]*\])?$/.test(before.slice(0, open))) {
    const inner = before.slice(open + 1);
    const valueMatch = /([a-z_]+)\s*:\s*([\w.]*)$/.exec(inner);
    if (valueMatch) {
      const options = VALUE_COMPLETIONS[valueMatch[1]];
      if (!options) return null;
      return { from: ctx.pos - valueMatch[2].length, options, validFor: /^[\w.]*$/ };
    }
    const keyMatch = /(?:^|,)\s*([a-z_]*)$/.exec(inner);
    if (keyMatch) {
      return { from: ctx.pos - keyMatch[1].length, options: META_COMPLETIONS, validFor: /^[a-z_]*$/ };
    }
    return null;
  }

  // Start of a line: header keys, Bar, section.
  const lineStart = /^\s*([A-Za-z[]*)$/.exec(before);
  if (lineStart && (lineStart[1].length > 0 || ctx.explicit)) {
    return { from: ctx.pos - lineStart[1].length, options: HEADER_KEYS, validFor: /^[A-Za-z[]*$/ };
  }
  return null;
}
