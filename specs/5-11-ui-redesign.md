# Taalmel: UI Redesign "A2" (design spec)

Status: draft for review, 2026-11-05.
Supersedes the visual parts of `specs/26-9-ui-revamp.md` (tokens, shell, practice layout). Its principles (sheet is the hero, progressive disclosure, readable from a music stand, keyboard-first, calm feedback) still hold.
Mockups: the "A2" row of the Taalmel Hub Concepts canvas (https://claude.ai/artifact/4MjQsdzjSL5xsSDYZTfn5e).
Product context: "Product vision" in `CLAUDE.md`.

---

## 1. Goals

1. Turn the app into a **hub**: a home that shows every tool and where you left off, and tools that are reachable from anywhere.
2. A distinct look of our own: warm dark (and warm light) surfaces, saffron brand, Space Grotesk headings.
3. **Light mode** and **3 accent colours**, without breaking the fixed meaning colours.
4. Practice verdicts a beginner can read at a glance: colour = timing; a mark = wrong note.
5. Fix the matcher so "wrong note" also catches the wrong octave.

Out of scope: phone/tablet layout, practice log and streaks, new tools (all in `IDEAS.md`).

---

## 2. Visual system

### 2.1 Fonts

| Role | Font | Notes |
| --- | --- | --- |
| Headings, song titles, big numbers in cards | Space Grotesk 500/600/700 | New: add `@fontsource/space-grotesk` (self-hosted, no Google Fonts at runtime). |
| UI text | Inter 400/500/600 | Already installed. |
| Tab fret numbers, BPM, note names, timers | JetBrains Mono 500/700 | Already installed. |

Type scale (px): 12, 13, 14, 15 (body), 17, 22, 24, 30, 40. Tab fret numbers 22px in practice view, never below 14px anywhere.

### 2.2 Theme tokens

All colours are CSS custom properties in `src/ui/tokens.css`, set by `data-theme` and `data-accent` on `<html>`. Components use only semantic names. Values from the A2 mockup:

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--bg` | `#15130F` | `#F7F4EE` | Page |
| `--rail` | `#110F0C` | `#EFEAE1` | Icon rail |
| `--surface-1` | `#1E1B16` | `#FFFFFF` | Cards, chips |
| `--surface-2` | `#27231C` / `#2E2920` | `#F1ECE3` | Pills, selected segment |
| `--pocket` | `#27231C` | `#FFFFFF` | Floating pocket and transport pill |
| `--sheet` | `#17150F` | `#FBF9F5` | Tab preview backgrounds |
| `--border` | `#2A261F` | `#E2DACB` | Rail edge, header rule |
| `--card-border` | transparent | `#E8E1D4` | Cards need an edge only on light |
| `--line` | `#3A352C` | `#D6CEBF` | Tab string lines, outlines |
| `--barline` | `#4A443A` | `#B9AF9D` | Bar lines |
| `--text` | `#F2EDE4` | `#1F1B14` | Primary text |
| `--text-muted` | `#B8B0A3` | `#5E574B` | Secondary text |
| `--text-subtle` | `#8C8477` | `#7A7264` | Bar numbers, hints (large or non-essential text only) |
| `--shadow-float` | `0 12px 32px rgba(0,0,0,.45)` | `0 10px 28px rgba(60,45,20,.14)` | Pocket, transport |

### 2.3 Accents

Three accents; **saffron is the default and the brand**. The logo (`public/favicon.svg`: saffron square, eighth note) is always saffron, whatever accent is chosen.

| Accent | Mode | `--accent` (fills, cursor) | `--on-accent` | `--accent-text` (text, links, active nav) | `--accent-tint` |
| --- | --- | --- | --- | --- | --- |
| Saffron | dark | `#F2A93B` | `#1A1408` | `#F2A93B` | `#2E2717` |
| Saffron | light | `#F2A93B` | `#1A1408` | `#985A00` | `#FBEBD0` |
| Teal | dark | `#3CC8B4` | `#04201C` | `#5ED6C4` | `#142824` |
| Teal | light | `#0F8F80` | `#FFFFFF` | `#0B6F63` | `#D7F0EC` |
| Violet | dark | `#A78BFA` | `#170E33` | `#B9A3FF` | `#231D36` |
| Violet | light | `#6D4FD8` | `#FFFFFF` | `#5A3EC4` | `#E9E3FB` |

Derived: `--accent-loop` (accent at 7–8% alpha, loop region fill), `--accent-loop-edge` (50%), `--accent-glow` (cursor glow, 60% dark / 35% light).

The accent is used for: primary buttons, the playback cursor, the loop region, the active nav item, the selected section chip, toolbox icon tiles, links. **Never** for verdicts or status.

### 2.4 Fixed meaning colours

Same in every accent; chosen to stay apart from saffron, teal and violet.

| Token | Dark | Light | Meaning |
| --- | --- | --- | --- |
| `--verdict-ontime` | `#7DB4F0` | `#1F66C2` | Note played on time |
| `--verdict-off` | `#F07AA8` | `#C2306E` | Note clearly early or late |
| `--verdict-missed` | `--text-subtle` at 50% opacity | same | Note not played |
| `--ok` | `#7FC8A9` | `#1E7F57` | In tune, good mic level |
| `--warn` | `#E8B04A` | `#A0620E` | Too quiet, needs attention (always with a text label) |
| `--record` | `#F06A4A` | `#D2492A` | Record button and recording state |
| `--record-tint` | `#3A1F1A` | `#FBE3DC` | Record button background |

Every text/background pair must meet WCAG AA (4.5:1 for text under 24px). A token test (Vitest) checks the table pairs: `--text`, `--text-muted`, `--accent-text` on `--bg` and `--surface-1`, and `--on-accent` on `--accent`, for both modes and all accents.

### 2.5 Settings

- `theme: "system" | "dark" | "light"` (default `"system"`, follows `prefers-color-scheme`). **Device-local** (added to `DEVICE_LOCAL_SETTINGS`), since a laptop and a phone may want different modes.
- `accent: "saffron" | "teal" | "violet"` (default `"saffron"`). **Synced.**
- Both apply before first paint: a tiny inline script in `index.html` reads the cached values from `localStorage` (written whenever settings change) and sets the `<html>` attributes, so there is no flash of the wrong theme.

### 2.6 Shape and motion

Radii: 10–12px controls, 14px tiles, 18px cards, 999px pills. Spacing on a 4/8 grid. Motion as in the 26-9 spec (120–200 ms ease-out on panels only, respect `prefers-reduced-motion`).

---

## 3. App shell

### 3.1 Icon rail (replaces the current sidebar)

- 88px wide, always visible (no collapse needed), `--rail` background, `--border` right edge.
- Top: the logo (44px), links to Home.
- Items, icon above a short label (Lucide icons, already a dependency): **Home, Songs, Chords, Exercises, Recordings**. **Library** appears once the shared library ships (`5-11-shared-library.md`).
- Active item: `--surface-1` (light) or `--surface-2` (dark) pill, `--accent-text` icon and label. Others `--text-muted`.
- Bottom: Settings, theme toggle (sun/moon, cycles dark/light, long-press or Settings for "system"), account chip (the existing `AccountChip`, shrunk to an avatar).
- The accent picker lives in Settings (the mockup's dots on the rail were for comparing only).
- Calibration, New song, Metronome, Tuner and Recorder screens stay as routes, reached from Home, the pocket, or their parent screens; they are not rail items.

### 3.2 Pocket (global tools)

A floating pill, bottom-right on every screen, `--pocket` background, `--shadow-float`.

| Chip | Shows | Click |
| --- | --- | --- |
| Tuner | Fork icon + last detected note + "in tune" (`--ok`) when listening; just "Tuner" otherwise | Popover with the existing `TunerPanel` |
| Metronome | Icon + BPM | Popover: start/stop, BPM ±, tap tempo. In practice view it mirrors the song (BPM × speed) and says "video is the clock" when in video mode. |
| Mic level | Only while the mic is on: 5-bar meter + "good level" / "too quiet" / "too loud" | Popover with the hint text (see `5-11-recording-level.md`) |
| Record | Red dot; in practice view, "Record this take" | Starts a quick recording (existing recorder), saved as a clip |

- Hidden on the screen that *is* the tool (Tuner screen hides the tuner chip, and so on).
- Keyboard: `T` tuner, `M` metronome, `R` record (only when focus is not in a text field).
- Must never cover the sheet's last line: the practice screen reserves bottom padding (160px).

### 3.3 Status and notices

The existing `StatusChip` (Drive sync, calibration, mic errors) moves to the top-right of each screen's header area. No full-width banners.

---

## 4. Home (the hub)

Route `/` (Songs moves to its own rail item). Mockup: A2 Home.

1. **Header:** time-of-day line ("Thursday evening") and the title "Pick up where you left off". First visit with no history: "Welcome to Taalmel" and a short line explaining it is a set of practice tools.
2. **Continue row** (grid 2:1):
   - **Last song card:** title, section, loop range, speed, a small tab preview of the current position with the cursor, a "Continue" button (opens the practice view in the exact state), and up to two facts as chips (e.g. "Last take: 9 of 12 on time", chords used).
   - **Last chord practice card:** the chord pair, best score, "Go again".
   - No history: replaced by "Start here" cards: "Tune your guitar", "Try a sample song" (Ode to Joy), "Learn your first chords".
3. **Your toolbox:** 3-column grid of tool tiles: Tuner, Metronome, Chord library, Chord changes, Exercises, Recordings (later: Shared library). Each tile: icon tile in `--accent-tint`, name, one plain sentence.

**Data:** a new device-local `recent` record in settings storage, written as you practice:
`{ songId, sectionIndex, loop: {startBar, endBar} | null, speed, lastTake?: {onTime, total}, at }` and `{ chordPair: [a, b], at }`. Kept small; no history list (a practice log is a later idea).

---

## 5. Practice screen

Mockup: A2 Practice. The rail stays visible (88px is cheap); everything else serves the sheet.

- **Header:** song title (Space Grotesk 24), meta line (time signature, BPM, credit), section chips (selected = accent fill), clock toggle (Metronome / YouTube video) as a segmented control on the right, status chip.
- **Sheet:** full width, large tab (22px frets, 28px string spacing at default zoom), bar numbers above each bar, loop region as `--accent-loop` fill with an `--accent-loop-edge` top line, cursor 3px `--accent` with glow. The existing renderer (`src/render`) keeps its layout model; only colours, sizes and these elements change.
- **Transport pill** (bottom-left, floating): Play (56px, accent), Loop button showing the range ("Loop bars 1–8"), speed slider with % readout. Less common controls (count-in, subdivision clicks, play notes, zoom, lanes) go into a "⋯" popover on the pill.
- **Pocket** (bottom-right): mic level, tuner, record.
- Keyboard shortcuts from the 26-9 spec unchanged.

---

## 6. Note verdicts

### 6.1 Display

**Colour is for timing only.** Wrong notes get a mark, not a colour.

| Matcher result | Fret number colour | Extra mark |
| --- | --- | --- |
| On time (`onTime` tier) | `--verdict-ontime` | none |
| Close (`close` tier) | `--verdict-ontime` | small tick before the number (early) or after it (late), 2px × 10px, same colour |
| Off (`off` tier) | `--verdict-off` | same early/late tick, in `--verdict-off`; the number is also underlined, so colour is not the only cue |
| Missed | faded (`--verdict-missed`) | none |
| Not yet played | `--text` | none |
| Pitch `wrong` (any timing tier) | timing colour as above | the note actually played, as a small label above the fret number (e.g. "F", or "E3" when only the octave is wrong), `--text-muted` on a `--surface-2` chip |
| Pitch `unknown` / `skipped` | timing colour | none |
| Extra onset (matched nothing) | n/a | small `--verdict-off` dot on the timeline at its time |

Verdict colours reset at each loop pass (current behaviour). The session summary panel restyles with the same colours and adds the wrong-note count.

### 6.2 Matcher: check the octave

Today (`src/audio/pitchClass.ts`, spec 9.5 of `26-9-claude.md`) the check compares **pitch class only**, so a note an octave off counts as right. New rule for single picked notes:

1. **Exact match:** `right` when the detected pitch rounds to the expected MIDI note (±50 cents, after the A4 reference from settings). The same pitch on a different string is still right (it is the same note).
2. **Different pitch class:** `wrong`, store the detected MIDI as `playedMidi`.
3. **Same pitch class, different octave:** YIN often reports an octave too low or too high on guitar, so do not trust it directly. Re-check with the expected period: compute YIN's normalized difference `d'(τ)` at the expected note's period and at the detected period (both from the same 2048-sample slice).
   - If `d'(τ_expected)` is below the YIN threshold (0.15) and within 0.05 of `d'(τ_detected)`, the expected octave is plausible: `right`.
   - Otherwise `wrong`, with `playedMidi` = the detected note.
   - Tuned during the build: when the detected note is an octave *above* the expected one, the doubled expected period is also a clean dip, so the rule alone always says `right`. That case additionally needs `d'(τ_detected) − d'(τ_expected) ≥ 0.06` to count as a YIN error (synthetic tests: real octave-up notes ≤ 0.04, YIN octave errors ≥ 0.07). Notes above ~1 kHz (E6+) are untested because YIN folds them near its 1400 Hz ceiling.
4. Low confidence (< 0.5, as today): `unknown`. Chords: `skipped`, timing only (unchanged).

Model change: `Verdict` gains `playedMidi?: number`. The pitch worker returns the per-τ values needed for step 3, or does the re-check itself given the expected MIDI.

Tests (Vitest): synthetic plucked tones (the existing `guitarSynth` used offline) for each string at frets 0, 5, 12: right note, right note an octave up/down (must be `wrong`), a neighbouring semitone (`wrong`), and a low-E with strong second harmonic (must stay `right`, the classic YIN octave trap). The 26-9 spec section 9.5 gets a note pointing here.

---

## 7. Other screens

Each existing screen is restyled with the new tokens and components, no behaviour change: Songs (library list), New song, Song editor, Chords and chord practice, Exercises, Recordings and the clip trimmer, Calibration, Settings (gains Theme and Accent), Tuner, Metronome, privacy and terms pages (light/dark aware).

Shared components to build first: Button (primary/secondary/ghost), Pill, Card, SegmentedControl, IconTile, Popover (exists, restyle), Slider, Chip, Meter.

---

## 8. Rollout order

1. **Foundation:** fonts, tokens for both modes and all accents, `theme`/`accent` settings with the no-flash script, contrast test, shared components.
2. **Shell:** icon rail, pocket (tuner, metronome, record; mic meter arrives with `5-11-recording-level.md`), status chip placement.
3. **Practice screen** with the new verdict display **and the matcher octave check**.
4. **Home** with the `recent` record.
5. **Remaining screens** restyled, one per step, browser-checked in both modes.

Each step ships on its own and leaves the app working.

---

## 9. Open points

- Whether Songs keeps its current list layout or becomes cards with tab previews (decide when restyling it).
- Exact icon choice per rail item (Lucide names) at build time.
