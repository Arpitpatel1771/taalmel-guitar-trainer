// Import prompt and repair prompt builders (spec 11.2, 11.3).

import type { ParseError, TimeSignature } from "../model/index.js";
import { noteNameWithOctave, pitchOf } from "../notation/index.js";

export interface ImportForm {
  title: string;
  time: TimeSignature;
  bpm: number;
  unit: number;
  youtubeUrl?: string;
  offsetSec?: number;
}

/** A fret table cell: both spellings for a black key (e.g. "C#4/Db4"), a single
 * name for a natural (e.g. "E4") since there is no ambiguity to show. */
function noteCell(midi: number): string {
  const sharp = noteNameWithOctave(midi, "sharps");
  const flat = noteNameWithOctave(midi, "flats");
  return sharp === flat ? sharp : `${sharp}/${flat}`;
}

/** The string/fret -> note name table for frets 0-12, all 6 strings, standard tuning
 * (spec 11.2 point 4). Generated from `notation`, not hand-typed, so it can never
 * drift from the tuning/pitch math the rest of the app uses. */
function buildFretTable(): string {
  const stringNumbers = [1, 2, 3, 4, 5, 6] as const;
  const header = `| Fret | ${stringNumbers.map((s) => `String ${s}`).join(" | ")} |`;
  const divider = `| --- | ${stringNumbers.map(() => "---").join(" | ")} |`;
  const rows: string[] = [header, divider];
  for (let fret = 0; fret <= 12; fret++) {
    const cells = stringNumbers.map((s) => noteCell(pitchOf(s, fret)));
    rows.push(`| ${fret} | ${cells.join(" | ")} |`);
  }
  return rows.join("\n");
}

const FORMAT_SPEC = `Line types: header fields ("key: value") come before any section. A section
starts with "[Name]" on its own line; at least one section is required, and each
section needs at least one bar. Immediately after a section start, and before that
section's first bar, you may write "bpm: <number>" and/or "unit: <int>" to override
the song defaults for that section only.

Bars look like:
  Bar <k>: [(<n>)] {<s>} <note> <note>... {<s>} <note>...
- <k> is the bar number, numbered 1, 2, 3, ... consecutively across the WHOLE song
  (never restart per section). A gap or a repeat is an error.
- (<n>) is an optional slot count for this bar (defaults to the section/song "unit").
  n must divide the bar's ticks evenly.
- {<s>} marks the slot (1..n) where the following notes start. Slot markers within a
  bar must strictly increase. A bar with no slots at all is a valid, fully silent bar.
- Notes in the same slot are played together and must be on different strings.
- There are no rest tokens: silence is simply the absence of notes.

Notes look like:
  <string>S<fret>[<length>](<meta>)
- <string> is 1-6 (1 = high E, 6 = low E), <fret> is 0-24. The "S" is uppercase.
- The optional [length] block, in this fixed order, each part optional (omit the
  whole block if none apply):
    1. Count: "<k>" = k units of this bar's grid (e.g. [2] = 2 slots), or
       "<k>X<a>/<b>" = k times the note value a/b of a whole note (e.g. [3X1/16] =
       three sixteenth notes), independent of the bar's grid. Omitted = 1 unit.
    2. Offset: ">-15" or ">20" - a millisecond timing nudge applied after converting
       to seconds (negative = early, positive = late). Omitted = 0. Range -500..500.
    3. "?" - marks this note's rhythm as a guess. Omit if you are confident.
  Examples: 1S5[2], 1S5[2>-15], 1S5[?], 1S5[4?], 1S5[3X1/16>10?], 1S5[>-8].
- The optional (meta) block is comma-separated entries, each "key" (boolean) or
  "key: value":
    | Key         | Value           | Meaning                                                      |
    | ----------- | --------------- | ------------------------------------------------------------ |
    | hammer      | (none)          | Hammer-on: sounded without picking. Needs no previous note.   |
    | pull        | (none)          | Reached by pull-off from the previous note on this string.    |
    | slide       | (none)          | Reached by sliding from the previous note on this string.     |
    | bend        | 0-4, step 0.5   | Bent N semitones above the fret; 0 = release. May stand alone. |
    | slide_in    | (none)          | Approached by a slide from an unspecified lower fret; picked.  |
    | slide_out   | (none)          | Slides away to an unspecified fret at its end.                 |
    | vibrato     | (none)          | Held with vibrato.                                             |
    | muted       | (none)          | Palm-muted or dead note.                                       |
    | strum       | up / down       | Strum direction (place on the slot's first note).              |
    | flat        | (none)          | Spells this note as a flat (e.g. Db) instead of the default sharp (e.g. C#). |
  Unknown metadata keys are errors, so never invent new ones.

Letter spelling: every note displays as a sharp by default. Add "(flat)" to a note
whenever the source notes/tab spell that pitch as a flat (e.g. "Db" rather than
"C#"); leave it off when the source spells it as a sharp, and always leave it off
for natural notes (no black key) -- "flat" on a natural is an error. A song can mix
sharp- and flat-spelled notes freely.

Connection flag rule (pull/slide): the flag goes on the DESTINATION note
and describes how it is reached from the previous note on the SAME STRING (the most
recent earlier note with that string number, searching back across bars if needed).
- hammer: no rule. It may follow any note or none at all ("hammer-on from nowhere").
- pull: fret must be less than the previous note's fret.
- slide: fret must differ from the previous note's fret.
- bend: no rule. Write the bent note at the SAME fret you press (the number is the
  semitones, not the target fret). Same fret as the previous note = bend of that
  note; alone or on a new fret = picked and bent immediately.
- At most one of hammer/pull/slide/bend per note. slide_in cannot combine with a
  connection flag.`;

const WORKED_EXAMPLE = `\`\`\`song
title: Example Song
time: 4/4
bpm: 94
unit: 8

[Intro]
Bar 1: (8) {1} 2S5[2] {3} 1S5 3S7[2] {5} 1S8[4]
Bar 2: (12) {1} 2S5 {2} 2S7 {3} 1S5[4?]

[Verse]
bpm: 100
unit: 16
Bar 3: {1} 1S3 {2} 1S5(hammer) {3} 1S4(pull) {5} 1S3[2>-15]
Bar 4: {1} 2S7 {3} 2S7[2](bend: 2) {5} 2S7[4](bend: 0)
Bar 5: {1} 6S0[4](strum: down) 5S2[4] 4S2[4] {9} 6S0(strum: up, muted)
\`\`\`

Tab equivalents:
| Tab        | Song format                                 |
| ---------- | -------------------------------------------- |
| e: 3h5p4   | {1} 1S3 {2} 1S5(hammer) {3} 1S4(pull)         |
| e: 3/5\\2   | {1} 1S3 {2} 1S5(slide) {4} 1S2(slide)         |
| B: 7b9r7   | {1} 2S7 {3} 2S7(bend: 2) {5} 2S7(bend: 0)     |`;

/** Builds the LLM import prompt (spec 11.2). Header values come from the form the
 * user filled in (never guessed by the LLM); the prompt tells the LLM to copy them
 * exactly. */
export function buildImportPrompt(form: ImportForm): string {
  const headerLines = [
    `title: ${form.title}`,
    `time: ${form.time.numerator}/${form.time.denominator}`,
    `bpm: ${form.bpm}`,
    `unit: ${form.unit}`,
  ];
  if (form.youtubeUrl) {
    headerLines.push(`youtube: ${form.youtubeUrl}`);
    headerLines.push(`offset: ${form.offsetSec ?? 0}`);
  }

  return `Task: transcribe the guitar notes shown in the attached photo/text into the
"Taalmel song format" described below. Output ONLY one fenced code block tagged
\`song\` (\`\`\`song ... \`\`\`) containing the transcribed song. Do not include any
other fenced blocks, and do not add commentary inside the block.

Use exactly these header lines, copied verbatim (do not change any value):
${headerLines.join("\n")}

--- Song format specification ---
${FORMAT_SPEC}

--- String/fret to note name table (standard tuning, frets 0-12) ---
Look up positions in this table rather than computing them yourself:
${buildFretTable()}

--- Rhythm instructions ---
If you are confident of the song's rhythm (note lengths and starts), encode it using
the length block. If you are NOT confident, place the notes on consecutive slots of
the default grid ("unit" above) with length 1, and mark EVERY such note uncertain
with "?". Never invent a confident-looking rhythm you are not sure of.

--- Worked example ---
${WORKED_EXAMPLE}

--- Common errors to avoid ---
1. Bar numbering is global across the whole song (1, 2, 3, ...), never restarted
   per section.
2. Slot markers within a bar must strictly increase.
3. Every note must fit inside its bar (it cannot extend past the bar's end).
4. Only one note per string per slot (a chord/double-stop needs different strings).`;
}

function formatErrorLine(e: ParseError): string {
  const locationParts: string[] = [];
  if (e.bar !== undefined) locationParts.push(`bar ${e.bar}`);
  if (e.slot !== undefined) locationParts.push(`slot ${e.slot}`);
  const location = locationParts.length > 0 ? ` (${locationParts.join(", ")})` : "";
  const tokenSuffix = e.token !== undefined ? ` Token: ${e.token}` : "";
  return `Line ${e.line}${location}: ${e.message}.${tokenSuffix}`;
}

/** Builds the repair prompt (spec 11.3), sent back to the LLM with the previous
 * errors and the user's current (possibly hand-edited) text. */
export function buildRepairPrompt(errors: ParseError[], currentText: string): string {
  const errorLines = errors.map(formatErrorLine).join("\n");
  return `Your previous output had these errors. Fix only these, keep everything else
identical, and output the full corrected song in one \`\`\`song block.

${errorLines}

--- Current text (preserve any manual edits below) ---
\`\`\`song
${currentText}
\`\`\``;
}
