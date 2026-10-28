# Chord library (chords sub-project 1)

Status: approved in conversation 2026-10-28. This is the first of four chord sub-projects. The later ones (one-minute changes + quiz, strum-along progressions, string-by-string mic check) build on the data and components defined here.

## Goal

A **Chords** section that works as a reference library: pick or search any chord, see its shapes as clear diagrams, hear it, and mark it as *learning* or *known*. It must be easy to add more chord types and shapes later.

## 1. Chord data (`src/chords/`, no UI dependencies)

### Chord types

| id | name | formula | may omit |
|---|---|---|---|
| `maj` (suffix "") | major | R 3 5 | |
| `m` | minor | R b3 5 | |
| `7` | dominant 7th | R 3 5 b7 | 5 |
| `m7` | minor 7th | R b3 5 b7 | 5 |
| `maj7` | major 7th | R 3 5 7 | 5 |
| `sus2` | suspended 2nd | R 2 5 | |
| `sus4` | suspended 4th | R 4 5 | |
| `dim` | diminished | R b3 b5 | |
| `dim7` | diminished 7th | R b3 b5 bb7 | |
| `aug` | augmented | R 3 #5 | |
| `add9` | add 9 | R 3 5 9 | 5 |
| `6` | major 6th | R 3 5 6 | 5 |
| `m6` | minor 6th | R b3 5 6 | 5 |
| `9` | dominant 9th | R 3 5 b7 9 | 5 |
| `5` | power chord | R 5 | |

The type list is data (`CHORD_TYPES`), grouped for the UI: Triads (maj, m, dim, aug, sus2, sus4, 5), Sevenths (7, m7, maj7, dim7), Added & extended (6, m6, add9, 9).

### Voicing representation

```ts
type Fret = number | null;              // null = muted (X); 0 = open
interface Voicing {
  id: string;                            // stable, e.g. "C:maj:open-C" or "F:maj:E-1"
  frets: [Fret, Fret, Fret, Fret, Fret, Fret];   // string 6 (low E) .. string 1 (high e)
  fingers: [number | null, ...];         // 1-4 per sounding fretted string, null for open/muted
  barre?: { fret: number; fromString: StringNumber; toString: StringNumber; finger: 1 };
  baseFret: number;                      // lowest fretted fret shown in the diagram window (1 = at the nut)
  source: "open" | "E" | "A" | "C" | "D" | "G" | "other";
}
```

### Movable shape templates

Hand-authored per chord type: offsets relative to the root's fret on a named root string, plus fingers and optional barre. Each template is transposed to all 12 roots. A transposed template is **skipped** if the root fret is 0 (open positions come from the hand-written open chords), if any fret would be negative, or if any fret exceeds 15. Templates are mainly the CAGED families. At minimum every type has an E-shape (root on 6) and an A-shape (root on 5) where a standard one exists. The 9 and dim7 types use their standard movable shapes. Add C/D/G-shape templates where they are common, standard shapes.

### Open chords

Hand-written absolute voicings with exact fingers, at least: C, A, G, E, D, Am, Em, Dm, A7, B7, C7, D7, E7, G7, Am7, Dm7, Em7, Cmaj7, Dmaj7, Fmaj7, Gmaj7, Amaj7, Dsus2, Dsus4, Asus2, Asus4, Esus4, Cadd9, Gadd9 (both common forms if any), A6, D6, E5, A5, D5 (open power), Em6, Am6, E9, Edim? (skip if not a standard open shape). Open shapes are not transposed.

### Slash chords

Hand-written list, open/common shapes only, not transposed: D/F#, G/B, C/E, C/G, Am/G, F/C, D/A, E/G#, A/C#, G/F#. They appear under their chord root (D/F# under D) in a "Slash" group. Their id is the name, e.g. `slash:D/F#`.

### Checker (`checkVoicing`)

For a voicing claimed as root R and type T, the sounding pitch classes must:
- include R and every required interval of T (all formula tones minus `may omit`);
- include nothing outside T's formula;
- have the lowest sounding note equal to R. Slash chords instead have it equal to the named bass, and their upper notes are checked against the chord before the slash.

Playability:
- at most 4 distinct fingers, where one barre counts as finger 1;
- fretted span (max − min of non-zero frets) ≤ 4;
- a barre's strings are consecutive and all sound at or above the barre fret;
- each finger number in 1–4 marks a fretted string.

The checker also returns, per string, the interval label (R, b3, 5, …) and note name, which the diagrams use.

### Names and spelling

- 12 roots, sharps by default (C, C#, D, D#, E, F, F#, G, G#, A, A#, B). Each accidental root can also be spelled flat (Db, Eb, Gb, Ab, Bb). Spelling is chosen per pick, with no global toggle (see the app-wide note-spelling rule).
- Chord display name = root spelling + suffix (`F#m7`, `Bbmaj7`, `C`).
- Note names use the chosen spelling family: sharps for a sharp root, flats for a flat root. Natural roots use the key's conventional spelling (F, and others whose scale uses flats, spell b3/b7 notes with flats, e.g. Fm = F Ab C; Cm = C Eb G). Implement with a small key-signature table, not ad hoc.
- `parseChordName(text)` accepts `C`, `Cm`, `C#m7`, `Dbmaj7`, `D/F#`, `Bb5`, `Gsus4`, `Aadd9`, case-sensitive on the root letter, plus `♯`/`♭` symbols. It returns `{ root pitch class, spelling, typeId }`, `{ slash: name }` for a known slash chord, or `null`. `C#` and `Db` parse to the same pitch class.

### Public API (`src/chords/index.ts`)

`CHORD_TYPES`, `ROOTS`, `listVoicings(rootPc, typeId)` (sorted low→high by baseFret, open first), `slashChordsFor(rootPc)`, `parseChordName`, `chordDisplayName`, `chordNotes(rootPc, typeId, spelling)`, `checkVoicing`, `chordKey(rootPc, typeId)` (spelling-independent, e.g. `"6:m7"`; slash chords use `"slash:D/F#"`).

## 2. Diagrams (SVG React components, display only)

### `ChordDiagram`

Props: voicing, labels (`"fingers" | "intervals"`), orientation (`"vertical" | "horizontal"`), leftHanded, showNoteNames, and size.

- **Window:** a 5-fret window. A thick nut when `baseFret === 1`, otherwise a position label like "5fr".
- **Open and muted strings:** X/O markers above the nut in vertical view, and beside it in horizontal view.
- **Dots:** labelled with finger numbers or intervals. A barre is drawn as one rounded bar.
- **Roots:** dots on the root are drawn in the accent colour. Open roots get an accent ring.
- **Orientations:** vertical draws strings as vertical lines with low E on the left. Horizontal puts high e on top, like the tab lane, with frets running left to right.
- **Left-handed:** vertical view mirrors the string order. Horizontal view puts the nut on the right.
- **Note names:** an optional row (or column) of note names.
- **Accessibility:** an `aria-label` like "C major, x32010".
- **Colours:** come from CSS tokens.

### `FullNeck`

- 15 frets drawn horizontally.
- Every position of the chord's tones is marked. Roots are in the accent colour, other tones are labelled by interval or note name (following the labels toggle).
- The selected voicing's positions are outlined.
- It respects the left-handed setting and is display only.

## 3. Chords screen

A new sidebar item, **Chords**. The screen from top to bottom:

1. **Search box:** Enter parses with `parseChordName` and jumps to the chord. An unknown name shows an inline message.
2. **Root picker:** 12 buttons. Accidental roots are split buttons (**C♯ | D♭**) where each half picks that spelling.
3. **Type picker:** chips in the groups above, plus **Slash**. It shows the root's slash chords, or "None for this root yet".
4. **Chord header:** for example "F♯m7 · F♯ minor 7th · notes F♯ A C♯ E · R b3 5 b7". It has **Strum** and **Arpeggio** buttons, plus a **Learning / Known** mark toggle that can be cleared.
5. **Voicing cards:** each card shows its position label ("open", "5fr") and a small play button. Clicking a card selects it.
6. **FullNeck:** shows the selected voicing.

The page also has:
- **View toolbar:** Vertical/Horizontal, Fingers/Intervals and Note names, persisted in settings.
- **"My chords" tab:** lists marked chords grouped Learning / Known. Clicking one opens it.

On narrow widths the pickers wrap and the cards stack.

## 4. Sound, marks and settings

- **`playChord(voicing, style)`** in `src/audio/`:
  - Uses `renderPluck` from the synth on the shared AudioContext and skips muted strings.
  - Strum plays low → high, 15 ms apart. Arpeggio plays them 250 ms apart.
  - Uses the `a4Hz` setting and the `playNotesVolume` setting.
  - A new call stops the previous chord.
  - The schedule (which strings play, at what time offsets) comes from a pure, tested function.
- **New `Settings` fields:**
  - `chordMarks: Record<string, "learning" | "known">`, keyed by `chordKey`
  - `chordView: { orientation, labels, noteNames }`
  - `leftHanded: boolean`, shown in the Settings screen
- **Defaults** come from `DEFAULT_SETTINGS`, and settings saved before these fields existed load with the defaults merged in.

## 5. Testing

- **Every voicing is checked:** every voicing for every root × type, plus every open and slash chord, passes `checkVoicing`. This covers notes and playability.
- **Exact spot checks:**
  - C = x32010
  - F (E-shape, 1st fret) = 133211 with a barre
  - Bm (A-shape) = x24432
  - D/F# = 200232
  - G = 320003 or 320033
  - Bbmaj7 notes spelled Bb D F A
  - Fm notes = F Ab C
- **`parseChordName`:** round-trips with `chordDisplayName` for every root × type, accepts `♯`/`♭`, rejects `H7`, `Cm#` and an empty string, and gives `C#`/`Db` the same `chordKey`.
- **Diagram SVG output:** vertical and horizontal, left-handed mirroring, barre rendering, the "5fr" label, X/O markers.
- **`playChord` schedule:** strum and arpeggio order and offsets, with muted strings skipped.
- **Settings:** old saved settings load with the new defaults.
- **Headless Chrome:** search, both pickers, a mark surviving a reload, and the view toggles.
