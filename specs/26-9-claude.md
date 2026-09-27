# Taalmel: Design Spec (v1)

_Taalmel (Hindi): being in sync. Built on "taal", a rhythm cycle._

Status: approved in brainstorming, pending written-spec review
Date: 2026-09-26
Audience: human developers and LLM coding agents. Every decision here is meant to be implementable without access to the conversation that produced it.

---

## 1. Purpose

A browser-only guitar practice tool that shows a song's notes on a time grid, moves a cursor across them in time with a metronome or a synced YouTube video, and listens through the microphone to show the player where they actually played relative to where they should have.

### 1.1 The problem it solves

- The author's teacher writes songs as note sequences with **no rhythm information**. Students are expected to figure out rhythm by ear from the recording. That feedback loop is slow, and it is easy to drift off the beat and get lost.
- Existing tools cover parts of this (Yousician and Rocksmith+ have mic feedback but closed catalogs; Songsterr and Soundslice have synced cursors; Guitar Pro and MuseScore have full rhythm editing), but none combine: custom songs, a text format any LLM can produce, mic timing feedback, and fully local operation.

### 1.2 Success criteria for v1

1. A user can turn a photo of handwritten notes into a playable, timed song using only copy/paste with any LLM, in a few minutes.
2. While playing, the user can see within a frame or two whether each pluck landed early, on time, or late.
3. The user can practise against a steady grid or against the original YouTube recording.
4. Nothing leaves the user's machine. No backend, no accounts.
5. The song library survives browser restarts and can be exported to a single file and restored.

### 1.3 Non-goals for v1

See section 14 for the full deferred list. Most notably: no instruments besides guitar, no staff notation, no audio transcription of recordings, no manual timing tools (tap-to-time, grid editor).

---

## 2. Glossary

| Term                      | Meaning                                                                                                                                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **String number**         | 1 to 6. String 1 is the **high E** (thinnest). String 6 is the low E (thickest). Standard tuning only in v1: 1=E4, 2=B3, 3=G3, 4=D3, 5=A2, 6=E2.                                                                                    |
| **Fret**                  | 0 to 24. 0 means open string.                                                                                                                                                                                                       |
| **Position**              | A (string, fret) pair, written `<string>S<fret>`, e.g. `1S0`, `6S3`.                                                                                                                                                                |
| **Tick**                  | Internal unit of musical time. **960 ticks per quarter note (PPQ = 960)**, so a whole note is 3840 ticks. 960 is divisible by 2, 3, 4, 5, 6, 8, 10, 12, 15, 16 and more, so common subdivisions and tuplets land on whole integers. |
| **Bar**                   | One measure. Its length in ticks is `numerator * (3840 / denominator)` from the time signature. 4/4 = 3840 ticks, 3/4 = 2880, 6/8 = 2880.                                                                                           |
| **Grid / slot count (n)** | How many equal slots a bar is divided into. 4/4 with n=8 is eighth notes, n=12 is triplet eighths, n=16 is sixteenths. Slot length = bar ticks / n.                                                                                 |
| **Slot**                  | One position on a bar's grid, numbered 1 to n.                                                                                                                                                                                      |
| **Unit**                  | One slot's duration. Note lengths are counted in units of the bar they are in, unless overridden.                                                                                                                                   |
| **Section**               | A labelled group of bars (e.g. `[Verse]`). Can override BPM and default grid.                                                                                                                                                       |
| **Connection flag**       | Metadata on a note saying it is reached from the previous note on the same string without being picked (hammer, pull, slide, bend).                                                                                                 |
| **Onset**                 | The moment the mic detects a new note attack.                                                                                                                                                                                       |
| **Grid mode**             | Practice mode where the metronome is the master clock.                                                                                                                                                                              |
| **Video mode**            | Practice mode where the embedded YouTube video is the master clock.                                                                                                                                                                 |
| **Row / system**          | One horizontal line of bars on screen in page layout.                                                                                                                                                                               |
| **Lane**                  | One notation's rendering within a row (tab lane, letter lane, teacher-notation lane), all sharing the row's time axis.                                                                                                              |

---

## 3. Technology

- **Language:** TypeScript, `strict: true`. Chosen because code will be LLM-written and human-read; types act as documentation of every function's inputs and outputs.
- **Build/dev:** Vite. `npm run dev` for development, `npm run build` produces a static `dist/` folder.
- **UI:** React (latest stable). No external state library in v1; React context plus reducers for app state. Per-frame animation never goes through React state (see 8.4).
- **Tests:** Vitest.
- **Browser APIs:** Web Audio (`AudioContext`, `AudioWorklet`), `getUserMedia`, Web Workers, IndexedDB, YouTube IFrame Player API.
- **Running locally:** must be served over `http://localhost` (dev server or `vite preview` or any static server). Opening `index.html` via `file://` is not supported: AudioWorklet modules and `getUserMedia` require a secure context, and `localhost` counts as one.
- **No backend.** The only network access is loading the YouTube embed when a song has a video.
- **Target browsers:** current Chrome/Edge and Firefox on desktop. Safari is best-effort. Mobile is out of scope for v1.

---

## 4. Architecture

### 4.1 Modules

Each module has one purpose and communicates through types from `model`. Directory = module.

| Module           | Responsibility                                                                                                                                                                                 | Depends on           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `src/model`      | Pure types only: `Song`, `Section`, `Bar`, `Note`, `NoteMeta`, `TimeSignature`, `SongHeader`, `ParseError`, `Settings`. No logic.                                                              | nothing              |
| `src/notation`   | Fretboard math (position to pitch, pitch to letter name), and per-display-notation mappers that turn a `Note` into glyph data for rendering (tab, letters, teacher notation).                  | model                |
| `src/songFormat` | The song text format: parse (text to `Song` or errors), serialize (`Song` to canonical text), validate, extract a song block from an LLM reply, build the import prompt and the repair prompt. | model, notation      |
| `src/storage`    | IndexedDB access for songs and settings; library export/import; single-song `.txt` export/import.                                                                                              | model, songFormat    |
| `src/tempo`      | Tempo map: converts between seconds and ticks for a song, respecting per-section BPM. Pure.                                                                                                    | model                |
| `src/clock`      | The `Clock` interface and its two implementations, `GridClock` and `VideoClock`.                                                                                                               | tempo                |
| `src/audio`      | Shared `AudioContext` lifecycle, metronome scheduler, mic capture, the envelope/onset AudioWorklet, the pitch-detection Worker, calibration routines, onset-to-note matching.                  | model, tempo, clock  |
| `src/layout`     | Pure function: `(Song, viewportWidth, zoom, enabledLanes) -> Layout` (rows, bar boxes, note boxes, x-coordinates for ticks). Runs in Node for tests.                                           | model, notation      |
| `src/render`     | React components for the sheet, the requestAnimationFrame controller (cursor, auto-scroll), envelope canvases.                                                                                 | layout, clock, audio |
| `src/exercises`  | Generators that output song **text** in the song format.                                                                                                                                       | songFormat           |
| `src/ui`         | App chrome: library screen, import dialog, song editor/preview, transport bar, settings, calibration screen, session summary.                                                                  | everything above     |

### 4.2 Data flow

```
Import:     LLM reply text -> songFormat.extract -> songFormat.parse/validate -> Song
            -> (user saves) -> storage (stores canonical text)
Load:       storage text -> songFormat.parse -> Song
Display:    Song -> layout -> render (DOM/SVG)
Playback:   active Clock -> rAF loop -> cursor transform, auto-scroll
            GridClock -> metronome scheduler (clicks)
Feedback:   mic -> AudioWorklet -> {envelope points, onsets, onset audio slices} via MessagePort
            envelope points -> latency shift -> envelope canvas of active row
            onsets -> matcher (vs expected note starts) -> timing verdicts
            onset slices -> pitch Worker (YIN) -> pitch verdicts -> markers
```

### 4.3 Hard rules

1. **Text is the source of truth for songs.** Storage keeps canonical text; the in-memory `Song` is always rebuilt by parsing. There is never a second stored representation that can drift.
2. **Everything time-related reads the active `Clock`.** No component computes musical position from wall time on its own.
3. **Per-frame updates bypass React.** A single rAF loop mutates DOM transforms and canvases through refs.
4. **Worklet/worker communication uses `MessagePort`, not `SharedArrayBuffer`.** SharedArrayBuffer requires cross-origin isolation headers (COOP/COEP), which break the YouTube embed.
5. **Metronome clicks are scheduled on `AudioContext` time with lookahead**, never fired from `setTimeout`/`setInterval` directly.

---

## 5. Song text format

This is the format LLMs produce, users hand-edit, storage keeps, and exercise generators emit. It is line-based, plain UTF-8 text.

### 5.1 Complete example

```
title: Example Song
time: 4/4
bpm: 94
unit: 8
youtube: https://youtu.be/xxxxxxxxxxx
offset: 12.35

[Intro]
Bar 1: (8) {1} 2S5[2] {3} 1S5 3S7[2] {5} 1S8[4]
Bar 2: (12) {1} 2S5 {2} 2S7 {3} 1S5[4?]

[Verse]
bpm: 100
unit: 16
Bar 3: {1} 1S3 {2} 1S5(hammer) {3} 1S4(pull) {5} 1S3[2>-15]
Bar 4: {1} 2S7 {3} 2S7[2](bend: 2) {5} 2S7[4](bend: 0)
Bar 5: {1} 6S0[4](strum: down) 5S2[4] 4S2[4] {9} 6S0(strum: up, muted)
```

### 5.2 Line types

The parser processes lines in order. Leading/trailing whitespace is trimmed. Empty lines are ignored. A line starting with `#` is a comment and is ignored.

| Line          | Form                             | Where allowed                                                      |
| ------------- | -------------------------------- | ------------------------------------------------------------------ |
| Header field  | `key: value`                     | Before the first section line                                      |
| Section start | `[Name]`                         | Anywhere after the header; at least one required                   |
| Section field | `bpm: <number>` or `unit: <int>` | Immediately after a section start, before that section's first bar |
| Bar           | `Bar <k>: [(<n>)] <slots...>`    | Inside a section                                                   |

### 5.3 Header fields

| Key       | Required                  | Value                                                                      | Meaning                                                                                                                                                                                     |
| --------- | ------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`   | yes                       | free text                                                                  | Song title.                                                                                                                                                                                 |
| `time`    | yes                       | `<int>/<int>`                                                              | Time signature for the whole song. Denominator must be 1, 2, 4, 8, 16, or 32. Numerator 1 to 32.                                                                                            |
| `bpm`     | yes                       | number > 0, up to 400, decimals allowed                                    | Default tempo. Beats are **quarter notes**, regardless of time signature. For compound meters users convert: a 6/8 song felt at 60 dotted-quarter beats is entered as `bpm: 90` (60 x 1.5). |
| `unit`    | yes                       | int >= 1                                                                   | Default slot count per bar.                                                                                                                                                                 |
| `youtube` | no                        | YouTube URL (`youtube.com/watch?v=`, `youtu.be/`, or `youtube.com/embed/`) | Reference video.                                                                                                                                                                            |
| `offset`  | only if `youtube` present | seconds, decimals allowed, >= 0                                            | Video timestamp at which bar 1, slot 1 begins.                                                                                                                                              |

Unknown header keys are errors. Duplicate keys are errors.

### 5.4 Sections

- `[Name]`: name is any text without `]`. Names need not be unique, but duplicate names produce a warning (they make looping by section ambiguous).
- Section fields `bpm` and `unit` override the song defaults for that section's bars only. They do not carry over into the next section; each section falls back to the header values unless it sets its own.
- A section must contain at least one bar.

### 5.5 Bars

```
Bar <k>: [(<n>)] {<s>} <note> <note> ... {<s>} <note> ...
```

- `<k>`: bar number. Bars are numbered 1, 2, 3, ... **consecutively across the whole song**, not per section. A gap or repeat is an error.
- `(<n>)`: optional slot count for this bar. If omitted, the section's `unit` applies (or the header `unit`).
- `n` must divide the bar's tick length evenly (so every slot is a whole number of ticks). Example: 4/4 is 3840 ticks, so n=7 is an error; n=12 and n=16 are fine.
- `{<s>}`: slot marker, 1 <= s <= n. Slot markers within a bar must be **strictly increasing**. Only slots where at least one note starts are written; empty slots are omitted.
- The notes after a slot marker all **start** on that slot. Multiple notes in one slot are played together (a chord or double stop). They must be on **different strings**.
- A note held across several slots is written once, at its start slot, with a length. It is not repeated in later slots.
- There are **no rest tokens**. Silence is the absence of notes.
- A bar with no slots at all (`Bar 7: (8)`) is a fully silent bar and is valid.

### 5.6 Notes

```
<string>S<fret>[<length>](<meta>)
```

Order is fixed: position, then optional length block, then optional metadata block. No spaces inside a note token.

**Position:** `<string>` is 1 to 6, `<fret>` is 0 to 24. The `S` is uppercase. Examples: `1S0`, `3S12`.

**Length block** `[...]` (optional). Inside the brackets, in this order, each part optional but at least one present:

1. **Count**, one of:
   - `<k>`: k units of this bar's grid. `[2]` = 2 slots.
   - `<k>X<a>/<b>`: k times the note value a/b of a whole note, independent of the bar's grid. `[3X1/16]` = three sixteenths. Uppercase `X`.
   - Omitted: 1 unit.
2. **Offset** `><signed int>`: a timing nudge in **milliseconds**, applied after converting musical time to seconds. `>-15` = 15 ms early, `>20` or `>+20` = 20 ms late. Omitted means 0. Range -500 to +500.
3. **Uncertain** `?`: this note's rhythm (start or length) is a guess. The UI highlights it.

Examples: `1S5[2]`, `1S5[2>-15]`, `1S5[?]`, `1S5[4?]`, `1S5[3X1/16>10?]`, `1S5[>-8]`.

Length rules:

- Resulting tick length must be a positive integer.
- A note must end at or before the end of its bar. Ties across bar lines are not supported in v1.
- A later note on the same string cuts off an earlier ringing note. Overlap is allowed (it is normal in real playing) and produces no error; the renderer draws the earlier note shortened.

**Metadata block** `(...)` (optional): comma-separated entries. Each entry is either `key` (means true) or `key: value`. Values are unquoted. Whitespace around commas and colons is allowed.

| Key         | Value                   | Kind       | Meaning                                                                                                                                                            |
| ----------- | ----------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hammer`    | none                    | connection | Hammer-on: sounded by the fretting hand, not picked. Needs no previous note ("hammer-on from nowhere").                                                          |
| `pull`      | none                    | connection | Reached by pull-off from the previous note on this string. Not picked.                                                                                             |
| `slide`     | none                    | connection | Reached by sliding from the previous note on this string. Not picked.                                                                                              |
| `bend`      | number 0 to 4, step 0.5 | connection | Pitch bent to this many semitones above the fretted note. On the same fret as the previous note on this string it continues that note (not picked); alone or on a new fret it is picked and bent immediately. `0` = released. |
| `slide_in`  | none                    | modifier   | Note is approached by a slide from an unspecified lower fret. It **is** picked (the pick happens during the slide).                                                |
| `slide_out` | none                    | modifier   | Note slides away to an unspecified fret at its end.                                                                                                                |
| `vibrato`   | none                    | modifier   | Note is held with vibrato. Picked or not according to its other flags; can combine with a connection flag (e.g. `(bend: 2, vibrato)`).                             |
| `muted`     | none                    | modifier   | Palm-muted or dead note.                                                                                                                                           |
| `strum`     | `up` or `down`          | modifier   | Strum direction. Conventionally placed on the first note of a chord slot; applies to that whole slot.                                                              |
| `flat`      | none                    | modifier   | Spells this note as a flat (e.g. `Db`) instead of the default sharp (e.g. `C#`). A song can mix flat- and sharp-spelled notes freely.                              |

Letter names display as sharps by default; there is no user-facing sharps/flats setting. `flat` is per-note and only meaningful on a black-key fret -- applying it to a natural (white-key) note is an error (`FLAT_ON_NATURAL`).

**Connection flag rule (applies to `pull`, `slide`; `hammer` and `bend` are exempt):** the flag goes on the **destination** note and describes how that note is reached from the **previous note on the same string** (the most recent earlier-starting note with the same string number, searching back across bars). This works even inside chords because one string plays one note at a time.

Validation for connection flags:

- There must be a previous note on the same string (except for `hammer` and `bend`). Otherwise error.
- `hammer`: no rule. It may follow any note on the string, or none.
- `pull`: fret must be less than the previous note's fret.
- `slide`: fret must differ from the previous note's fret.
- `bend`: no rule. The note is written at the fret being pressed; the value is semitones.
- At most one of `hammer`, `pull`, `slide`, `bend` per note.
- `slide_in` cannot combine with a connection flag.

Unknown metadata keys are **errors** (to catch LLM-invented keys before they silently mean nothing).

Tab equivalents, for prompt examples and documentation:

| Tab        | Song format                                 |
| ---------- | ------------------------------------------- |
| `e: 3h5p4` | `{1} 1S3 {2} 1S5(hammer) {3} 1S4(pull)`     |
| `e: 3/5\2` | `{1} 1S3 {2} 1S5(slide) {4} 1S2(slide)`     |
| `B: 7b9r7` | `{1} 2S7 {3} 2S7(bend: 2) {5} 2S7(bend: 0)` |

### 5.7 Canonical serialization

`serialize(song)` must produce exactly one text form so that exports and diffs are stable:

- Header keys in the order: `title`, `time`, `bpm`, `unit`, `youtube`, `offset`. One blank line after the header.
- Sections separated by one blank line. Section fields in order `bpm`, `unit`, only if they override.
- `(n)` written only when it differs from the effective section unit.
- Within a slot, notes ordered by string number ascending.
- Length block written only when non-default; count written in grid form `<k>` when it is a whole number of the bar's units, otherwise `<k>X<a>/<b>` in lowest terms. Offset written only when non-zero, with explicit sign for negatives only (`>-15`, `>20`).
- Metadata keys in the order of the table in 5.6 (`flat` last). Boolean entries written bare.
- Comments and blank lines from the input are **not** preserved. (Users are told this in the editor. Revisit if it proves annoying.)

**Round-trip guarantee:** for every valid text `t`, `parse(serialize(parse(t)))` equals `parse(t)`.

### 5.8 Validation order and error shape

Validation runs in this order, collecting all errors in a stage before stopping at that stage:

1. **Syntax:** line forms, token grammar, header required fields.
2. **Structure:** bar numbering, slot ranges and ordering, grid divisibility, distinct strings per slot, length fits in bar.
3. **Semantics:** connection flag rules, metadata value ranges, fret range.

Each error:

```ts
interface ParseError {
  line: number; // 1-based line in the input text
  column?: number; // 1-based, when a token can be pinpointed
  bar?: number;
  slot?: number;
  token?: string; // the offending note or field as written
  code: string; // stable machine code, e.g. "BAR_NUMBER_GAP"
  message: string; // human sentence, also used verbatim in repair prompts
}
```

Warnings (e.g. duplicate section names) use the same shape with `severity: "warning"` and do not block saving.

---

## 6. Data model (TypeScript)

```ts
type StringNumber = 1 | 2 | 3 | 4 | 5 | 6;

interface TimeSignature {
  numerator: number;
  denominator: number;
}

interface NoteMeta {
  connection?:
    | { kind: "hammer" | "pull" | "slide" }
    | { kind: "bend"; semitones: number };
  slideIn?: boolean;
  slideOut?: boolean;
  vibrato?: boolean;
  muted?: boolean;
  strum?: "up" | "down";
  flat?: boolean; // spell as flat (Db) instead of the default sharp (C#)
}

interface Note {
  string: StringNumber;
  fret: number; // 0..24
  startTick: number; // absolute from song start
  durationTicks: number;
  offsetMs: number; // default 0
  uncertain: boolean;
  meta: NoteMeta;
  source: { line: number; column: number }; // for editor highlighting
}

interface Bar {
  number: number; // 1-based, global
  startTick: number;
  lengthTicks: number;
  slots: number; // n
  notes: Note[]; // sorted by startTick, then string
}

interface Section {
  name: string;
  bpm: number; // effective
  unit: number; // effective default slots
  bars: Bar[];
}

interface SongHeader {
  title: string;
  time: TimeSignature;
  bpm: number;
  unit: number;
  youtube?: { url: string; videoId: string; offsetSec: number };
}

interface Song {
  header: SongHeader;
  sections: Section[];
  notes: Note[]; // flat, all notes sorted by startTick then string
  totalTicks: number;
}
```

Derived helpers (in `notation`): `pitchOf(string, fret) -> midi number` using standard tuning MIDI values 64, 59, 55, 50, 45, 40 for strings 1 to 6. `letterOfNote(note) -> "C#" | "Db"` (sharps by default, flats when `note.meta.flat`; there is no user setting). `isPicked(note) -> !note.meta.connection`.

---

## 7. Tempo and clocks

### 7.1 Tempo map (`src/tempo`)

- Built from the song: a list of segments `{ startTick, startSec, bpm }`, one per section (sections with the same BPM as the previous still get a segment; harmless).
- `ticksToSec(tick)` and `secToTicks(sec)` are piecewise linear. Seconds per tick = `60 / (bpm * 960)`.
- A **speed factor** (practice BPM ÷ song header BPM, a multiplier on all section BPMs) is applied by the clock, not baked into the map. The user sets an absolute BPM; the factor is derived.
- Note offsets (`offsetMs`) are added after `ticksToSec`, and only affect expected-time comparisons and display positioning of the note marker, never the grid itself.

### 7.2 `Clock` interface (`src/clock`)

```ts
interface Clock {
  readonly kind: "grid" | "video";
  play(): Promise<void>;
  pause(): void;
  seekTick(tick: number): void;
  positionTick(): number; // current musical position, may be negative during count-in
  positionSec(): number; // song-relative seconds (0 = bar 1 slot 1)
  isPlaying(): boolean;
  setSpeed(factor: number): void; // grid: practice BPM / song BPM (UI limits BPM to 20..400); video: nearest available YouTube rate
  onStateChange(cb: (s: ClockState) => void): () => void;
}
```

### 7.3 GridClock

- Master time is `AudioContext.currentTime`.
- On `play()`, records `audioStart = ctx.currentTime + 0.1` (small scheduling headroom) and the starting song seconds. Position = start + (ctx.currentTime - audioStart) \* speed, converted via tempo map.
- Optional **count-in**: one bar of clicks before bar 1 (position runs negative during it). Toggle in transport, default on.
- Drives the metronome scheduler.

### 7.4 VideoClock

- Master time is the YouTube player's `getCurrentTime()`.
- Song seconds = video time - `offset`.
- `getCurrentTime()` updates coarsely, so the clock polls every 50 ms and **interpolates** between polls using `performance.now()` and the current playback rate. If a new poll differs from the interpolated value by more than 40 ms, it snaps to the polled value; otherwise it eases toward it over ~100 ms to avoid visible cursor jumps.
- `setSpeed` maps to `player.setPlaybackRate`, choosing the nearest value from `player.getAvailablePlaybackRates()` (typically 0.25 to 2 in 0.25 steps). The UI shows the actual rate in use.
- Buffering or pause from inside the YouTube UI updates clock state through the player's `onStateChange` event.
- Metronome clicks **default off** in video mode (the recording already has a beat, and clicks derived from a polled clock jitter). User can enable them; they are scheduled from the interpolated position with a disclaimer tooltip.

### 7.5 Metronome scheduler (`src/audio/metronome`)

- Standard lookahead pattern: a timer every 25 ms schedules all clicks falling within the next 100 ms onto `AudioContext` time.
- Click sound: short oscillator burst (~30 ms, exponential decay). Accent on beat 1 (higher pitch). Optional subdivision clicks (quieter) at the bar's grid.
- "Beat" = quarter note for 4/4, 3/4, 2/4; for x/8 signatures, clicks on each eighth with accent on beat 1 (v1 simplification; compound-meter grouping deferred).
- Volume setting, mute toggle.

---

## 8. Rendering

### 8.1 Layout model (page mode)

- Song is laid out as a sheet of **rows**. Each row holds a whole number of bars.
- **Uniform time scale within a row:** x-position is linear in ticks, so the cursor moves at constant speed within a bar of constant tempo. All bars in the song have the same pixel width at a given zoom, regardless of their slot count.
- **Zoom** = pixels per bar. Range 120 to 800, default 240. Bars per row = `floor(availableWidth / pxPerBar)`, minimum 1.
- Relayout happens only on song change, zoom change, lane toggle, or container resize (debounced 150 ms). Never per frame.
- `layout` is a pure function returning, per row: its bars (x, width), grid lines per bar (x for each slot boundary), note boxes (x, width, lane, string), and a `tickToX` mapping. Row height depends on enabled lanes.

### 8.2 Lanes

A row stacks the enabled lanes vertically, sharing the time axis. Bar lines and slot grid lines pass through all lanes.

1. **Tab lane** (default on): six horizontal lines, string 1 on top. Each note shows its fret number on its string line. Box width spans its duration (thin bar behind the number).
2. **Letter lane** (default on): letter name per note, as sharps (`C#`) unless the note has the `flat` flag (`Db`); chord slots stack letters vertically, highest string on top.
3. **Teacher notation lane** (default off): see 8.3.

Technique labels in the tab lane between connected notes: `h` (hammer), `p` (pull), `/` or `\` (slide up/down), `b<n>` for bend targets (`b2`, `r` for release to 0), `~/` prefix for `slide_in`, `\~` suffix for `slide_out`, `x` for muted, `~` after the fret number for vibrato. Strum direction shown as an arrow above the slot (`↑`/`↓`). Uncertain notes: dashed outline plus a distinct tint in every lane.

### 8.3 Teacher notation mapping (display only in v1)

The teacher writes: letter name, a register mark, and a fret-zone digit.

- **Register mark by string pair:** strings 1-2 (high E, B) = dot above the letter; strings 3-4 (G, D) = no dot; strings 5-6 (A, low E) = dot below.
- **Zone digit** written above the letter: frets 1-4 = `1`, frets 5-8 = `2`, frets 9-12 = `3`.
- **Open strings (fret 0):** zone shown as `0`. This is a placeholder convention; **the teacher's real convention for open strings is unconfirmed** (see section 15).
- **Frets 13-24:** outside the teacher's system; the lane shows the tab form `nSf` in a muted style instead.
- Rendered with CSS: letter as main glyph, dot as a positioned pseudo-element above or below, zone digit as a small superscript positioned above (above the dot when both are present).

Useful property for the v1.1 input parser: within one zone on one string pair (two strings a fourth or a major third apart), each letter maps to at most one (string, fret), so the notation is unambiguous; some letters are unreachable in a given pair and zone, which gives free validation.

### 8.4 Cursor and animation

- A single rAF loop owned by `render/PlaybackController`. Each frame:
  1. Read `clock.positionTick()`.
  2. Find the row containing that tick (binary search over row start ticks).
  3. Set the cursor element's `transform: translate(x, rowY)`.
  4. Update auto-scroll (8.5).
  5. Draw new envelope points into the active row's canvas (9.2).
- The cursor is one absolutely positioned element over the sheet, full row height.
- When position crosses into a new row, the cursor jumps to that row's start x.
- React state is updated only on discrete events (play, pause, row change for highlighting, session end), never per frame.

### 8.5 Auto-scroll

- Target: active row's top edge at **40% of the viewport height** of the scroll container.
- On row change, scroll animates to the target over 250 ms (ease-out), implemented by the rAF loop setting `scrollTop` (not `scrollIntoView`, whose smooth behavior is not controllable).
- Clamped at document top and bottom, so the first and last rows sit wherever the clamp puts them.
- **Manual scroll pauses follow:** any `wheel`, `touchmove`, `keydown` on scroll keys, or scrollbar drag (detected as a `scroll` event not caused by the controller) while playing sets `follow = false` and shows a floating **"Resume follow"** button. Clicking it re-enables follow and immediately scrolls to target. Follow re-enables automatically on stop/replay.

---

## 9. Microphone feedback

### 9.1 Capture

- `getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } })`. The defaults are tuned for voice calls and damage guitar onsets.
- Mic source feeds an `AudioWorkletNode` (`envelope-processor`). It is not connected to the speakers.
- Mic is optional. The player works fully without it.
- **Enabled by default** (`settings.micEnabled`, default true, 11.4): the practice view starts the mic automatically on the first Play press of a session (a user gesture, needed for `AudioContext.resume()` and the permission prompt), unless the user has turned it off. If permission is denied, the usual error banner shows and the mic is not retried on later plays in that session; toggling the mic in the transport updates `micEnabled`.

### 9.2 Envelope

- The worklet computes RMS for each 128-sample render quantum (~2.7 ms at 48 kHz).
- It batches points and posts them over its `MessagePort` every ~10 ms: `{ frameStart, rms[] }` where `frameStart` is the `currentFrame` of the first point, so timestamps are exact audio-clock times.
- Main thread converts audio time to song time: `songSec = audioTimeSec - calibrationLatencySec` mapped through the active clock (for GridClock, directly via `audioStart`; for VideoClock, via the relationship between `AudioContext.getOutputTimestamp()` and `performance.now()` sampled each poll).
- Each row has its own canvas, same width as the row, drawn as an **overlay behind the tab lane** (and the letter/teacher lanes too, when enabled) rather than a separate strip below them: it spans the row's whole lane-stack height and paints first, so the grid lines, lane content and notes all render on top of it and stay readable. Only the active row's canvas is drawn to live. Past rows keep their drawing until the song is stopped and restarted or the user leaves the song, so the whole take can be reviewed afterward. There is no reserved "envelope strip" height in the layout; a row's height is exactly its enabled lanes' heights.
- Drawing: a vertical bar per point, semi-transparent, mirrored/centered on the row's vertical midpoint (height = RMS mapped on a log scale, -60 dB floor to 0 dB, split evenly above and below center), at x = `tickToX(secToTicks(songSec))`. Verdict markers and their expected-time connectors (9.4, 9.5) are drawn on this same overlay, centered the same way.

### 9.3 Onset detection (in the worklet)

- Noise floor: RMS median over the first 1 second after the mic starts (user is told to stay quiet while "Listening..." shows), then updated slowly (exponential moving average of quiet frames).
- Onset fires when current RMS exceeds both `noiseFloor * 4` (about +12 dB) and `recentAverage * 1.8`, where `recentAverage` is the mean over the previous ~30 ms, and RMS is rising.
- Refractory period 50 ms: no new onset within 50 ms of the last one.
- Thresholds are constants in one config object; tuned against the WAV fixtures (12.2).
- On each onset, the worklet posts `{ type: "onset", frame }` and, ~70 ms later, the audio slice from onset+10 ms spanning 2048 samples: `{ type: "slice", onsetFrame, samples: Float32Array }` (transferred, not copied).

### 9.4 Timing verdicts (matcher, `src/audio/matcher`)

- **Expected events:** every distinct start tick that has at least one **picked** note (a note without a connection flag, or a `bend` that does not follow a note on the same string at the same fret). Their expected time = `ticksToSec(tick) + offsetMs` of the earliest-listed note at that tick. Connection-flag notes are excluded because hammer-ons, pull-offs, slides, and bends have weak or no attack.
- Each onset is matched to the nearest unmatched expected event within the **miss window** (default 150 ms). Each expected event matches at most one onset.
- Tiers by absolute error (settings, defaults): **on time** <= 30 ms, **close** <= 80 ms, otherwise **off**. Expected events with no onset within the window once the clock passes them by 150 ms are **missed**. Onsets matching nothing are **extra**.
- Each verdict is drawn as a small marker on the envelope strip at the onset position (colored by tier), with a thin connector to the expected position so early/late is visible.

### 9.5 Pitch verdicts (Worker, `src/audio/pitch.worker`)

- YIN algorithm over the 2048-sample slice. Threshold 0.15. Search range 70 Hz to 1400 Hz.
- Output: frequency and confidence. Low confidence gives verdict **unknown** (grey marker).
- Comparison uses **pitch class only** (ignore octave). YIN frequently makes octave errors on guitar, and octave is not needed to tell whether the right note was played.
- Verdict **right** / **wrong** is attached to the timing marker of the matched onset (marker gains a green or red ring).
- Slots with more than one picked note (chords): pitch check skipped, timing only.
- Onsets that matched no expected event: pitch not checked.

### 9.6 Session summary

When playback stops (end reached or user stops after at least 4 expected events):

- Counts and percentages: on time, close, off, missed, extra.
- **Tendency:** mean signed timing error of matched onsets, shown as "you tend to play X ms early/late". This is the key rushing/dragging number.
- Pitch: right / wrong / unknown counts.
- Summary is shown in a panel; not persisted in v1.

### 9.7 Calibration

Standalone screen, reachable from settings and from the "not calibrated" notice.

**Speaker (loopback) method, primary:**

1. User turns speakers on and does not play.
2. App plays 8 sharp clicks, 1 second apart, scheduled on AudioContext time.
3. Onset detector (with calibration-specific thresholds) looks for the clicks in the mic signal.
4. Latency = median of (detected onset audio time - scheduled click audio time).
5. Success requires at least 6 of 8 clicks detected, and the median absolute deviation under 10 ms. Otherwise it fails with a message and offers the fallback.
6. Result stored in settings with the method used and a timestamp.

This measures output + input latency with no human in the loop, so it does not absorb the player's own timing habits.

**Tap method, fallback (headphones):** 8 clicks, user plucks a muted string on each; median offset used. Labelled in the UI as less accurate because it includes the player's own timing bias.

If no calibration exists, feedback still runs with latency 0 and a persistent notice: "Not calibrated: your timing may look late."

---

## 10. Practice features

### 10.1 Transport bar

Play/pause, stop (returns to loop start or song start), mode toggle (grid / video, video only if the song has a link), speed control (grid: an absolute BPM field, 20 to 400, applied on Enter/blur, with the percentage of the song tempo shown as a readout; video: YouTube rate picker), count-in toggle (grid mode), metronome volume and mute, subdivision clicks toggle, mic on/off, **loop on/off toggle** with **From/To bar-number inputs** next to it, a rest-between-loops picker (10.2, shown whenever looping is on in grid mode), lanes toggle, zoom.

### 10.2 Looping

- A single **loop on/off toggle** controls whether looping happens at all. With it on and no bar range chosen, the whole song/exercise loops. With a bar range chosen, exactly that range loops.
- The bar range is chosen by the user directly, in bars, not by song section: **From/To number inputs** in the transport (clamped to 1..the last bar, From <= To), or by **clicking a bar header and shift-clicking another** (or **clicking and dragging** across bar headers) on the sheet. The chosen range is tinted on the sheet and the From/To inputs stay in sync with it either way. Songs' `[Section]` names are not a loop source.
- Loop plays the range (or whole song) repeatedly. Grid mode: the clock seeks back to the range start at the range end (count-in only on the first pass of a play). Video mode: `seekTo(rangeStartSec + offset)`; a short audible gap is expected and acceptable.
- **Rest between loops** (grid mode only): 0 (default), 1, 2 or 4 bars of rest held at the loop's end before it wraps back to the start. The underlying clock keeps running through the rest (the metronome keeps clicking), but the displayed position (cursor, and the mic matcher's timeline) holds at the loop end throughout the rest, then jumps to the start when the rest elapses -- so no expected note ages into "missed" during the rest.
- Mic feedback resets per loop pass (including passes separated by a rest); the summary aggregates across passes and also shows the last pass.

### 10.3 YouTube video mode

- Video embedded above the sheet in a resizable panel, using the IFrame Player API loaded on demand (only when a song with a video is opened).
- **Offset nudge control:** buttons for -100/-10/+10/+100 ms and a "set bar 1 here" button that sets offset to the current video time. Changes update the song header and mark the song as modified (user saves).
- Failures (invalid ID, embedding disabled by the uploader, offline): notice shown, mode falls back to grid. Embedding-disabled is common for official music uploads.

### 10.4 Tuner (added 2026-09-27)

- Reachable from the sidebar (Tuner screen) and from a Tuner popover in the practice dock (starts listening when opened, stops when closed).
- Mic (same constraints as 9.1) -> `AnalyserNode` (4096 samples) polled every 50 ms; YIN on the main thread; frames below an RMS floor or with confidence < 0.8 show "no pitch"; readings are median-smoothed over the last 5 frames.
- Target: nearest standard-tuning open string (E2 A2 D3 G3 B3 E4), or a string the user locks; when locked, octave errors are folded toward the target.
- Display: note name, string, Hz, signed cents on a -50..+50 needle; within ±3 cents shows as in tune.
- Reference A4 = 440 Hz by default, adjustable 430-450 Hz (`a4Hz` setting). No reference tones; standard tuning only.

### 10.5 Play notes (added 2026-09-27)

- Optional synthetic guitar that plays the song ("Play notes" toggle in the dock, volume in the Practice popover; `playNotes` default off, `playNotesVolume` default 0.6). Turned off for the session when entering video mode.
- Sound: Karplus-Strong plucked string rendered per pitch and cached (`src/audio/guitarSynth.ts`); muted notes use heavy damping and a short buffer.
- Plan: hammer/pull/slide and same-fret bends continue the previous voice on their string (no re-pluck; slide glides ~60 ms, bend ramps ~120 ms); fresh bends pluck then bend; vibrato is a ~5.5 Hz pitch LFO; strums spread strings ~12 ms apart (down = string 6 first); a new pluck cuts the string's previous voice.
- Scheduled with the metronome's lookahead pattern on AudioContext time from the active clock; respects speed, loops (voices silenced on wrap) and pause/stop.
- With the mic on over speakers the mic hears the synth; a status chip recommends headphones.

---

## 11. Import, storage, export

### 11.1 LLM import flow

1. **New song from notes** form: title, BPM, time signature, default grid (`unit`), optional YouTube link and offset. These are supplied by the user, not the LLM.
2. App generates the **import prompt** (11.2) with the form values filled in. Copy button.
3. User pastes the prompt plus a photo/transcription of the notes into any LLM.
4. User pastes the LLM reply into the app.
5. **Extraction:** if the reply contains a fenced block tagged `song` (` ```song `), use its contents. Else, any fenced block containing a line starting with `title:`. Else, from the first line starting with `title:` to the last line starting with `Bar `. Else: error "No song found in the reply."
6. Parse and validate. Errors listed with line, bar, slot, and token; clicking one jumps to it in the editor. **Copy repair prompt** button (11.3).
7. On a clean parse: preview (full sheet rendering with the letter lane forced on so wrong strings are easy to spot, uncertain notes highlighted) beside an editable text box. Edits re-parse live (debounced 300 ms).
8. **Save** is enabled only when there are no errors. Nothing is ever partially saved.

### 11.2 Import prompt contents

The prompt is a template in `songFormat/prompts.ts`. It contains, in order:

1. Task: transcribe the provided notes into the song format; output only one fenced block tagged `song`.
2. Header values pre-filled from the form, with the instruction to copy them exactly.
3. The format specification: sections 5.2 to 5.6 condensed, including the metadata table and connection flag rule.
4. The **string/fret to note name table** for all 6 strings, frets 0 to 12, in standard tuning (black keys listed with both spellings, e.g. `C#4/Db4`, plus the rule to add `(flat)` when the source writes a flat), with the instruction to **look up** positions in the table rather than compute them.
5. Rhythm instructions: if confident of the song's rhythm, encode it; if not, place notes on consecutive slots of the default grid with length 1 and mark **every** such note uncertain with `?`. Never invent confident-looking rhythm.
6. The worked example from 5.1, plus the tab equivalents table.
7. Reminders of the most common errors: bar numbering is global, slots strictly increase, notes must fit inside their bar, one note per string per slot.

### 11.3 Repair prompt contents

1. "Your previous output had these errors. Fix only these, keep everything else identical, and output the full corrected song in one ```song block."
2. The error list, each as `Line <n> (bar <b>, slot <s>): <message>. Token: <token>`.
3. The user's current text (including their manual edits, which the LLM must preserve).

### 11.4 IndexedDB schema

Database `taalmel`, version 1.

- Store `songs`, keyPath `id`:
  ```ts
  interface SongRecord {
    id: string; // crypto.randomUUID()
    text: string; // canonical song text, the source of truth
    title: string; // denormalized for the library list
    bpm: number;
    hasVideo: boolean;
    createdAt: string; // ISO 8601
    updatedAt: string;
  }
  ```
  Index on `updatedAt` for "recent first" listing.
- Store `settings`, single record with key `"settings"`: calibration `{ latencyMs, method: "loopback" | "tap", measuredAt }`, enabled lanes, zoom, tuner reference `a4Hz` (default 440), Play notes `playNotes`/`playNotesVolume`, default mode, metronome volume, subdivision clicks, timing tier thresholds, count-in default, **mic enabled by default (`micEnabled`, default true)**.
- On first run the app calls `navigator.storage.persist()`. If denied, a dismissible banner recommends exporting the library regularly.
- On load, every stored song is parsed lazily when opened. A song that fails to parse (e.g. after a format change) opens in the editor with its errors instead of breaking the library.
- Storage errors (quota, blocked) are shown to the user as-is. Never swallowed.

### 11.5 Export and import files

- **Library export:** `taalmel-library-YYYY-MM-DD.json`:
  ```json
  {
    "formatVersion": 1,
    "exportedAt": "2026-09-26T09:00:00Z",
    "songs": [
      { "id": "...", "text": "...", "createdAt": "...", "updatedAt": "..." }
    ],
    "settings": {}
  }
  ```
- **Single song export:** `<slugified-title>.txt` containing the canonical text.
- **Import** accepts either file type. For library files, each song whose `id` already exists prompts: replace, keep both (new id), or skip, with an "apply to all" checkbox. Settings import is opt-in via a checkbox.
- `formatVersion` exists so future versions can migrate old files rather than reject them. v1 rejects unknown future versions with a clear message.

### 11.6 Example songs (added 2026-09-27)

- Public-domain melodies shipped as plain song-format files in `src/samples/*.txt`, bundled at build time (offline): Happy Birthday, Bella Ciao (opening line and hook only, rhythms marked `?`), Ode to Joy, Twinkle Twinkle Little Star, Frere Jacques, Greensleeves, Amazing Grace.
- Shown read-only in an "Example songs" section of the Library. Opening one practises it without saving; "Add to my library" (or saving an edited example) stores an editable copy and opens it. Examples are never stored or deleted.
- A test asserts every example parses.

---

## 12. Exercises (`src/exercises`)

All generators are pure functions returning song text. The output goes through the normal parser and player; exercises get no special handling downstream. Generated exercises are not stored unless the user clicks "Save as song".

### 12.1 Generators

| Generator     | Parameters                                                                                                                                                                                                                                                | Output                                                                                                                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Chromatic** | start fret (1 to 20), strings (subset of 1-6, order low to high or high to low), finger pattern (`1234`, `1324`, `1243`, `4321`, custom 4-digit permutation), grid (4, 8, 12, 16), bars (1 to 32), direction (ascending across strings, descending, both) | For each string in order, the 4 frets `start + (finger - 1)` in pattern order, one per slot, length 1.                                                                                                    |
| **Spider**    | start fret, finger pairs (`13/24` default), grid, bars                                                                                                                                                                                                    | Alternates between string s and s+2: fingers 1 and 3 on the pair, then fingers 2 and 4, walking across the neck. Exact sequence documented in the generator's doc comment and covered by a snapshot test. |
| **Rhythm**    | string and fret (default 6S0 muted), grid or pattern (preset patterns: quarters, eighths, triplets, sixteenths, "offbeat eighths", "gallop"; or a custom slot list), bars                                                                                 | One note per selected slot.                                                                                                                                                                               |

**Strumming** (added 2026-09-27): chords (open voicings E, Em, A, Am, D, Dm, G, C; one per bar, cycling through a progression), strum pattern (down quarters, down eighths, down-up eighths, folk `D DU UDU`, offbeat ups, sixteenth down-up), bars, 4/4 only. Each strum is a chord slot whose first note carries `strum: up|down`, every note ringing until the next strum. Mic feedback checks timing only (chord slots skip pitch; direction is not detectable).

All generators take `bpm` and `time` (default 4/4) and produce a title like `Chromatic 1234, fret 5, 1/16`.

### 12.2 BPM ramp

Available for any loop (song or exercise), grid mode only: start BPM, step (+N BPM), advance condition. Condition is "after M loop passes" with mic off, or "after M consecutive passes with at least X% on time and no misses" with mic on. Optional max BPM. Current BPM shown on the transport bar. The rest-between-loops control (10.2) is the same control for a song or an exercise loop -- exercises are practiced through the same transport/loop machinery, with no special-cased looping.

---

## 13. Error handling summary

| Situation                                     | Behavior                                                                                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Mic permission denied / no device             | Player works; feedback strip hidden; banner explains how to enable.                                                           |
| No calibration                                | Feedback runs at 0 ms latency with a persistent "not calibrated" notice linking to calibration.                               |
| Loopback calibration hears no clicks          | Explains the likely cause (headphones or muted speakers) and offers the tap method.                                           |
| `AudioContext` suspended (autoplay policy)    | First user gesture (play press, mic enable) calls `resume()`. Explicitly handled, since it is the most common "no sound" bug. |
| YouTube load failure or embedding disabled    | Notice; mode falls back to grid; song remains fully usable.                                                                   |
| Parse errors on import                        | Listed with positions; repair prompt available; save disabled.                                                                |
| Stored song fails to parse                    | Opens in the editor with errors; rest of library unaffected.                                                                  |
| Persistent storage denied                     | Export reminder banner.                                                                                                       |
| IndexedDB quota or other error                | Shown verbatim; operation not silently retried or dropped.                                                                    |
| Import file of unknown future `formatVersion` | Rejected with a clear message.                                                                                                |

---

## 14. Testing

### 14.1 Unit tests (Vitest, no browser)

- `songFormat`: parser (every rule in section 5, one test per error code), serializer, extractor, prompt builders (snapshot).
- **Round-trip property** over all valid fixtures: `parse(serialize(parse(t)))` deep-equals `parse(t)`.
- `notation`: pitch/letter math for every string at frets 0, 1, 5, 12, 24; teacher-notation mapping for each pair and zone boundary (frets 0, 1, 4, 5, 8, 9, 12, 13).
- `tempo`: ticks/seconds conversion across section BPM changes, including exact boundaries.
- `layout`: bars per row at several widths/zooms, tickToX linearity, row boundaries.
- `matcher`: synthetic onset lists against expected events covering on time, close, off, missed, extra, connection-flag exclusion, chord slots.
- `exercises`: snapshot of each generator's output for fixed parameters; every output parses cleanly.

### 14.2 Fixtures

- `fixtures/songs/valid/*.txt`: representative songs (chords, triplet bars, all metadata keys, multiple sections with BPM changes, video header).
- `fixtures/songs/invalid/*.txt`: each paired with `*.expected.json` listing expected error codes and lines. This folder doubles as format documentation.
- `fixtures/audio/*.wav`: recorded guitar plucks (single notes at known times, legato runs, strummed chords, quiet room noise) with sidecar JSON of true onset times and pitches. Onset detection and YIN run against these offline in Node (worklet logic is factored into a plain function the worklet calls, so it is testable outside the browser).

### 14.3 Manual checklist

Real-device latency calibration (speakers, headphones), video sync drift over a full song, auto-scroll feel and manual-scroll pause, cursor smoothness at max zoom, AudioContext resume behavior on first load, behavior with mic unplugged mid-session.

---

## 15. Open questions

1. **Teacher's open-string convention.** v1 displays fret 0 as zone `0`. Confirm with the actual notation and update 8.3 (and the v1.1 input parser) accordingly.

---

## 16. Deferred (not in v1)

Grouped roughly by likely order.

**v1.1**

- **Teacher-notation input:** the import parser accepts the teacher's notation (letter + `'` for dot above, nothing for no dot, `,` for dot below + zone digit, e.g. `A'2`, `C,1`), and the app, not the LLM, converts to `<string>S<fret>` using the unambiguity property in 8.3. Stored text stays canonical `nSf`. Rationale: LLMs are good at literal transcription and bad at fretboard math.

**Timing input methods** (alternatives to LLM-guessed rhythm)

- **Tap-to-time:** play the reference audio, tap a key per note, taps paired with the note sequence and quantized to the chosen grid.
- **Grid editor:** FL piano-roll style drag-and-snap editing of note positions and lengths.
- **Automatic rhythm detection** from the recording (onset detection on the full mix). Research-grade; low priority.

**Display and practice**

- **Scrolling-strip mode** (fixed playhead, notes flow toward it) and a **toggle** between it and page mode.
- Drawn arcs for hammer/pull/slide and curves for bends (v1 uses text labels).
- Saving takes (envelope and verdicts) and practice history.
- Strumming exercises (model supports `strum` already; needs a generator and accepts that mic cannot verify direction).
- Folding calibration into exercise count-ins (automatic, continuous calibration), to revisit after v1 calibration is in use.
- Felt-beat BPM and metronome grouping for compound meters (6/8, 9/8, 12/8 counted and clicked in dotted quarters).

**Format and model**

- Ties across bar lines.
- Time signature changes mid-song.
- **Tempo maps for drifting recordings** (a list of bar-to-video-time anchors) so video mode stays aligned with live or rubato performances.
- `prebend`, harmonics, and other techniques.
- Alternate tunings and capo.
- Pitch-only input formats (plain letter names, scientific pitch) with a **position resolver** (prefer zone, minimize hand movement, or ask).
- Staff notation input and display.

**Scope expansion**

- Other instruments, starting with drums (different notation, hit classification instead of pitch, different display).
- Mobile support.

---

## 17. Suggested build order (input for the implementation plan)

1. Project scaffold (Vite, React, TS strict, Vitest), `model` types.
2. `notation`, `songFormat` (parser, validator, serializer, extractor) with fixtures and round-trip tests.
3. `tempo`, `layout` with tests.
4. `storage` (songs, settings, export/import).
5. Sheet rendering (tab and letter lanes, then teacher lane), GridClock, metronome, cursor, auto-scroll. At this point songs are playable.
6. Import flow UI with prompt and repair prompt.
7. Mic: worklet envelope and onsets, envelope canvases, calibration, matcher, summary.
8. Pitch worker and pitch verdicts.
9. VideoClock and video mode, offset nudge.
10. Looping, BPM ramp, exercise generators.
