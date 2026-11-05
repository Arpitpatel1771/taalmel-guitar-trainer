# Taalmel: Capo Support and Note Names with Octaves (design spec)

Status: draft for review, 2026-11-05. First in the build order (see `IDEAS.md`).
Changes the song format (`specs/26-9-claude.md` §5) and the lanes (§8.2–8.3).

---

## 1. Song format

### 1.1 Header

New optional header field:

| Key | Required | Value | Meaning |
| --- | --- | --- | --- |
| `capo` | no | int 0–12 | Capo fret for the whole song. Absent = 0 (no capo). |

### 1.2 Sections

`capo` joins `bpm` and `unit` as a section field, written right after the section start and before its first bar. It overrides the song value for that section only and does not carry over (same rule as `bpm`/`unit`). `capo: 0` means "no capo in this section" when the song has one.

```
title: Example
time: 4/4
bpm: 90
unit: 8
capo: 2

[Verse]
Bar 1: {1} 3S0 {3} 2S1 ...

[Solo]
capo: 0
Bar 5: {1} 1S12 ...
```

### 1.3 Frets are relative to the capo

As in printed tabs: a fret number counts from the capo, so `0` is the capo fret. Sounding pitch = open string + capo + fret.

Validation (new error codes in `src/songFormat/errorCodes.ts`, fixtures in `fixtures/songs/invalid/`):

- `INVALID_CAPO`: not an integer 0–12 (header or section).
- `FRET_EXCEEDS_WITH_CAPO`: capo + fret > 24.
- A duplicate `capo` in the header or in one section is the existing duplicate-key error.

Canonical serialization: `capo` after `unit` in the header; after `unit` in a section's fields. A song with no capo anywhere serializes exactly as today (existing files and fixtures are unchanged).

### 1.4 Model

The parser resolves the capo per bar: `Bar.capo: number` (song value or the section override). Consumers never look up sections themselves.

---

## 2. One pitch function

Today the open-string tuning is defined in three places: `src/notation` (`TUNING_MIDI`, `pitchOf`), `src/audio/pitchClass.ts` (`TUNING_MIDI`, `midiOf`) and `src/audio/guitarSynth.ts` (`OPEN_STRING_MIDI`). Replace them with one:

```ts
// src/notation
export function soundingMidi(string: StringNumber, fret: number, capo: number): number
```

Every caller passes the bar's capo:

- **Matcher** (`src/audio/matcher.ts`): expected pitch for the pitch verdict (including the octave check from `5-11-ui-redesign.md` §6.2).
- **Synth playback** (Play notes) and **chord player**.
- **Letter lane** (§4).
- **Import prompt** (`src/songFormat/prompts.ts`): the format description gains the `capo` field and the rule "frets are relative to the capo; write the tab's numbers unchanged".
- **Tab reader** (`5-11-song-import.md` §3.1): a "capo N" line in a tab sets the song's capo instead of producing a warning.

Things without capo stay as they are: exercises, chord library, tuner.

---

## 3. Display

- **Practice header:** "Capo 2" next to the meta line when the song has a capo.
- **Sheet:** at the first bar of the song and at every section whose capo differs from the previous section's, a small badge above the bar: "Capo 2" or "No capo".
- **Warning before a change:** when the cursor enters the bar before a capo change, a chip appears above the sheet near the cursor: "Next section: capo → 0", in `--warn` with the text label. It stays until the change is reached. **Playback does not pause.** The same warning appears when a loop wraps from a section with one capo to one with another.
- **Section chips** in the header show a capo badge when that section's capo differs from the song's.
- **Editor:** the syntax reference and autocompletion learn `capo` (header and section).

---

## 4. Lanes: note names with octaves; the teacher lane goes

### 4.1 Letter lane

- Shows the **sounding** note **with its octave** (scientific pitch notation, middle C = C4): `E4`, `C#5`, `Db5` when the note has the `flat` flag. Sharps by default, as today. It uses the existing `noteNameWithOctave` with `soundingMidi`.
- Chord slots stack the names vertically, highest string on top (as today).
- Layout: the longer labels (up to 3 characters) may need a wider minimum slot width in `src/layout/constants.ts`. Check at the default zoom that names don't overlap.

### 4.2 Remove the teacher notation lane

- Delete the lane: `LaneId` becomes `"tab" | "letter"`; remove its layout, rendering and CSS (`src/layout`, `src/render/Sheet.tsx`, `src/ui/styles.css`), and its toggles in Settings and the transport.
- Settings migration: drop `lanes.teacher` from stored settings (and from synced settings) without error.
- `specs/26-9-claude.md` §8.2 item 3 and §8.3 get a "Removed 2026-11-05, see specs/5-11-capo.md" note, and the open question about the teacher's open-string convention (§15) is closed.

---

## 5. Tests

- Parser: valid fixtures for a song-level capo, a section override, `capo: 0` override; invalid fixtures for both new error codes. Serialize round trip; a song with no capo is byte-identical to today's output.
- `soundingMidi` with capo 0 and 3 across strings; the old helpers are gone (no duplicate tuning tables).
- Matcher: the same played pitch is `right` with the right capo and `wrong` without.
- Synth: voices for a capo-2 bar sound two semitones up.
- Letter lane: `E4`, `C#5`, the flat spelling, the sounding note under a capo.
- Settings migration removes `lanes.teacher`.
- Browser check (muted headless Chrome): capo badge, the change warning appearing one bar early, playback continuing.
