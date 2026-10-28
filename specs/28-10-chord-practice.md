# Chord practice modes (chords sub-projects 2–4)

Status: the user approved building these end to end without review stops (2026-10-28). The design decisions below were made by Claude, based on the user's earlier choices (all of: one-minute changes, strum-along progressions, string-by-string mic check, name-that-chord quiz, progress tracking). Builds on `specs/28-10-chord-library.md`.

## Shared

- **Where:** the Chords screen gets a third tab, **Practice**, next to Library and My chords. Practice has a mode switcher: **Changes · Quiz · Progressions · Mic check**. The last mode used is remembered in `localStorage` (a per-device convenience).
- **Choosing chords:** each mode picks chords through one shared `ChordPicker` (root split buttons + type select, reusing the library's names) plus quick-pick chips for **My chords** (Learning first). A picked chord is `{ rootPc, typeId, spelling }` or a slash name. It uses the first voicing from `listVoicings` (open shapes come first) unless the user selects another in the mode.
- **Diagrams:** follow `settings.chordView` and `settings.leftHanded`.
- **Stats:** saved in a new `Settings.chordStats` field, so they sync to Drive with the other settings:

```ts
chordStats: {
  changes: Record<string /* "keyA|keyB", keys sorted */, { best: number; history: { at: string; count: number; seconds: number }[] /* last 20 */ }>;
  quiz: Record<string /* chordKey */, { seen: number; correct: number }>;
}
```

  Default `{ changes: {}, quiz: {} }`. Older settings merge in the default.

## 1. One-minute changes

- **Pairs:** pick chord A and chord B. Suggested pairs are one click away: A–D, D–E, A–E, G–C, C–G7, Am–E, D–Am, G–D, C–F, Em–D, Am–Dm, E–Am.
- **Options:** duration **30 / 60 / 120 s** (default 60), and an optional metronome click (`FreeMetronome`, BPM stepper, default 60, off by default).
- **Flow:**
  1. **Start** runs a 3-2-1 countdown, then the timer.
  2. Both diagrams are shown. The one you should be playing *now* is highlighted.
  3. Each time you switch, press the big **Change** button or **Space**. The count goes up and the highlight swaps.
  4. **Stop** ends the run early without saving.
- **Why counting is manual:** detecting a full chord change by mic isn't reliable, so you count your own changes.
- **End of a run:** shows the count, a "changes per minute" figure, and how it compares with your best for this pair ("New best!"). It's saved to `chordStats.changes`. A small bar chart of the last 10 runs for the pair is shown.
- **Pure logic, with tests:** pair key, per-minute normalisation, history trimming, and best-score updates.

## 2. Name-that-chord quiz

- **Kinds:**
  - **Name it:** show a diagram, then pick the name from 4 options.
  - **Find it:** show a name, then pick the right diagram from 4.
- **Pool:**
  - **My chords** (falls back to Open chords when empty)
  - **Open chords** (the open shapes)
  - **Everything** (all roots × types, first voicing)
- **Round:** 10 questions.
- **Distractors:** must be plausible. Prefer the same root with another type, the same type with a nearby root, and chords whose shapes look alike. Never the correct answer twice, and no enharmonic duplicates of it.
- **Answering:** the result shows straight away (correct in green, your wrong pick in red, and the right answer). A **Play** button hears the chord. **Next** moves on (Enter works too).
- **End of a round:** score /10, then the chords you missed, each with **Mark as learning**. Per-chord `seen`/`correct` are saved to `chordStats.quiz`.
- **Pure logic, with tests:** question generation with a seeded RNG (pool, distractor rules, no duplicates, 4 unique options, correct included) and stat updates.

## 3. Strum-along progressions

- **Presets** (Roman numerals):
  - I–IV–V
  - I–V–vi–IV
  - vi–IV–I–V
  - I–vi–IV–V
  - ii–V–I
  - 12-bar blues (I7 ×4, IV7 ×2, I7 ×2, V7, IV7, I7, V7)
  - Andalusian i–bVII–bVI–V (minor)
  - I–bVII–IV
- **Key:** root picker + major/minor. Numerals resolve to chords in that key, spelled by the key: the root letter by scale degree, with flat keys spelled flat.
- **Custom:** type chord names ("G C D Em", "Am F C G") parsed with `parseChordName`. Invalid tokens are reported inline.
- **Options:**
  - bars per chord: 1 or 2 (blues is fixed per bar)
  - BPM (default 80)
  - strum pattern from `STRUM_PATTERNS` (`src/exercises/strumming.ts`)
  - synth strums on/off (default on)
  - metronome click on/off (default on)
  - loop (default on)
  - count-in of one bar
- **Playback:** sample-accurate on the AudioContext.
  - The click comes from `FreeMetronome` (4/4).
  - Strums are scheduled at the pattern's slot times through a new scheduled chord function in `src/audio/chordPlayer.ts`: `scheduleChord(frets, { when, direction: "down" | "up", volume, a4Hz })`. A down strum plays low→high, an up strum high→low, with 12 ms spacing.
- **Display:**
  - a big current-chord diagram with its name
  - a smaller "next" diagram
  - a beat/bar progress strip
  - the whole progression as a row of chips with the current one highlighted
- **Pure logic, with tests:** Roman-numeral resolution (I–V–vi–IV in G = G D Em C, in Bb = Bb F Gm Eb, Andalusian in A minor = Am G F E), the custom parse, and the timeline builder: for each bar, which chord and the strum times/directions from the pattern.

## 4. String-by-string mic check

- **Starting:** from the Practice tab (pick a chord), or a **Check with mic** button in the Library chord header that opens Practice → Mic check with that chord and voicing.
- **Flow:**
  1. The mic starts through `TunerInput` (as the Tuner does, respecting `settings.a4Hz`).
  2. Sounding strings are checked low → high. Muted (X) strings are shown as "don't play" and skipped.
  3. The current string is highlighted on the diagram, with "Pick string 5 (C3)".
- **Judging a string** (expected = that string's MIDI note):
  - **✓** when the pitch is within ±40 cents for at least 150 ms (3 consecutive readings), then it moves on.
  - **Wrong note:** a stable reading of a different note for 400 ms shows "Heard D3, expected C3: check your finger on fret 3". You can retry, and it moves on once the string is right.
  - **Muted or buzzing:** no stable pitch for 4 s shows "Nothing clear: muted, or buzzing against a finger?", with **Skip** and **Retry**.
- **End:** a summary per string (✓ / wrong / skipped), plus **Again** and **Next chord** (the next in My chords, if any).
- **Pure logic, with tests:** expected notes per string from a voicing, and a state machine fed (freq | null, timestamp) samples that produces string results with the thresholds above.

## Testing

- **Unit tests** for every pure piece listed above.
- **Headless Chrome:**
  - **Changes:** a 30 s run with simulated Space presses, a stats entry after a reload.
  - **Quiz:** a full round answering via clicks, score shown.
  - **Progressions:** play I–V–vi–IV in G, check that the current chord advances with the bars.
  - **Mic check:** use Chrome's fake audio device where possible. Otherwise drive the state machine through a dev-only hook.

## Drive follow-ups (from `specs/28-10-drive-sync.md` review)

- **Greyed clips:** a clip with no media and no `driveFileId` (on another device, never uploaded) is shown greyed, with Play/Trim disabled.
- **Download progress:** `downloadClipMedia(id, onProgress?)` streams the response body and reports a 0..1 fraction. The Recorder shows "Downloading N%".
