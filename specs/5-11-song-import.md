# Taalmel: Song Import (design spec)

Status: draft for review, 2026-11-05. **§2–§5 superseded by `5-11-piano-roll.md`** (the tab reader §3.1 and the spacing guess §3.2 stay).
Problem: getting a song into Taalmel means copying a prompt to an AI and pasting text back, and the rhythm comes out wrong. The app has no backend and runs no AI, so everything here runs in the browser.

---

## 1. Why rhythm is hard

Most tabs (plain-text tabs on tab sites) contain **only pitches in order**: string, fret, technique. The rhythm isn't written anywhere; it lives in the recording. An AI translating such a tab is guessing the rhythm. So the rhythm can only come from:

1. a file that contains it (Guitar Pro, MusicXML, MIDI): later, see `IDEAS.md`;
2. sheet music in standard notation: no reliable in-browser reader, so this goes through option 1 or the AI fallback;
3. **the recording plus the player's ear**: this spec.

Target user: a beginner with a YouTube video and a tab from a tab site (e.g. the Karz theme). Beginners can't transcribe a fast solo by ear, and the **shared library** (`5-11-shared-library.md`) is the main way they get songs. This tool is for whoever does the transcribing, made as forgiving as possible.

---

## 2. "Add a song" flow

One screen asks *what you have*:

| Choice | Path |
| --- | --- |
| **I have a tab** (pasted text) | Tab reader (§3), then rhythm (§4), then editor (§5) |
| **I'll enter the notes myself** (e.g. tab shown in a YouTube video) | Fretboard entry (§3.4), then rhythm, then editor |
| **I have Taalmel song text** | Existing paste + validate flow |
| **Use an AI chat** | Existing copy-prompt / paste-answer flow, kept as an optional fallback. Runs in the user's own AI chat, never in the app. |
| **Find it in the shared library** | Link to the library (once it ships) |

Common setup step (before rhythm): title, artist (optional), time signature, YouTube URL (optional but needed for tapping along to a video), BPM (typed, or found by tap tempo in §4.1).

---

## 3. Notes

### 3.1 Tab reader (`src/importTab`, pure functions, no DOM)

Input: pasted plain-text tab. Output: an ordered list of **note events** `{ column, bar?, notes: [{string, fret, technique?}] }` plus warnings.

Must handle:

- **Blocks** of 6 string lines. Labels optional and in any common style: `e|`, `E|`, `e:`, `1|`, `e ` or none. Low-to-high order is inferred from labels when present (`e B G D A E`), else top line = string 1.
- **Fillers and bars:** `-` as space, `|` as bar line (kept as `bar` boundaries when present), multi-digit frets (`12`, `15`), notes in the same column on several strings = one event (a chord).
- **Techniques:** `h` → `hammer`, `p` → `pull`, `/` and `\` → `slide`, `b` with optional target (`7b9`) → `bend: <semitones>`, `r` → release (`bend: 0`), `~` → `vibrato`, `x` → `muted`, `PM` lines → `muted` for the covered notes. Mapped to the song format's metadata (`specs/26-9-claude.md` §5.6).
- **Noise between blocks:** lyrics, chord names, section headings (kept as section-name suggestions), "x2"/"repeat" notes (warning: "Repeats aren't expanded; copy the bars if needed").
- **Capo:** a "capo N" line sets the song's `capo` (see `5-11-capo.md`); fret numbers are kept as written, relative to the capo.
- **Tuning:** a non-standard tuning header (e.g. `D A D G B E`, "Drop D") gives a clear warning. Only standard tuning is supported for now.
- **Errors** point at the line and column ("Line 14: string lines have different lengths").

Before building: collect 3–5 real tabs (starting with the Karz theme tab the owner uses) as fixtures, and design the reader around them.

### 3.2 Rhythm guess from spacing

Many tabs space notes roughly by timing. Inside each bar (or each block when there are no bar lines), the column positions are scaled to the bar's length and snapped to the grid (song `unit`, default 8 per bar). It is only a starting point. (The `?` uncertain marker was removed in 2026-11: the parser still accepts it and ignores it.)

### 3.3 Preview

After reading: a read-only sheet of the result, the warnings list, and "Play notes" (existing synth) so the user can hear the guess.

### 3.4 Fretboard entry

For notes with no pasteable tab: an on-screen fretboard (reuse `FullNeck`). Click a string and fret to add a note; Shift+click adds to the same event (a chord). Keyboard: type `2 5` Enter = string 2, fret 5. Backspace removes the last note. Output: the same note-event list as the tab reader, with no spacing guess.

---

## 4. Rhythm: tap-to-rhythm

Runs against the YouTube video (existing `VideoClock` / YouTube player) or, without a video, against the metronome.

### 4.1 Find the beat

"Tap along to the beat" for 8 or more taps (Space or a big on-screen button) at the start of the song. This gives **BPM** (median interval) and the **offset**: the first beat tap is the downbeat of bar 1, which sets the song's video offset. The user can nudge either and hear the metronome over the video to confirm.

### 4.2 Tap bar by bar

- The screen shows one bar at a time (or 2, user's choice) with its notes in order, and loops that bar of the video at a chosen speed: **0.25×, 0.5×, 0.75×, 1×** (YouTube's playback rates). The default for fast passages is 0.5×.
- A one-bar count-in click, then the user taps once per note event (a chord is one tap). Taps are converted to song time (divided by the playback rate, minus the offset), then snapped to the bar's grid.
- Fewer taps than notes: the rest keep their guessed timing. More taps: extras are ignored, with a note.
- After tapping, the bar plays back (synth notes over the video at the same speed). **Keep** accepts those notes and moves on; **Redo** taps the bar again; **Skip** leaves it as is.
- A progress strip shows which bars are done or untouched. Any bar can be revisited.

### 4.3 Grid choice

Default grid per bar = song `unit`. A "finer grid" toggle (×2) lets taps snap to sixteenths when the passage needs it; the bar is then written with an explicit slot count `(<n>)`.

---

## 5. Visual rhythm editor

A sheet-based editor so nobody has to edit the text format to fix timing. It works on any song, not only imports.

- Click a note to select it (Shift for more). Drag horizontally to move it to another slot; drag its right edge to change length. Arrow keys move by one slot, Shift+arrows change length.
- Delete removes; double-click an empty slot to add a note (string and fret typed or picked on the fretboard).
- Every change goes through the existing parser/serializer (`src/songFormat`), so the text and the sheet can't disagree. Undo/redo.
- Play from the selection, looping the current bar, to check against the video.

---

## 6. Data and format

No format change: notes, lengths, offsets, the `?` marker and the video header already exist. Import state that's still in progress (bars done, chosen speed) is kept in a draft record in IndexedDB until the song is saved.

---

## 7. Tests

- Tab reader: fixtures for each label style, multi-digit frets, chords, every technique, noise lines, capo line, non-standard tuning warning, malformed blocks. Golden output per fixture (like `fixtures/songs`).
- Spacing guess: known spacing → expected slots.
- Tap conversion: taps at 0.5× and 1× with an offset map to the same slots; tap tempo BPM from jittered taps.
- Editor operations: move, resize, add, delete round-trip through serialize/parse.
- Browser check with a sample song and a real YouTube video (muted headless Chrome).

---

## 8. Later (not in this spec)

- Guitar Pro / MusicXML / MIDI file import (exact rhythm, e.g. via alphaTab in the browser).
- "Let the app listen": align the known notes to the video's audio (Chrome tab-audio capture plus onset and pitch matching) and suggest the rhythm. Prototype first.
- Play-to-transcribe: play the part into the mic; detected onsets set the rhythm.
- Audio-to-notes model (e.g. Basic Pitch in the browser).
