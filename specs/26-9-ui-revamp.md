# Taalmel: UI Revamp Design (proposal)

Status: approved 2026-09-26. Phases 1-5 implemented (light theme skipped per decision 4). Deferred: command palette (4), loop edge drag-handles (5.2), timing histogram in the session summary (5.3), live per-click detection dots in calibration (9).
Date: 2026-09-26
Scope: visual design, layout, and interaction of every screen. Data model, song format, audio and clock modules do not change. Companion to `specs/26-9-claude.md`.

Terms in **_bold italics_** are worth searching to see what they look like.

---

## 1. What is wrong today

1. **It looks like an admin form.** Every screen is a row of labelled inputs in a bordered box on a flat dark background. No hierarchy: Play has the same visual weight as "Subdivision".
2. **The transport is a wall of controls.** ~15 controls on one wrapping row plus extra boxes (BPM ramp, notices). While playing you need about 3 of them.
3. **The sheet is small and faint.** 11px fret numbers, hairline strings, grey-on-grey grid, in a panel with lots of dead space. The sheet is the product and gets the least visual care.
4. **Notices pile up.** "Not calibrated", "Listening…", mic errors and video fallback each add a full-width banner that pushes the sheet down.
5. **No sense of place.** No persistent navigation, no song context (BPM, sections) at a glance, no visual difference between library, editor and practice.

---

## 2. Design principles

1. **The sheet is the hero.** In practice view it takes most of the screen; everything else is chrome that recedes while playing.
2. **Show only what the moment needs** (**_progressive disclosure_**): core controls visible, setup in panels, rare settings in Settings.
3. **Readable from a music stand.** The player sits 60–100 cm away holding a guitar. Glyph size, contrast and cursor must work at that distance.
4. **Keyboard-first while playing.** Hands are on the guitar; one-key shortcuts for play, loop, speed.
5. **Calm feedback.** Verdicts are colored, but the default state is quiet: no flashing, no red walls.

---

## 3. Visual system

### 3.1 Design tokens

All colors, spacing, radii and type sizes defined once as **_CSS custom properties_** (**_design tokens_**), in two themes. Search: **_design tokens CSS variables theming_**.

- **Theme:** dark default, optional light theme. Components use **_semantic tokens_** (`--surface-1`, `--text-muted`, `--accent`, `--verdict-ontime`), never raw colors.
- **Surfaces:** three elevation levels (page, panel, popover) separated by lightness rather than heavy borders. Search: **_material design dark theme elevation surfaces_**.
- **Accent:** one brand accent (warm amber/saffron suits the name) for the cursor, primary button, active loop. Verdict colors are a separate **_colorblind-safe palette_**. Search: **_Okabe-Ito palette_**.
- **Spacing:** **_8pt grid_** spacing scale (4/8/12/16/24/32). Radii: 6px controls, 10px panels.

### 3.2 Typography

- **UI:** a clean sans like **_Inter_** or **_Geist_**, with a **_modular type scale_** (1.25 ratio).
- **Tab numbers and letters:** a monospace with **_tabular numbers_** (**_JetBrains Mono_**, **_IBM Plex Mono_**) at 15–18px default. Fret numbers never smaller than body text.
- **Teacher notation:** a serif for letter glyphs (e.g. **_Source Serif_**) so it reads as written music, distinct from tab.
- Later option: a **_SMuFL_** music font (**_Bravura_**) for strum, vibrato and bend symbols instead of ASCII.

### 3.3 Icons and motion

- Icons: **_Lucide_** set; icons + tooltips replace most text labels in the transport.
- Motion: 120–200 ms **_ease-out_** for panels only; nothing animates on the sheet except cursor and auto-scroll. Respect **_prefers-reduced-motion_**.

---

## 4. App shell and navigation

- **Left sidebar**, collapsible to icons: Library, New song, Exercises, Calibration, Settings. Search: **_collapsible sidebar app shell_**.
- **Practice view hides the sidebar** (**_focus mode_**): slim top bar with back button and song title.
- **Command palette** (Cmd/Ctrl+K): open songs, jump to section, change speed. Search: **_command palette UI_** (Linear, Raycast).
- **Toasts instead of banners** for transient messages (saved, copied, exported). Search: **_toast notification pattern_**. Persistent states (mic off, not calibrated) become small **_status chips_** in the top bar.

---

## 5. Practice view (main screen)

Top to bottom:

1. **Top bar (48px):** back, title, section chips (click to jump/loop), status chips (mic **_VU meter_**, calibration, video sync).
2. **Video panel (optional):** docked right on wide screens (**_resizable split panes_**) or above the sheet on narrow ones; collapsible.
3. **Sheet:** fills remaining height.
4. **Transport dock (bottom, 64px):** a **_floating toolbar_** like a media player.

### 5.1 Transport dock

| Group    | Controls                                                                                |
| -------- | --------------------------------------------------------------------------------------- |
| Playback | Play/Pause (large, accent), Stop, Loop toggle                                           |
| Tempo    | Big BPM number, drag/scroll to change (**_scrubbable number input_**), speed % under it |
| Feedback | Mic toggle with live level meter, metronome toggle                                      |
| Position | Bar:beat readout like a DAW **_transport display_**                                     |

Everything else (count-in, subdivision, volume, lanes, zoom, BPM ramp, rest between loops, grid/video mode) moves into two **_popovers_** from the dock: **Practice** (tempo ramp, loop rest, count-in, metronome) and **View** (lanes, zoom). Search: **_popover vs modal UX_**.

References: Ableton Live transport, Soundslice player controls, Songsterr player bar.

### 5.2 Sheet rendering

- **Render each row as SVG** instead of absolutely positioned DOM: crisper lines, same coordinates as the `layout` module, easy theming. The live waveform stays on a **_canvas overlay_** behind it. Search: **_SVG vs canvas rendering_**, **_layered canvas_**.
- **Bigger strings:** 18–22px string gap at default zoom, string lines heavier than grid lines.
- **Grid hierarchy:** strong bar lines, medium beat lines, faint subdivisions, like a DAW **_piano roll_** grid.
- **Notes as pills:** fret number inside a rounded bar whose length is the duration (**_piano roll note blocks_**). Uncertain notes: dashed outline + **_SVG hatch pattern_** fill.
- **Techniques as drawn marks:** **_slur arcs_** for hammer/pull, angled lines for slides, bend arrows, like standard **_guitar tablature notation_** in Songsterr / Guitar Pro.
- **Letter lane** aligned under each note, stacked for chords, spelled as the song spells it.
- **Active-row emphasis:** current row full opacity, others dimmed ~60% (**_focus + context_**). Cursor: thick accent line with soft glow and small bar:beat flag.
- **Section labels** as colored **_pill badges_** at the row's top-left.
- **Loop range** as a tinted band with draggable edges (**_range selection handles_**), plus existing click/shift-click.

### 5.3 Mic feedback

- Waveform behind the notes as a soft mirrored **_amplitude envelope_** (like a **_SoundCloud-style waveform_**, low contrast).
- Verdicts as small dots on the note's column colored by tier, with a short tick toward the expected time; pitch result as a ring.
- **Session summary** as a **_slide-over panel_** with a **_timing deviation histogram_** (early → late), the rushing/dragging number as the headline, and per-section breakdown (see Melodics / Yousician result screens).

---

## 6. Library

- **Cards or list** (toggle). Card: title, BPM, time signature, sections, a tiny **_sparkline_** of note density, last practiced, video badge.
- **Search + sort** (title, updated, practiced).
- Row actions (export, duplicate, delete) in a **_kebab menu_**.
- A proper **_empty state_** with two primary actions: "Import from notes", "Try an exercise".
- Library export/import in an **_overflow menu_**; persistence warning as a status chip.

References: Apple Music library, Soundslice library, Linear list views.

---

## 7. New song (import) flow

A 3-step **_stepper / wizard_**:

1. **Details:** title, BPM, time, grid, YouTube link (inline thumbnail).
2. **Ask your LLM:** prompt in a read-only **_code block_** with one big Copy button and a one-line instruction.
3. **Paste and fix:** **_split pane_** — editor left (**_CodeMirror 6_** with song-format **_syntax highlighting_** and inline **_lint diagnostics_**), live sheet preview right. Errors in a **_problems panel_** like VS Code, clickable; "Copy repair prompt" next to the error count.

The same editor is reused for "Edit text" in the song view.

---

## 8. Exercises

- **_Card picker_** for Chromatic / Spider / Rhythm with a one-line description.
- Parameters in a compact side panel using **_segmented controls_** (grid 4/8/12/16, direction) and **_stepper inputs_** (bars, start fret); finger pattern as 4 reorderable **_chips_**.
- Preview updates live (no Generate button), same practice dock underneath.

---

## 9. Calibration and settings

- **Calibration:** focused screen with one big Start button, live mic meter, 8 dots filling as clicks are detected, clear result with Good / Retry states.
- **Settings:** grouped sections (Practice, Feedback & timing, Display, Data) with **_inline help text_**; timing tiers edited on one **_range slider_** showing on-time / close / off zones.

---

## 10. Keyboard shortcuts

| Key        | Action                                      |
| ---------- | ------------------------------------------- |
| Space      | Play / pause                                |
| Esc        | Stop                                        |
| L          | Loop on/off                                 |
| [ / ]      | Speed −/+ 5%                                |
| M          | Mic on/off                                  |
| ← / →      | Previous / next bar                         |
| Cmd/Ctrl+K | Command palette                             |
| ?          | **_Keyboard shortcut cheat sheet overlay_** |

---

## 11. Accessibility

- **_WCAG 2.2 AA_** contrast in both themes.
- Verdicts never rely on color alone: shape backs it up (filled / hollow / cross).
- Everything keyboard-reachable with visible **_:focus-visible_** rings.
- Minimum 32px hit targets in the dock.

---

## 12. Implementation approach (after approval)

- **Primitives:** **_Radix UI Primitives_** (popover, dialog, tooltip, slider, toggle group, dropdown) for accessible behavior, styled with our tokens. Alternative: **_shadcn/ui_** (Radix + **_Tailwind CSS_**). Recommendation: **CSS Modules + tokens**, fewer dependencies and less markup churn.
- **Editor:** **_CodeMirror 6_** with a small language mode (**_StreamLanguage_** or a **_Lezer grammar_**) and the existing parser feeding its lint extension.
- **Sheet:** SVG row components fed by the existing `layout` output (a rendering swap, layout math unchanged).
- **Motion:** CSS transitions; **_Motion_** (formerly Framer Motion) only if needed.
- **Icons:** `lucide-react`.

### Phases (each ships working and gets reviewed before the next)

1. Tokens, typography, app shell (sidebar, top bar, toasts, status chips).
2. Practice view: transport dock + popovers, SVG sheet with drawn technique curves (5.2: slur arcs, slide lines, bend arrows; half-arcs across row breaks), overlay polish, shortcuts.
3. Import wizard with CodeMirror editor and problems panel.
4. Library cards, exercise picker, calibration and settings screens.
5. Light theme and accessibility pass.

---

## 13. References

- **Songsterr** (songsterr.com): tab rendering, player bar, cursor.
- **Soundslice** (soundslice.com): notation synced to video, loop handles, practice tools.
- **Guitar Pro 8**: tab technique symbols, transport layout.
- **Yousician**, **Melodics**: timing feedback and results screens.
- **Ableton Live**, **Logic Pro**: transport bars, piano-roll grid hierarchy.
- **Linear** (linear.app): app shell, command palette, calm dark theme.
- **alphaTab** (alphatab.net): open-source web tab renderer, glyph conventions.
- **Radix UI** (radix-ui.com/primitives), **shadcn/ui** (ui.shadcn.com): component look and behavior.
- **Refactoring UI** (book, Wathan & Schoger): hierarchy, spacing and color principles for moving past "backend-engineer UI".

---

## 14. Decisions (answered 2026-09-26)

1. Accent color: warm amber.
2. Video panel: docked right on wide screens.
3. Styling: CSS Modules + design tokens (no Tailwind/shadcn).
4. Theme: dark only in the first pass; tokens stay theme-ready.
5. Technique curves: drawn in phase 2 with the SVG sheet.
