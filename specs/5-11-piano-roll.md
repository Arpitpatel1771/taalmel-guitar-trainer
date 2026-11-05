# Taalmel: Song Editor (piano roll) — design spec

Status: approved for build, 2026-11-05. Mockup: the "Song editor" row on the Taalmel Hub Concepts canvas.
Replaces `5-11-song-import.md` §2–§5 (setup step, check step, find-the-beat, tap-to-rhythm, fretboard entry, visual rhythm editor). The tab reader (§3.1) and the rhythm guess from spacing (§3.2) stay and feed this editor.

Why: the six-step import with bar-by-bar tapping was too hard to understand, even for the owner. A piano roll lets the user **see and fix** the rhythm instead of performing it perfectly in real time.

---

## 1. One editor for every song

- **Add a song** (one screen, §7) → the editor. A pasted tab opens with its notes already in the roll (timing guessed from the tab's spacing). "Start from scratch" opens an empty roll.
- **Existing songs:** `Edit` on the song screen opens the same editor. The text editor (CodeMirror) stays as "Edit text".
- The editor edits a `Song` (the normal model). Saving serializes with `serialize()`; the parse round-trip rule still holds.

## 2. Layout (laptop first)

Top to bottom, as in the mockup:

1. **Header:** back to Songs, title + artist (editable inline), tempo/time summary, draft status, Undo, Redo, **Save song**.
2. **Listen row:** the YouTube video (16:9, ~340 px wide) and the transport card: Play/Pause, Loop (the loop range is set by dragging in the ruler; default the selected bars), speed 0.25/0.5/0.75/1×, Metronome, Follow (auto-scroll), **balance slider** Video ↔ Your notes, **Pitch hints** toggle + brightness, a status pill while hints are recording.
3. **Tool row:** Select / Draw, Snap (1/4, 1/8, 1/16, 1/8T, 1/16T, Off = 1/64), View (Pitch / Strings), zoom −/+, Duplicate bar, Live record.
4. **The roll** (left, wide) with the **inspector** (right, ~300 px).
5. **Tab view** (collapsible, under the roll): the current song as plain tab, updated live, chords in one column.

Without a video the listen row shows the metronome-only transport and a field to paste a YouTube link.

## 3. The roll

### 3.1 Axes and views

- **Time** runs left to right in song ticks. The ruler shows bar numbers, section chips (name, capo, bpm when overridden), the loop range, note-start ticks from hints (§5), the playhead and the **◆ Bar 1 flag** (§6.2).
- **Pitch view (default):** one row per semitone, **sounding pitch** (capo included, via `soundingMidi`), E2 to E6 (MIDI 40–88) plus capo. Left keyboard column with note names (`E4`, octave numbers as in the letter lane); C rows emphasised, black-key rows shaded. Each note block shows its fret and string (`7 e`).
- **Strings view:** six lanes (e on top), blocks show the fret. Vertical drag moves a note to another string at the **same pitch** (fret recalculated); refused if the fret would be outside 0..24−capo.
- Zoom: horizontal 8–40 px per 1/16, vertical row height 12–22 px. Ctrl+wheel zooms, wheel scrolls, Shift+wheel scrolls sideways.

### 3.2 Notes

- Block = one `Note`: left edge = start, width = length, row = pitch (or lane = string).
- The "uncertain / guessed note" flag was removed (2026-11): guessed timing is no longer marked anywhere.
- Selected notes get a ring. Hovering shows pitch, string/fret and start position.
- A note may ring past its bar line as one note with its full length (no ties, no splitting): a resize can run over any number of bars, a move keeps the length, and bars are added so the song holds every note to its end. The sheet draws the note box clipped at its own bar end; the fret number shows once, at the start.

### 3.3 Editing

| Action | Mouse | Keys |
| --- | --- | --- |
| Select | click; Shift+click adds; drag on empty space = box select | Ctrl+A |
| Move in time | drag horizontally (snapped; Alt = no snap) | ← → by one snap step |
| Change pitch | drag vertically (Pitch view) | ↑ ↓ semitone, Shift+↑ ↓ octave |
| Change string | drag vertically (Strings view), or inspector | — |
| Change length | drag the right edge (snapped; Alt = no snap) | Shift+← → |
| Add a note | Draw tool: click (or click-drag to set the length) | D = Draw, V = Select |
| Delete | — | Delete / Backspace |
| Copy / paste | — | Ctrl+C / Ctrl+V (pastes at the playhead) |
| Duplicate | toolbar "Duplicate bar" (selected bars into the next bars) | Ctrl+D |
| Undo / redo | header buttons | Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y) |
| Play / pause | transport | Space |

- Every note you click, draw or drag to a new pitch plays a short preview through the synth.
- A new note gets the length of the last note drawn or selected (default 1/8).
- Multi-selection moves, transposes and resizes together.
- Keyboard handling is ignored while focus is in a text field.
- Undo history: the last 200 edits, kept per editor session.

### 3.4 Strings and chords (the "notes at the same time" rule)

The format allows one note per string per start time. The editor enforces it:

- **String choice for a new or moved pitch:** keep the note's current string when the fret is playable (0..24−capo) and the string is free at that start; otherwise the nearest playable free string. A new note with no context prefers the string that gives the lowest fret ≥ 0 near the previous note's position.
- Notes that start together always end up on different strings; the tab view shows them in one column.
- If no free string can play the pitch at that moment, the note is drawn red with "No free string for this note" and **Save** is disabled until it's fixed.
- Ringing overlap (a held note under a later one on another string) is fine. A later note on the same string cuts the earlier one off, as the format says.

### 3.5 Inspector

With one note selected:

- Big pitch name, string · fret, **Hear** button.
- **Pitch:** − / + semitone, − / + octave.
- **Play it on:** every playable string/fret for that pitch as buttons; taken strings disabled.
- **Starts:** "Bar 3, beat 2 + 1/16" with ← → nudges, and the ms nudge (`offsetMs`, −500..500) under "Fine timing".
- **Length:** 1/16, 1/8, 1/4, 1/2, 1 (whole), dotted toggle; **Ring until next** (stretch to the next note's start, capped at the bar end), **Cut short** (half the length, minimum 1/32).
- **Into this note:** None / Hammer-on / Pull-off / Slide / Bend (with semitones 0.5–4, 0 = release). Validation follows the format (pull needs a lower fret than the previous note on the string, slide a different fret); an invalid choice is disabled with the reason as a tooltip.
- **On this note:** Vibrato, Muted, Slide in, Slide out.
- **Spell as flat** on black-key notes.
- Delete.

With several notes: common length, techniques that apply to all, transpose, delete.

With nothing selected, the **Song** panel: title, artist, tempo (with optional tap tempo), time signature, capo, YouTube link, bar 1 position (§6.2), sections (add at a bar, rename, per-section bpm/capo, remove), add/remove bars at the end, and a short keys list.

### 3.6 Bars and sections

- Drawing past the last bar adds bars. Trailing empty bars are dropped on save.
- Per-bar slot counts are chosen on save (§8); the user never sees "slots".

### 3.7 Tab view

Plain tab of the visible song (or the loop range), six lines, bar lines, chords in one column, techniques as `h p / \ b ~ x`. Click a fret number to select that note. Read-only.

## 4. Listening

- Uses the existing engine pieces (`useDraftPlayer`/`DraftPlayer`, `VideoClock`, `GuitarPlayer`, `Metronome`). Edits rebuild the player's song without stopping playback where possible.
- **Balance:** one slider; the video's volume (YouTube `setVolume`) and the synth gain move in opposite directions. Ends = only the video / only your notes.
- **Loop:** drag in the ruler to set the range (snaps to beats; double-click a bar number loops that bar). Loop on/off button.
- **Speed:** 0.25–1× applies to the video and the synth together.
- **Follow:** the roll scrolls to keep the playhead in view.
- **Live record (optional):** while playing, press **N** each time you hear the next note. In a roll with notes, the next note after the playhead (in order) moves to the tap time (snapped). In an empty part, N adds a new note at the playhead with the pitch of the strongest hint at that moment (§5), else the last pitch. Everything placed this way can be dragged afterwards.

## 5. Pitch hints from the video

### 5.1 Getting the audio

The page can't read the embedded YouTube player's audio. Chrome/Edge can capture the tab's own audio:

- "Pitch hints" → explainer sheet → `getDisplayMedia({ video: true, audio: true, preferCurrentTab: true, selfBrowserSurface: "include", systemAudio: "exclude" })`. The user picks this tab with "Share tab audio" on. The video track is stopped at once; only audio is used.
- No support (Safari, Firefox, phone) or permission refused → hints are off and a one-line note explains why; everything else works.
- The capture also hears Taalmel's own synth and metronome. Hints are **recorded only while Taalmel's own sounds are silent** (the balance slider at "only the video", or synth and metronome off); the status pill shows "Hints paused: your notes are playing". A "Listen to the video only" button sets that up.
- Capture ends when the editor closes or the user turns hints off.

### 5.2 Analysis (`src/audio/hints`, pure parts unit-tested)

- Per-semitone energy for MIDI 40–88 (+capo not needed: hints are sounding pitch) using a constant-Q-style filter bank (window length per pitch, enough cycles to separate neighbouring semitones), about 50 frames per second, run off the main thread (AudioWorklet feeding a Worker, or a Worker over AnalyserNode frames).
- Per frame: log-compress, subtract the frame median (whitening), keep 0..255.
- **Strongest pitch:** the top semitone per frame when it stands clearly above the rest (threshold), with harmonics folded (a bin an octave or a fifth above a strong bin is reduced) to cut octave errors.
- **Note starts:** spectral-flux peaks with a minimum gap of ~60 ms.
- Frames are stamped with **video time** (from the YouTube player clock), so changing the tempo or bar 1 later doesn't invalidate them, and slowed playback (pitch preserved by YouTube) fills the same frames more densely.

### 5.3 Storage

- Local only (not synced): an IndexedDB store keyed by YouTube video id, holding frames per 20 ms of video time (49 bytes each) plus onset times. Recording a part again replaces those frames. A 5-minute video is under 1 MB.
- Any song using the same video reuses the hints.

### 5.4 Drawing

- Pitch view only: a heat-map behind the rows (brightness = energy × the brightness slider), small dots for the strongest pitch, ticks under the ruler for note starts.
- Video time maps to song time through the song's tempo map and bar-1 offset; parts of the song with no recorded frames are hatched with "Play this part to see hints".
- Strings view shows a hint to switch to the Pitch view.
- It's a guide, not a transcription: the UI never places notes from hints except through Live record's explicit N press.

## 6. Tempo and bar 1

### 6.1 Tempo

Tempo, time signature and per-section bpm live in the Song panel. Tap tempo (existing `tapTempo`) is an optional helper there. Changing the tempo keeps notes on their beats (positions are in ticks).

### 6.2 Bar 1 flag

The ◆ flag marks where bar 1 starts in the video (`offset`). Drag it in the ruler (the hint layer moves with it, so the user can line note-start ticks up with the beat lines), nudge it in the Song panel (±10 ms / ±100 ms), or pause the video on the first downbeat and press "Bar 1 is here".

## 7. Add a song (simplified)

One screen with:

1. **Paste a tab** — a textarea, a YouTube link field and an optional title (prefilled from the tab's first line). Live summary ("38 notes in 12 bars, capo 2") and the reader's warnings. **Open in editor** builds the song (tab reader + spacing guess) and opens the roll.
2. **Start from scratch** — title, optional YouTube link → empty roll with 4 bars of 4/4 at 100 BPM.
3. **I have Taalmel song text** and **Use an AI chat** — unchanged.
4. **Find it in the library** — unchanged.

Drafts in progress are listed at the top with Continue / Discard, as now.

## 8. Saving

- On save, each bar's slot count is the coarsest grid that holds every start and length in that bar: `n = barTicks / gcd(barTicks, all note start offsets and lengths in the bar)`, using the section unit when it already fits. Lengths that don't fit the grid use the `kX a/b` form.
- Lengths are never clamped (a note may pass its bar end); trailing empty bars are removed, except bars a note rings into.
- Save runs `parse(serialize(song))`; errors are shown in a problems list with "Show" buttons that select the note.
- New song: saved into the collection and opened. Existing song: replaced in place (same id).

## 9. Drafts

The `taalmel-import-drafts` database is reused with a new record shape (`version: 2`): `{ id, version, source: "tab" | "scratch" | "song", songId?, songText, view state (zoom, scroll, snap, view), updatedAt }`, autosaved 500 ms after edits. Old version-1 drafts are dropped on load.

## 10. Removed

The six-step `ImportFlow`, `SetupStep`, `NotesStep`, `CheckStep`, `BeatStep`, `TapStep`, `FretPicker`, the old `RhythmEditor` and "Edit rhythm", and the pure helpers only they used (`tap.ts`, `fretboardEntry.ts`, `editorOps.ts`/`songEdit.ts` where unused), with their tests. The tab reader, the spacing guess, `buildSong` and the tab fixtures stay.

## 11. Tests

- Pure roll operations (`src/songEditor/`): move, resize, transpose, string assignment and chord conflicts, bar-end clamping, snapping (including triplets), duplicate bar, copy/paste, ring-until-next, cut-short, undo/redo, technique validity.
- Save: slot choice per bar, round trip `parse(serialize())`, trailing bars.
- Tab view text: chords in one column, techniques, capo.
- Hints: filter-bank frequencies and semitone mapping on synthetic sine/harmonic signals, whitening, strongest-pitch with octave folding, onset picking, video-time ↔ song-time mapping, storage round trip.
- UI smoke (headless Chrome, muted): add a song from the Karz-style fixture tab, drag a note in time and pitch, change a length, add a chord, save, reopen with Edit.

## 12. Later

- Mobile/touch editing.
- Hints in the Strings view (suggested string per pitch).
- Real audio-to-notes ("Let the app listen", `IDEAS.md`).
