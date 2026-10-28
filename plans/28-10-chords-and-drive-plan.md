# Implementation plan: chord library + Google Drive sync

Specs: `specs/28-10-chord-library.md`, `specs/28-10-drive-sync.md`. The user approved building end to end without review stops. Rules for every task:
- Don't commit and don't create worktrees.
- Match the surrounding style.
- Finish with `npx tsc -b` and `npx vitest run` both green.

Each task is done by a Sonnet subagent and verified by the coordinator (typecheck, tests, code read, headless Chrome where there is UI). Tasks in the same wave touch disjoint files and may run in parallel.

## Part A: chord library

| # | Task | Files | Depends |
|---|---|---|---|
| A1 | Chord data: types, open chords, movable templates, slash chords, `checkVoicing`, spelling/key table, `parseChordName`, `chordDisplayName`, `chordNotes`, `chordKey`, `listVoicings`, `slashChordsFor`. Tests: every voicing passes the checker, the spot checks, the parse round-trip. | `src/chords/*` | none |
| A2 | `playChord` + a pure schedule function, with tests. New Settings fields `chordMarks`, `chordView`, `leftHanded` with defaults; old saved settings merge defaults, with a test. | `src/audio/chordPlayer.ts`, `src/audio/index.ts`, `src/model/index.ts`, `src/storage/settings.ts` (+tests) | none (wave 1, with A1) |
| A3 | `ChordDiagram` + `FullNeck` SVG components with render tests (vertical/horizontal, left-handed, barre, "5fr", X/O, root colour, labels). | `src/ui/components/ChordDiagram.tsx`, `FullNeck.tsx`, css module, tests | A1 |
| A4 | Chords screen: search, split root picker, grouped type chips + Slash, header with Strum/Arpeggio + marks, voicing cards, FullNeck, view toolbar (persisted), My chords tab. Sidebar item + App route. Left-handed toggle in Settings. | `src/ui/screens/ChordsScreen.tsx` + css, `App.tsx`, `Sidebar.tsx`, `Settings.tsx` | A1–A3 |
| A5 | Coordinator: headless-Chrome check of the screen (search, pickers, a mark surviving a reload, toggles, screenshot). | none | A4 |

## Part B: Drive sync

| # | Task | Files | Depends |
|---|---|---|---|
| B1 | Storage change events (songs, settings, clips) without breaking existing APIs; `ClipRecord.blob` nullable + `driveFileId`; UI handles a null blob (greyed row, Play/Trim asks to download through a callback prop); `saveSong` can create with a given id. Tests. | `src/storage/*`, `src/recording/clipStore.ts`, Recorder UI touch-ups | A done (shared files: Settings/App) |
| B2 | `src/drive/config.ts`, `auth.ts` (GIS token client behind an interface), `api.ts` (`DriveApi` interface + REST v3 fetch implementation incl. resumable upload, changes), `syncDb.ts`, `testing/fakeDrive.ts` (in-memory `DriveApi`). Tests for `FakeDrive` semantics and the api URL/body building. | `src/drive/*` | none (wave with B1) |
| B3 | Sync engine per spec §3–4 against `DriveApi`, with the full engine test list from the spec (using FakeDrive, fake auth, fake-indexeddb). | `src/drive/engine.ts` + tests | B1, B2 |
| B4 | UI: `useDriveSync` context/provider in App; Settings Drive section (connect/disconnect/email/upload setting/Import); sidebar status chip; conflict dialog; remote-delete confirmation; clip row Drive status, Upload / Remove from this device / download-on-open; Picker import. `.env.local` with the user's public values. | `src/drive/useDriveSync.ts`, `src/drive/picker.ts`, UI files, `.env.local` | B3 |
| B5 | Coordinator: headless Chrome against FakeDrive (injected through a dev-only `window.__taalmelFakeDrive` hook, enabled only under `import.meta.env.DEV`). Check: chip states, conflict dialog, clip badges, Settings section. Full suite. Write the manual first-run checklist in the final report. | none | B4 |
