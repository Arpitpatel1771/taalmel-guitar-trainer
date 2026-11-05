# Ideas backlog

Ideas for Taalmel. Build them one step at a time; see "Product vision" in `CLAUDE.md`.

## Planned (specs written 2026-11-05)

Build order: 0 → 5. Each spec has its own internal order.

0. **Capo and note names**: `specs/5-11-capo.md`. Song-level capo with per-section overrides (frets relative to the capo), one shared pitch function, a warning a bar before a capo change, letter lane with octaves (`E4`), teacher notation lane removed.
1. **UI redesign "A2"**: `specs/5-11-ui-redesign.md`. Design system (dark/light, 3 accents, fixed verdict colours), icon rail, pocket tools, hub home, practice screen, note verdicts (colour = timing, mark = wrong note) and the **matcher octave check**.
2. **Recording level**: `specs/5-11-recording-level.md`. Live input meter; non-destructive volume boost (on by default) synced as clip metadata; opt-in "Make it permanent".
3. **Song import**: `specs/5-11-song-import.md`. Tab reader, rhythm guess from spacing, bar-by-bar tap-to-rhythm at 0.25–1×, fretboard entry, visual rhythm editor; the AI copy-paste prompt stays as a fallback.
4. **Song sharing**: `specs/5-11-shared-library.md`. Open library (public domain, static files), song requests with end-to-end encrypted replies via Google Forms/Sheets, direct share links. No server.
5. **Song editor (piano roll)**: `specs/5-11-piano-roll.md`. Replaces the import steps and tap-to-rhythm: notes on a piano roll against the video, drag pitch/time/length, techniques, chords, pitch hints from the video's audio.

## Later

### Missing beginner tools

- Scales and fretboard-note trainer
- Ear training
- Strumming patterns
- Practice log and streaks
- Song-learning checklist

### Devices

- Phone and tablet layout (at least a tablet on a music stand). Laptop stays the main target for now.

### Song import

- **Guitar Pro / MusicXML / MIDI import.** Exact pitch and rhythm, parsed in the browser (e.g. alphaTab).
- **"Let the app listen."** Align the known notes to the video's audio (Chrome tab-audio capture plus onset and pitch matching) and suggest the rhythm. Prototype first.
- **Play-to-transcribe.** Play the part into the mic; detected onsets set the rhythm. Good for single notes, weak for chords.
- **Audio-to-notes model** (e.g. Basic Pitch in the browser). Rough with a full band mix.

### Hub

- Tools linking further: a chord in a song opens its diagram and the chord-change trainer; a tricky passage becomes a loop exercise.
- A "rhythm/pulse" visual motif drawn from the name "Taalmel".

### Owner tasks

- Set up the request, reply and report forms and published sheets on your Google account (checklist in `specs/5-11-shared-library.md` §8) before song sharing goes live.
- Publish the Google consent screen and verify branding so the public, not just test users, can use Drive sync (`drive.file` is non-sensitive, so it's a review, not a security audit).
